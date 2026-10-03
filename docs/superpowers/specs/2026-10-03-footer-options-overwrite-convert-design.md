# Footer options: overwrite existing data / convert other codes — Design

Date: 2026-10-03
Status: Draft, awaiting review

## Purpose

Today the dialog only ever fills in *missing* language data: `isEligible()`
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

| id                                  | label (en-US)             | default |
| ----------------------------------- | ------------------------- | ------- |
| `zotero-lang-cat-opt-overwrite`     | Overwrite existing data   | off     |
| `zotero-lang-cat-opt-convert`       | Convert other codes       | off     |

Labels come from `addon.ftl` (`dialog-opt-overwrite`, `dialog-opt-convert`;
de/es/fr translated too). Layout: checkboxes left-aligned, buttons
right-aligned (`margin-inline-end: auto` on the options group). State is not
persisted between dialog openings.

## Row semantics

Let `current` be the item's `language` field (trimmed) and `detected` the
classifier result. Each row gets exactly one outcome:

| `current`                                   | convert | overwrite | outcome (`row.code`)                          |
| ------------------------------------------- | :-----: | :-------: | --------------------------------------------- |
| empty                                       |    –    |     –     | `detected` (fill)                             |
| valid ISO 639-1 (`fr`, `en-US`)             |    –    |   off     | none — row skipped, left untouched            |
| valid ISO 639-1                             |    –    |   on      | `detected`                                    |
| not valid 639-1, **mappable** (`deu`, `German`) | on  |     –     | the mapped 2-letter code (no detection)       |
| not valid 639-1, mappable                   |   off   |   off     | none — skipped                                |
| not valid 639-1, mappable                   |   off   |   on      | `detected`                                    |
| not valid 639-1, **not mappable** (`xyz`)   |    –    |   off     | none — skipped                                |
| not valid 639-1, not mappable               |    –    |   on      | `detected`                                    |

Rule of thumb: a non-empty field is only changed if *convert* applies to it or
*overwrite* is on; convert wins over overwrite for mappable values (a
conversion is lossless, detection isn't). Skipped rows are shown greyed with
"unchanged" in the Change column and are never written.

`overwrite` off therefore changes current behaviour for non-empty,
non-639-1, non-mappable values (previously overwritten, now left alone). This
is intentional and noted in the changelog.

## Mapping

Source of truth, in order of preference — **to be verified in a Zotero 7
runtime before implementation; the mapping must not be hand-typed if Zotero
already ships it**:

1. Zotero's bundled CSL locale metadata (`locales.json`, `language-names`)
   for English/native names → BCP 47 codes.
2. Gecko `Intl.DisplayNames` (localized names → code) as a reverse index
   built once per dialog open.
3. Fallback: a small bundled `src/modules/iso639-convert.ts` table for ISO
   639-2/B, 639-2/T and 639-3 three-letter codes → 639-1 (`deu`/`ger` → `de`,
   `fra`/`fre` → `fr`, …). Neither source above covers three-letter codes, so
   this table is expected to exist regardless; it only covers languages that
   have a 639-1 code (~184 entries).

API: `convertLanguageValue(value: string): string | null` — case-insensitive,
trims, returns the 2-letter primary subtag or `null` if unmappable. Region
subtags on 3-letter input are dropped (`deu-DE` → `de`) unless the target
already has a region form in use (out of scope).

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

After applying, both checkboxes and Cancel are disabled (as Cancel is today).

## Testing

Unit (mocha, `test/`): `convertLanguageValue` table cases; row-outcome matrix
above (pure function `resolveRow(current, detected, opts)` in `scan.ts` or a
new module); Apply-enabled logic; `isEligible` without the 639-1 filter.
Manual checklist: toggling checkboxes updates the table and button without
re-running the progress popup.

## Open questions

1. Meaning of "all the right is enabled" (see above).
2. Should convert also apply when the *detected* code is a different language
   than the converted one? Spec says no (convert wins, no detection).
3. OK that overwrite-off now preserves unmappable free-text values?
