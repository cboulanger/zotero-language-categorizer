# Low-confidence confirmation and manual code editing — Design

Date: 2026-10-03

## Purpose

The classify dialog already lets a user double-click a row to toggle
`excluded`, and already marks a low-confidence prediction with `(?)` in the
"Change" column. But today those are independent: a low-confidence row is
still applied by default unless the user notices the `(?)` and thinks to
skip it. There's also no way to fix a wrong prediction in place — the only
recourse is to skip the row and edit the item's language field afterwards,
outside the dialog.

This spec adds two changes to the same table:

1. Low-confidence rows start out excluded; double-clicking them confirms
   (and un-confirms) the prediction, reusing the exact mechanism that
   already toggles `excluded`.
2. The predicted code becomes directly editable in place, for any row
   (including ones the classifier couldn't classify at all).

## Scope

- `previewRows()` defaults `excluded = true` the moment a row's result comes
  back unreliable.
- `rowData()`'s `(?)` marker is now tied to `excluded && reliable === false`
  instead of `reliable === false` alone, so confirming a row (double-click)
  clears `(?)` and 🚫 together, with no new field.
- The single "Change" column (`en → fr (?)`) is split into two columns,
  **Current** and **Predicted**, so the predicted code is its own
  double-clickable cell, distinct from "double-click the row to
  skip/confirm."
- Double-click on the Predicted cell opens an inline text editor instead of
  toggling `excluded`; committing a valid ISO 639-1 code updates `row.code`
  and clears `excluded` (editing counts as confirming).
- Does **not** change `onApplyClick()`/Done flow, the status column, or
  anything about the Current column (informational only, not editable).

## Data model

No new fields on `RowState` — both features reuse `excluded`.

### Default-exclude on low confidence

```ts
export function previewRows(
  rows: RowState[],
  classifier: LanguageClassifier,
): void {
  for (const row of rows) {
    try {
      const title = row.item.getField("title") || "";
      const abstractNote = row.item.getField("abstractNote") || "";
      const text = [title, abstractNote].filter(Boolean).join("\n");
      const result = classifier.classify(text);
      row.code = result?.code ?? null;
      row.reliable = result?.reliable ?? null;
      if (row.reliable === false) row.excluded = true;
    } catch (e) {
      row.code = null;
      row.reliable = null;
    }
  }
}
```

This runs once per row, at the transition from `reliable === null` to a real
value, so it can't re-fire and stomp on a later manual toggle. The one
accepted edge case: if a user double-clicks a row that's still showing "…"
(before its classification arrives) and that row later turns out
low-confidence, the default can overwrite that manual toggle. Toggling a
row with no code yet already has no practical effect today, so this isn't
worth guarding against.

### Display logic

```ts
rowData(i: number): Record<string, string> {
  const row = this.rows[i];
  const current = row.currentLanguage || "—";
  const predicted = row.code
    ? row.excluded && row.reliable === false
      ? `${row.code} (?)`
      : row.code
    : "…";
  return {
    title: row.title,
    creators: row.creators,
    current,
    predicted: row.excluded ? `🚫 ${predicted}` : predicted,
    status:
      row.status === "success" ? "✓" : row.status === "error" ? "✗" : "",
    highlighted: row.excluded ? "1" : "",
  };
}
```

The 🚫 prefix moves from the combined "change" string to the `predicted`
cell specifically, since that's the value whose application it's flagging.

### Column layout

```ts
.setProp("columns", [
  { dataKey: "creators", label: getString("dialog-column-creators"), fixedWidth: true, width: 130 },
  { dataKey: "title", label: getString("dialog-column-title"), flex: 3 },
  { dataKey: "current", label: getString("dialog-column-current"), fixedWidth: true, width: 60 },
  { dataKey: "predicted", label: getString("dialog-column-predicted"), fixedWidth: true, width: 110 },
  { dataKey: "status", label: "", fixedWidth: true, width: 32 },
])
```

Zotero's `virtualized-table.jsx` always includes a column's `dataKey` in its
rendered cell's `className` (`column.className = cx(column.className,
column.dataKey, ...)`), so a cell in the Predicted column is reliably
`<span class="cell predicted ...">`. This is what makes per-column
double-click detection possible without any lower-level custom renderer.

### Routing double-click: toggle vs. edit

```ts
.setProp("onActivate", (e: Event, indices: number[]) => {
  const index = indices[0];
  const row = index !== undefined ? this.rows[index] : undefined;
  const target = (e as MouseEvent).target as Element | null;
  const isPredictedCell = !!target?.closest(".cell.predicted");

  if (row && isPredictedCell && !this.busy && !this.applied) {
    this.startCodeEdit(index, row);
    return;
  }
  for (const i of indices) {
    const r = this.rows[i];
    if (r) r.excluded = !r.excluded;
  }
  this.table?.treeInstance.invalidate();
})
```

Editing is gated on `!this.busy && !this.applied` — both flags already exist
on `DialogController` (added in `878e24c` for the scan/classify/apply
cancellation flow) — because the tree is concurrently invalidated during
those phases, which could pull the editor's anchor cell out from under it.

### Inline editor

`DialogController` gets one new private field, `activeEditor?:
HTMLInputElement`, alongside the existing `cancelButton`/`emptyState`
fields:

```ts
private startCodeEdit(index: number, row: RowState): void {
  this.closeCodeEdit(); // commit/cancel any editor already open

  const cellEl = this.win.document
    .querySelector(`#zotero-lang-cat-table-row-${index} .cell.predicted`);
  if (!(cellEl instanceof this.win.HTMLElement)) return;

  const rect = cellEl.getBoundingClientRect();
  const input = this.win.document.createElement("input");
  input.className = "zotero-lang-cat-code-editor";
  input.value = row.code ?? "";
  Object.assign(input.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });

  const commit = () => {
    if (commitCodeEdit(row, input.value)) {
      this.closeCodeEdit();
      this.table?.treeInstance.invalidate();
    } else {
      input.classList.add("invalid");
    }
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") commit();
    if (ev.key === "Escape") this.closeCodeEdit();
  });

  this.win.document.body.appendChild(input);
  input.focus();
  input.select();
  this.activeEditor = input;
}

