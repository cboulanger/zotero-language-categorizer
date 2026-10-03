# Apply progress popup — Design

Date: 2026-10-03

## Purpose

The classify dialog's `classify()` phase already shows a native Zotero
progress popup (see `2026-10-02-classify-progress-popup-design.md`) because,
for large libraries, the per-row status column alone doesn't make visible
progress clear once the table has more rows than fit on screen. The Apply
phase (`runApply()`) has the same problem — it writes changes row-by-row via
`item.saveTx()`, which touches the database and can be slow for large
batches — but currently shows no popup, only the same per-row status glyph.
The prior spec explicitly scoped Apply out "since saving is comparatively
fast"; in practice it is slow enough on large collections to warrant the same
treatment. This spec extends the progress popup to Apply and factors out the
shared logic so both phases stay consistent.

## Scope

- Add a progress popup to `runApply()` in
  `src/modules/dialog/classify-dialog.ts`, matching `classify()`'s popup
  behavior (headline, running `x/y` counter, progress bar, 2s auto-close).
- Factor the duplicated "popup + chunked loop + progress updates + yield +
  close timer" logic out of `classify()` and `runApply()` into one shared
  helper function, since both methods become near-identical once Apply gets
  the same popup. This is a one-time dedup enabled by this change, not a
  separate task.
- Does **not** change the chunk size, the yield cadence, the close-timer
  duration, or any existing error handling in either method.

## Implementation

New module-level function in the same file, alongside `chunk()`:

```ts
async function runWithProgress<T>(
  win: Window,
  rows: T[],
  headline: string,
  work: (group: T[]) => void | Promise<void>,
): Promise<void> {
  const total = rows.length;
  const progress = new ProgressWindowHelper(headline)
    .createLine({
      text: getString("progress-items-processed", {
        args: { current: 0, total },
      }),
      progress: 0,
    })
    .show(-1);
  try {
    let processed = 0;
    for (const group of chunk(rows, CHUNK_SIZE)) {
      await work(group);
      processed += group.length;
      progress.changeLine({
        text: getString("progress-items-processed", {
          args: { current: processed, total },
        }),
        progress: Math.round((processed / total) * 100),
      });
      await new Promise((r) => win.setTimeout(r, 0));
    }
  } finally {
    progress.startCloseTimer(2000);
  }
}
```

`classify()` becomes:

```ts
async classify(actionButton: HTMLButtonElement): Promise<void> {
  try {
    const classifier = getClassifier();
    await runWithProgress(
      this.win,
      this.rows,
      getString("progress-classify-headline"),
      (group) => {
        previewRows(group, classifier);
        this.table?.treeInstance.invalidate();
      },
    );
  } finally {
    actionButton.disabled = false;
  }
}
```

`runApply()` becomes:

```ts
async runApply(): Promise<void> {
  const toApply = this.rows.filter((r) => r.code && !r.excluded);
  await runWithProgress(
    this.win,
    toApply,
    getString("progress-apply-headline"),
    async (group) => {
      for (const row of group) {
        try {
          (row.item as ApplyableItem).setField("language", row.code!);
          await (row.item as ApplyableItem).saveTx();
          row.status = "success";
        } catch (e) {
          row.status = "error";
        }
        this.table?.treeInstance.invalidate();
      }
    },
  );
}
```

Both call sites keep their own caller-specific bits outside the helper:
`classify()` still disables/re-enables `actionButton` in its own `finally`
(unrelated to the popup's lifecycle), and `onApplyClick()` is unchanged —
`runApply()`'s signature and behavior from its caller's point of view (an
awaited `Promise<void>` with `row.status` mutated in place) stay the same.

If `toApply` is empty (all rows excluded or unclassified), `runWithProgress`
still runs with `total = 0`: the popup briefly shows "0/0 items processed"
and closes after 2s. This is an existing edge case already reachable today
(a user can exclude every row before clicking Apply) and isn't worth a
special-cased guard — consistent with the prior spec's choice not to
special-case small batches for `classify()`.

## Localization

One new Fluent key, added to all four locale files
(`addon/locale/{en-US,de,fr,es}/addon.ftl`), reusing the existing
`progress-items-processed` string for the per-chunk line:

```ftl
progress-apply-headline = Applying language changes…
```

- de: `Sprachänderungen werden übernommen…`
- fr: `Application des modifications de langue en cours…`
- es: `Aplicando los cambios de idioma…`

`typings/i10n.d.ts` is scaffold-generated from the `.ftl` files; the
implementation plan regenerates it rather than hand-editing the new key in.

## Error handling

Unchanged from today: a per-row `saveTx()` failure is still caught inside
the per-row `try/catch` in `runApply()`'s `work` callback and recorded as
`row.status = "error"`; it does not throw out of the chunk loop or abort
remaining rows. `runWithProgress`'s `finally` guarantees the popup's close
timer starts even if `work` throws (it doesn't, by the above), matching
`classify()`'s existing guarantee.

## Testing

Same as the prior spec: this touches the live `Zotero`/toolkit globals and
isn't unit-testable in isolation, consistent with
`classify-dialog.test.ts` covering only the pure helpers. Manual check: open
the classify dialog on a collection with enough items to span multiple
50-row chunks, click Apply, confirm the popup appears immediately with its
own headline (distinct from the classify popup's), the counter and bar
advance chunk-by-chunk, and it auto-closes ~2 seconds after the last row is
saved. Also verify the classify popup still behaves identically after the
refactor (same headline, same counter behavior) — a regression check for the
`runWithProgress` extraction.

## Out of scope

- A row-count threshold below which the popup is suppressed.
- Per-item (vs. per-chunk) progress granularity.
- Any change to `onApplyClick()`'s button-disabling/relabeling behavior.
