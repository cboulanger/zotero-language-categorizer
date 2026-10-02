# Zotero Language Categorizer — Design

Date: 2026-10-02

## Purpose

A lightweight Zotero plugin that detects the natural language of each item's
title + abstract and writes the result into the item's `language` field, for
items that don't already have one set. Existing `language` values are never
touched.

## Scope decisions

- **Which items get scanned:** whatever is currently displayed in the middle
  pane for the user's current left-pane selection (a collection, a saved
  search, or "My Library"), not a separate picker in the dialog. This reuses
  Zotero's own collection/subcollection/search/trash rules for free.
- **Trigger:** a single "Classify Item Languages…" entry under the Tools menu.
  No context-menu entry, no toolbar button.
- **Eligible item filter:** `item.isRegularItem()` (excludes notes,
  attachments, annotations), item's library is editable (excludes read-only
  group libraries), `item.getField('language')` is empty, and the item has a
  non-empty title or abstract to classify on.
- **Low-confidence predictions:** shown in the preview, visually marked as
  low-confidence (not hidden, not excluded). The user applies all shown
  predictions as a batch; there's no per-row include/exclude checkbox in v1.
- **Overwrite policy:** never. The eligibility filter itself excludes any item
  with a non-empty `language` field, so there's no separate confirmation step
  for overwriting.

## Classifier — research and recommendation

Requirement: a pure-JS (no native/WASM deps, since Zotero's chrome JS
environment is a Firefox/Gecko engine) language detector, small enough to
bundle, accurate enough on short strings (titles are often only a few words),
and ideally emitting a format close to what Zotero's `language` field expects.

Options considered:

| Library | Size | Accuracy on short text | Output format | Maintenance |
|---|---|---|---|---|
| **eld** (`efficient-language-detector-js`) | XS model: 940KB raw / ~264KB gzipped | Good; ships `isReliable()` confidence flag | **ISO 639-1** directly (e.g. `"en"`) | Active (v2.0.3 at time of writing, Apache-2.0) |
| tinyld | 68–110KB (web build) | Best raw accuracy (~95% at 24 chars) in its own benchmarks | own codes, would need a mapping table | Inactive 3+ years (algorithm is static data, so not fatal, but no bugfixes/updates) |
| franc-min | 119KB | Weakest on short text (~65% in third-party benchmarks) | ISO 639-3, needs mapping to 639-1 | Actively maintained, widely used (unified/remark ecosystem) |

**Decision: `eld`, using its XS language-frequency database.** It is the only
option that is simultaneously actively maintained, emits Zotero-ready ISO
639-1 codes with no mapping table needed, and has a built-in reliability
signal that directly drives the low-confidence marker in preview. It's pure
JS/ESM with no WASM or native bindings, safe to bundle into a Zotero 8+
chrome script via the build's bundler.

Classification input: `title + "\n" + abstractNote` (whichever are present)
passed to `eld.detect()`. The returned `{ language, isReliable() }` becomes
`{ code, reliable }` in our wrapper.

## Zotero plugin architecture & scaffolding

### Scaffold choice

Use windingwind's **`zotero-plugin-template`** (TypeScript +
`zotero-plugin-scaffold` + `zotero-plugin-toolkit`, with hot reload), not the
plain-JS no-build scaffold. Reason: this plugin needs a real dialog built on
`VirtualizedTableHelper`, which is a toolkit feature — the template wires up
the toolkit, the bundler (esbuild), and the dev/hot-reload loop that a
plain-JS plugin would have to hand-roll.

### Target versions

- `strict_min_version`: `8.0` (uses `Zotero.MenuManager`, which is Zotero
  8+ only; no Zotero 7 DOM-injection fallback — keeps the plugin small and
  avoids maintaining two menu-registration code paths for a one-entry menu).
- `strict_max_version`: pinned to the newest minor actually tested (currently
  Zotero 10, e.g. `10.0.*`), bumped via `updates.json` as later versions are
  verified, per standard Zotero plugin practice.

### Plugin identity

- Plugin ID: `zotero-language-categorizer@cboulanger.github.io` (placeholder
  domain — adjust to the actual publishing location before release).
- Namespace prefix (element IDs, Fluent IDs, pref keys, CSS classes):
  `zotero-lang-cat`.
- Pref branch: `extensions.zotero-lang-cat.*` (currently unused — this plugin
  has no persisted settings in v1, since the only configurable aspect, scope,
  is derived from the current pane selection rather than stored).

### Directory layout

```
zotero-language-categorizer/
├── manifest.json
├── bootstrap.ts                     # lifecycle hooks (startup/shutdown/window load+unload)
├── src/
│   ├── classifier.ts                # wraps `eld`; classify(title, abstract) -> {code, reliable} | null
│   ├── scan.ts                      # reads active pane's current item list, applies eligibility filter
│   └── dialog/
│       ├── classify.xhtml           # dialog document (VirtualizedTableHelper host)
│       └── classify.ts              # dialog controller: Preview/Apply/Close wiring, chunked processing
├── locale/
│   └── en-US/
│       └── zotero-language-categorizer.ftl
├── style.css                        # dialog layout (flex container, sticky header — see toolkit requirements)
└── docs/
    └── superpowers/
        ├── specs/                   # this file and future design docs
        └── plans/                  # implementation plans (writing-plans skill output)
```

