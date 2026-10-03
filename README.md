# Zotero Language Categorizer

[![Zotero target version](https://img.shields.io/badge/Zotero-8--10-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue?style=flat-square)](LICENSE)

A lightweight [Zotero](https://www.zotero.org/) plugin that detects the
language of each item's title and abstract and fills in the item's
**Language** field with the matching [ISO 639-1](https://en.wikipedia.org/wiki/ISO_639-1)
code — the format Zotero's citation style processor expects.

## For users

### What it does

Many Zotero libraries end up with language metadata that's either missing or
not usable by citation processors — an empty Language field, or a spelled-out
name like "German" instead of a code like `de`. This plugin finds those
items, runs the title/abstract through a language detector, and lets you
review and apply the detected codes in one batch.

- By default only items with an **empty** Language field are changed;
  anything already filled in — `fr`, "French", `deu` — is left alone. Two
  checkboxes in the dialog's footer relax this:
  - **Overwrite existing data** — also replaces non-empty values with the
    detected code.
  - **Convert other codes** (only available with overwrite on) — instead of
    re-detecting, turns legacy values into their ISO 639-1 code: three-letter
    ISO 639-2/639-3 codes (`deu`, `ger`, `fra`) and spelled-out language
    names (`German`). Values that can't be mapped fall back to detection.
- Nothing is written until you click **Apply** — the dialog shows every
  change (`old value → new value`) before you commit to it.
- Works on whatever you currently have selected in Zotero's left pane: a
  single collection, a saved search, or "My Library" for everything.

### Installing

1. Download the latest `.xpi` from this repository's
   [Releases](../../releases) page.
2. In Zotero: **Tools → Plugins**, click the gear icon, choose
   **Install Plugin From File…**, and select the downloaded `.xpi` (or just
   drag the file onto the main Zotero window).
3. Requires Zotero 8 or later.

Once installed, the plugin checks the same stable update URL on every
Zotero startup and will offer new versions automatically, the same way any
other Zotero plugin does.

### Using it

1. Select a collection, saved search, or "My Library" in Zotero's left pane.
2. **Tools → Classify Item Languages…**
3. The dialog opens and immediately classifies every eligible item in that
   view. Optionally tick **Overwrite existing data** and/or **Convert other
   codes**; the table and the Apply button update instantly. Rows that won't
   change are greyed out and marked "unchanged", and Apply stays disabled
   until at least one row will change. Each row shows the item's creator(s), title, and the proposed
   change (e.g. `German → de`); a `(?)` after a code means the detector
   wasn't fully confident, but still shows its best guess.
4. Click **Apply**. A green checkmark appears next to each item as its
   Language field is updated; a red mark means that one item failed (e.g. it
   was modified or removed elsewhere in the meantime) — everything else
   still goes through.
5. **Cancel** closes the dialog at any point without writing anything that
   hasn't already been applied.

## For developers

### Classifier

Language detection uses [`eld`](https://github.com/nitotm/efficient-language-detector-js)
(Efficient Language Detector), specifically its `extrasmall` (XS) database —
a small (~264 KB gzipped), actively maintained, pure-JS detector that emits
ISO 639-1 codes directly and flags low-confidence predictions via
`isReliable()`. It was chosen over alternatives like `tinyld` (better raw
accuracy but unmaintained for 3+ years) and `franc-min` (weaker on short
text, emits ISO 639-3 and needs a mapping table) — see
[the design spec](docs/superpowers/specs/2026-10-02-zotero-language-categorizer-design.md)
for the full comparison.

The classifier sits behind a small adapter interface
(`src/modules/classifiers/types.ts`) rather than being called directly, so a
different or additional detector can be registered later without touching
the scan or dialog code:

```ts
interface LanguageClassifier {
  id: string;
  classify(text: string): { code: string; reliable: boolean } | null;
}
```

`getClassifier(id?)` (`src/modules/classifiers/index.ts`) is a small
registry/factory over this — currently only `eld` is registered, and the
`id` parameter is unused, but it's already the extension point for a future
preference letting users pick a classifier.

### Architecture

- `src/modules/scan.ts` — eligibility filter. `isEligible()` is a pure
  function (unit-testable without Zotero) checking: regular item, editable
  library, and non-empty title/abstract. The existing Language value is
  deliberately _not_ filtered here — whether it may be changed depends on the
  dialog's footer options. `getScopedEligibleItems()` is the thin
  live-Zotero wrapper that pulls from `ZoteroPane.getSortedItems()`.
- `src/modules/iso639-1.ts` — validity check against the standard 184-code
  ISO 639-1 set (case-insensitive, ignoring region/script subtags).
- `src/modules/iso639-convert.ts` — `convertLanguageValue()` maps legacy
  values to ISO 639-1. Three-letter codes (639-3, 639-2/B, 639-2/T) come from
  the [`iso-639-3`](https://www.npmjs.com/package/iso-639-3) package (only its
  small subpath tables are imported); language names are reverse-looked-up
  through `Intl.DisplayNames` in English and the Zotero locale.
- `src/modules/dialog/classify-dialog.ts` — the dialog controller. Builds row
  state, runs classification in chunks (yielding between them so the UI
  stays responsive on large collections), drives the
  [`VirtualizedTableHelper`](https://github.com/windingwind/zotero-plugin-toolkit)
  table, resolves each row's outcome from its current value, the cached
  detection and the footer options (`resolveRow()`; classification runs once,
  toggling a checkbox only re-resolves), and applies writes (`item.setField('language', code)` +
  `item.saveTx()`) on Apply. The dialog window is idempotent — triggering
  the menu entry again while it's open just focuses the existing window.
- `addon/content/dialog/classify.xhtml` / `classify.css` — the dialog's
  markup and styling (flat/modern, header/body/footer layout with only the
  table panel scrolling).
- `src/utils/locale.ts` — Fluent (`.ftl`) string lookup. Every label in the
  dialog and the Tools-menu entry is translatable; translations live in
  `addon/locale/<locale>/addon.ftl` (currently `en-US`, `de`, `fr`, `es`).

The full rationale behind these decisions — including a few non-obvious
fixes discovered along the way (a Gecko chrome-dialog layout quirk, a
cross-scope bug in Fluent string lookup) — is written up in
[`docs/superpowers/specs/`](docs/superpowers/specs/).

### Project origin & tooling

This plugin was scaffolded from
[windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
(TypeScript + [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) +
[zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit) +
[zotero-types](https://github.com/windingwind/zotero-types)), and keeps that
scaffold's bootstrap architecture, build pipeline, and dev/test tooling
as-is. One thing it does **not** keep: the template's own release command.
**Releases here are driven by
[semantic-release](https://semantic-release.gitbook.io/) and
[Conventional Commits](https://www.conventionalcommits.org/) instead of the
scaffold's interactive `bumpp`-based `release` script** — see
[Releasing](#releasing) below.

### Setup

```sh
npm install
cp .env.example .env
# edit .env: point ZOTERO_PLUGIN_ZOTERO_BIN_PATH at your Zotero binary,
# and ZOTERO_PLUGIN_PROFILE_PATH at a *dedicated dev profile*
# (create one with `/path/to/zotero -p`) — don't point this at your
# real Zotero profile.
```

### Common commands

| Command              | What it does                                                          |
| -------------------- | --------------------------------------------------------------------- |
| `npm start`          | Build, launch Zotero with the dev profile, hot-reload on file changes |
| `npm run build`      | Production build (`.xpi` in `.scaffold/build/`) + `tsc --noEmit`      |
| `npm test`           | Run the test suite — inside an actual headless Zotero instance        |
| `npm run lint:check` | Prettier + ESLint, no changes written                                 |
| `npm run lint:fix`   | Prettier + ESLint, auto-fixing what it can                            |
| `npm run commit`     | Guided prompt (commitizen) for a Conventional Commits message         |

### Testing

Tests (`test/**/*.test.ts`, Mocha + Chai) run inside a real, temporary
Zotero instance via `zotero-plugin-scaffold`'s test harness — not a
Node-only mock — so they exercise the actual classifier (`eld`) and the
plugin's real startup path. Pure logic (`isEligible`, `isIso6391Code`, `convertLanguageValue`,
`buildRows`/`previewRows`/`resolveRow`, `formatCreators`) is unit-tested directly; code
that only makes sense against a live Zotero window (the dialog's rendering,
menu registration) is covered by the manual checklist in the design spec
instead.

### Releasing

Commit messages decide releases — there's no manual version prompt:

1. Write commits following Conventional Commits (`feat: …`, `fix: …`, a
   `BREAKING CHANGE:` footer, etc.). A Husky `commit-msg` hook runs
   `commitlint` and rejects anything that doesn't conform;
   `npm run commit` gives you a guided prompt if you'd rather not write the
   header by hand.
2. Push to `main`. Once CI (`.github/workflows/ci.yml`: lint, build, test)
   passes, `.github/workflows/release.yml` runs `semantic-release`, which:
   - Decides whether a release is warranted and what kind (`fix:` → patch,
     `feat:` → minor, a breaking-change footer → major; anything else →
     no release).
   - Generates `CHANGELOG.md` from those commits.
   - Bumps `package.json`'s version (never published to the npm registry —
     this isn't an npm package).
   - Updates `updates.json` and builds the `.xpi`.
   - Commits the version bump and changelog back to `main`.
   - Creates the GitHub Release and uploads the `.xpi`.

Zotero's installed copy of the plugin polls a stable URL —
`https://raw.githubusercontent.com/<owner>/<repo>/main/updates.json` — which
always points at the latest release's `.xpi`, so the download link in step 2
above never goes stale.

## License

AGPL-3.0-or-later. See [`LICENSE`](LICENSE).
