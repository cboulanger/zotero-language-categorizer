# Footer options: overwrite existing data / convert other codes — Design

Date: 2026-10-03
Status: Approved

## Purpose

Today the dialog only ever fills in _missing_ language data: `isEligible()`
(`src/modules/scan.ts`) drops every item whose `language` field already holds
a valid ISO 639-1 code, and items with anything else (empty, `deu`, `German`)
are overwritten with the detected code. Users need explicit control:

1. Never touch existing data unless they say so.
2. Normalize legacy values (`deu`, `fra`, `German`, …) to the two-letter code
   instead of re-detecting them (detection on a short title can disagree with
   what the user entered).

## UI

Two checkboxes are inserted in the footer (`classify.xhtml`,
`.zotero-lang-cat-button-row`), to the left of the Cancel button:

| id                              | label (en-US)           | default |
| ------------------------------- | ----------------------- | ------- |
| `zotero-lang-cat-opt-overwrite` | Overwrite existing data | off     |
| `zotero-lang-cat-opt-convert`   | Convert other codes     | off     |

Labels come from `addon.ftl` (`dialog-opt-overwrite`, `dialog-opt-convert`;
de/es/fr translated too). Layout: checkboxes left-aligned, buttons
right-aligned (`margin-inline-end: auto` on the options group). State is not
persisted between dialog openings.

## Row semantics

Let `current` be the item's `language` field (trimmed) and `detected` the
classifier result. Each row gets exactly one outcome:

| `current`                                       | convert | overwrite | outcome (`row.code`)                    |
| ----------------------------------------------- | :-----: | :-------: | --------------------------------------- |
| empty                                           |    –    |     –     | `detected` (fill)                       |
| valid ISO 639-1 (`fr`, `en-US`)                 |    –    |    off    | none — row skipped, left untouched      |
| valid ISO 639-1                                 |    –    |    on     | `detected`                              |
| not valid 639-1, **mappable** (`deu`, `German`) |   on    |     –     | the mapped 2-letter code (no detection) |
| not valid 639-1, mappable                       |   off   |    off    | none — skipped                          |
| not valid 639-1, mappable                       |   off   |    on     | `detected`                              |
| not valid 639-1, **not mappable** (`xyz`)       |    –    |    off    | none — skipped                          |
| not valid 639-1, not mappable                   |    –    |    on     | `detected`                              |

Rule of thumb: a non-empty field is only changed if _convert_ applies to it or
_overwrite_ is on; convert wins over overwrite for mappable values (a
conversion is lossless, detection isn't). Skipped rows are shown greyed with
"unchanged" in the Change column and are never written.

`overwrite` off therefore changes current behaviour for non-empty,
non-639-1, non-mappable values (previously overwritten, now left alone). This
is intentional and noted in the changelog.

## Mapping

Reuse the maintained [`iso-639-3`](https://www.npmjs.com/package/iso-639-3)
npm package (MIT) instead of hand-typing tables. Only its small subpath
modules are imported (`iso6393-to-1`, `iso6393-to-2b`, `iso6393-to-2t`, ~15 KB
total), not the 780 KB full dataset. From them a lookup index is built once:

- 639-3 (`deu`), 639-2/B (`ger`), 639-2/T (`deu`) → 639-1 (`de`)
- language names (`German`, `Deutsch`) → 639-1, via `Intl.DisplayNames` over
  the 184 known 639-1 codes in English and the Zotero UI locale (reverse
  index; no extra data shipped).

API: `convertLanguageValue(value: string): string | null` — case-insensitive,
trims; a region/script subtag is kept for 639-1 values only (those are not
converted); for 3-letter and name input the result is the bare 2-letter
code. Returns `null` if unmappable.

## Data flow changes

- `getScopedEligibleItems()` no longer filters on existing language; the
  dialog receives all regular, editable items with a title/abstract
  (`isEligible` loses its 639-1 check; the empty-state text changes to
  "No items found in the current view").
- Classification (expensive) still runs once on open for every row. Changing
  a checkbox only recomputes `row.code` / skip state from cached
  `detected` + `current` and invalidates the table — no re-classification.
  `RowState` gains `detected`, `reliable`, and a derived `skipReason`.
- `runApply()` writes only rows with `row.code && !row.excluded`
  (unchanged); skipped rows have no code.

## Apply button state

The Apply button is enabled only when all of the following hold:

1. classification has finished (not while the progress popup is running),
2. at least one row has a pending change under the current checkbox settings
   (toggling the checkboxes re-evaluates this live),
3. changes have not already been applied (existing "Done" behaviour).

(The request says "enabled if all the right is enabled" — I read this as
"all conditions are met". Please correct if something else was meant.)

**Checkbox dependency (decided):** "Convert other codes" is only enabled
while "Overwrite existing data" is checked, since converting changes existing
data. Unchecking overwrite also unchecks and disables convert. Consequently,
unless overwrite is on, no existing data is ever touched (decided).

After applying, both checkboxes and Cancel are disabled (as Cancel is today).

## Testing

Unit (mocha, `test/`): `convertLanguageValue` table cases; row-outcome matrix
above (pure function `resolveRow(current, detected, opts)` in `scan.ts` or a
new module); Apply-enabled logic; `isEligible` without the 639-1 filter.
Manual checklist: toggling checkboxes updates the table and button without
re-running the progress popup.