(The template's own build/config files — `package.json`,
`zotero-plugin-config.ts`, `tsconfig.json`, etc. — sit alongside these per the
template's own conventions; not enumerated here since they're scaffolded, not
hand-designed.)

### Lifecycle

- `startup({ id, version, rootURI })`: registers the Tools-menu entry via
  `Zotero.MenuManager.registerMenu` (target `main/menubar/tools`), with an
  `onCommand` that calls into `scan.ts` then opens the dialog.
- `onMainWindowLoad` / `onMainWindowUnload`: not needed beyond what
  `MenuManager` already handles automatically per-window.
- `shutdown(data, reason)`: `if (reason === APP_SHUTDOWN) return;` short
  circuit; otherwise closes any open classify dialog via
  `Services.wm.getEnumerator("zotero-lang-cat:dialog")`. `MenuManager`
  unregisters its own menu entry automatically on shutdown by plugin ID, so no
  manual menu cleanup is required.

### Dialog implementation

- XHTML document with `windowtype="zotero-lang-cat:dialog"`, opened via
  `window.openDialog("chrome://zotero-language-categorizer/content/dialog/classify.xhtml", ...)`.
- Includes the two extra stylesheets `VirtualizedTableHelper` requires
  (`zotero-react-client.css`, `zotero.css`) and the flex/min-height container
  CSS the toolkit docs specify, so the table renders as rows instead of
  stacking vertically.
- Table columns: Title (flex, truncated), Item Type (fixed), Detected
  Language (fixed, filled in after Preview, blank before), Confidence (fixed,
  shows a distinct marker when `!reliable`), Status (fixed-width, custom
  `renderer` that paints nothing → a spinner-like placeholder during Apply →
  a green check or red X once that row's write resolves or fails). The status
  column is the progress indicator; there's no separate progress bar.
- Buttons: **Close** (always enabled, closes the dialog) and a single button
  that is **Preview** before classification has run, and becomes **Apply**
  once Preview completes — same button, label and handler swapped, not two
  separate buttons.
- Preview and Apply both process the item list in small chunks (e.g. 50 items
  at a time) with a yield (`await new Promise(r => setTimeout(r, 0))`) between
  chunks, calling `table.treeInstance.invalidateRow(i)` per updated row, so
  the UI stays responsive on large collections without needing to virtualize
  the processing itself (the table is already virtualized for rendering).

## Data flow

1. User clicks the Tools-menu entry.
2. `scan.ts` reads the items currently shown in the active pane (respecting
   the user's current collection/search/sort/subcollection settings) and
   filters to eligible items as defined above.
3. Dialog opens with one row per eligible item; Detected/Confidence/Status
   columns start blank. If there are zero eligible items, Preview is disabled
   and an empty-state message is shown instead of the table.
4. **Preview**: classify each row's `title + abstractNote` via
   `classifier.ts`, fill in Detected Language and the confidence marker,
   `invalidateRow` as each completes. On completion, the button switches to
   **Apply**.
5. **Apply**: for each row with a prediction, `item.setField('language', code)`
   then `await item.saveTx()`; on success paint a green check in Status and
   `invalidateRow`; on a thrown error (e.g. the item was concurrently
   modified or deleted) paint a red marker instead and continue to the next
   row — one failure never aborts the batch.
6. **Close** is available at every stage. Before Preview it's a no-op exit.
   After Preview it discards in-memory predictions without writing anything.
   During/after Apply, whatever has already been saved stays saved — each
   item's write is its own transaction, not one all-or-nothing batch.

## Error handling

- Read-only (group) libraries are excluded at the scan step; their items
  never appear in the dialog.
- A per-item save failure during Apply is caught, that row gets an error
  marker, and processing continues with the next row.
- If the plugin is disabled/shut down while the dialog is open, `shutdown()`
  closes it via the `windowtype` lookup.

## Testing

- Unit tests for `classifier.ts` as a pure function: sample strings across
  several languages, short-title-only inputs (to exercise the low-confidence
  path), empty/whitespace-only input (must return `null`, not throw).
- Manual verification checklist in a dedicated dev Zotero profile:
  - Library with items in several languages, some with `language` already
    set (must remain untouched after Apply).
  - Title-only items (no abstract) — low-confidence marker should appear.
  - A read-only group library — its items never appear in the dialog.
  - A large collection (hundreds+ items) — Preview/Apply stay responsive,
    scrolling the virtualized table stays smooth.
  - Disable → re-enable the plugin, and close → reopen the main window — no
    duplicate Tools-menu entries.

## Out of scope (v1)

- Per-row include/exclude checkboxes before Apply.
- A separate scope picker inside the dialog (library/collection dropdown).
- Persisted preferences/pref pane (nothing to configure yet).
- Re-classifying items that already have a `language` value.