private closeCodeEdit(): void {
  this.activeEditor?.remove();
  this.activeEditor = undefined;
}
```

### Commit/validation (pure, unit-testable)

```ts
export function commitCodeEdit(row: RowState, rawValue: string): boolean {
  const value = rawValue.trim().toLowerCase();
  if (!isIso6391Code(value)) return false;
  row.code = value;
  row.excluded = false;
  return true;
}
```

Reuses `isIso6391Code()` from `src/modules/iso639-1.ts` (already used by
`scan.ts` for the same check), so "looks like a valid ISO 639-1 code" means
exactly what it means elsewhere in this codebase. An invalid commit attempt
(Enter or blur with bad input) leaves the editor open with an `.invalid`
style rather than discarding the user's keystrokes or silently reverting;
Escape is the only way to cancel back to the prior value.

## UI changes

- `classify.css`: `cursor: text` on `.cell.predicted` cells (hover
  affordance); a small bordered style for `.zotero-lang-cat-code-editor`,
  with a red border variant for `.invalid`.
- `dialog-skip-hint` reworded to mention the low-confidence default; new
  `dialog-edit-hint` paragraph explains the Predicted column is editable.

## Localization

Fluent key changes across all four locale files:

- Remove `dialog-column-change`.
- Add `dialog-column-current`, `dialog-column-predicted`, `dialog-edit-hint`.
- Reword `dialog-skip-hint`.

English:

```ftl
dialog-skip-hint = Double-click a row to toggle whether it's applied. Low-confidence predictions (marked "?") start out excluded until you confirm them this way.
dialog-edit-hint = Double-click a predicted code to type in a different one.
dialog-column-current = Current
dialog-column-predicted = Predicted
```

German:

```ftl
dialog-skip-hint = Durch Doppelklick auf eine Zeile wird umgeschaltet, ob sie angewendet wird. Unsichere Vorhersagen (markiert mit „?“) sind zunächst ausgeschlossen, bis Sie sie auf diese Weise bestätigen.
dialog-edit-hint = Doppelklicken Sie auf einen vorhergesagten Code, um ihn direkt zu bearbeiten.
dialog-column-current = Aktuell
dialog-column-predicted = Vorhersage
```

French:

```ftl
dialog-skip-hint = Double-cliquez sur une ligne pour basculer son application. Les prédictions peu fiables (marquées « ? ») sont exclues par défaut jusqu'à ce que vous les confirmiez ainsi.
dialog-edit-hint = Double-cliquez sur un code prédit pour le modifier directement.
dialog-column-current = Actuel
dialog-column-predicted = Prédit
```

Spanish:

```ftl
dialog-skip-hint = Haga doble clic en una fila para alternar si se aplicará. Las predicciones poco fiables (marcadas con «?») se excluyen de forma predeterminada hasta que las confirme así.
dialog-edit-hint = Haga doble clic en un código predicho para editarlo directamente.
dialog-column-current = Actual
dialog-column-predicted = Predicho
```

`typings/i10n.d.ts` is scaffold-generated from the `.ftl` files; the
implementation plan regenerates it rather than hand-editing the new keys in.

## Interaction & edge cases

- Only one inline editor is open at a time; opening a new one commits or
  cancels whatever editor was already open (`closeCodeEdit()` is called
  unconditionally at the start of `startCodeEdit()`).
- Editing works even when `row.code === null` (shown as "…") — lets a user
  manually assign a code the classifier couldn't produce. Committing a
  valid code there also sets `excluded = false`, so it applies.
- Editing is disabled while `busy` (scanning, classifying, or applying) or
  once `applied` — same two flags already used to gate Cancel's behavior.
- The Current column is informational only (the item's existing language
  field before any change) and is never editable; double-click there falls
  through to the normal skip/confirm toggle.

## Testing

Pure-logic unit tests in `classify-dialog.test.ts`, following its existing
`fakeWin`/fake-classifier pattern (no real DOM needed):

- `previewRows()` sets `excluded = true` when the classifier returns
  `reliable: false`, and leaves `excluded = false` for reliable results.
- `rowData()` shows `(?)`/🚫 only when `excluded && reliable === false`, and
  neither once `excluded` is toggled back to `false`.
- `commitCodeEdit()` accepts a valid code (updates `row.code`, clears
  `excluded`) and rejects an invalid one (row unchanged, returns `false`).

The floating-input editor itself — positioning, focus, keyboard handling —
isn't exercised by this harness, consistent with the rest of this file's
tests stopping at the DOM/Zotero boundary. Manual check: open the dialog on
a mix of confident and low-confidence items; confirm low-confidence rows
start marked `(?)`/🚫; confirm double-click toggles them in and out of that
state; confirm double-click on Predicted opens an editable field pre-filled
with the current guess; confirm a valid typed code commits and clears
`(?)`/🚫; confirm an invalid code is rejected without losing the row's
state; confirm Escape cancels back to the prior value.

## Out of scope

- Autocomplete or suggestions while typing a code.
- Editing the Current column.
- Any change to the Apply/Done button flow.
- A language-name picker UI instead of raw code entry.
