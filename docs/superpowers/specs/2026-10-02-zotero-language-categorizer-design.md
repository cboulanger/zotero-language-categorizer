# Zotero Language Categorizer — Design

Date: 2026-10-02

## Purpose

A lightweight Zotero plugin that detects the natural language of each item's
title + abstract and writes the result into the item's `language` field, for
items that don't already have a valid ISO 639-1 code there. A field that's
empty, or holds something other than a real code (e.g. a spelled-out name
like "German" instead of "de"), is in scope; a field that already holds a
recognized code is left untouched.

## Scope decisions

- **Which items get scanned:** whatever is currently displayed in the middle
  pane for the user's current left-pane selection (a collection, a saved
  search, or "My Library"), not a separate picker in the dialog. This reuses
  Zotero's own collection/subcollection/search/trash rules for free.
- **Trigger:** a single "Classify Item Languages…" entry under the Tools menu.
  No context-menu entry, no toolbar button.
- **Eligible item filter:** `item.isRegularItem()` (excludes notes,
  attachments, annotations), item's library is editable (excludes read-only
  group libraries), the item has a non-empty title or abstract to classify
  on, and `item.getField('language')` is either empty or not a recognized
  ISO 639-1 code (see "Overwrite policy" below).
- **Low-confidence predictions:** shown in the preview, visually marked as
  low-confidence (not hidden, not excluded). The user applies all shown
  predictions as a batch; there's no per-row include/exclude checkbox in v1.
- **Overwrite policy:** a `language` field is only left untouched when it
  already holds a recognized ISO 639-1 code (optionally with a region/script
  subtag, e.g. `en-US`) — checked against the standard 184-code ISO 639-1
  set, case-insensitively, by primary subtag. Anything else in that field
  (empty, or a spelled-out name like "German", "English") is in scope and
  gets overwritten on Apply. This was widened from the original "never
  touch a non-empty field" rule after discovering many real libraries store
  full language names rather than codes — those are exactly the entries the
  user wants corrected, not skipped. Because this now performs real
  overwrites (not just blank-fills), the dialog's **Change** column shows
  `old value → new value` for every row, so Apply's effect is visible before
  it runs.

## Classifier — research and recommendation

Requirement: a pure-JS (no native/WASM deps, since Zotero's chrome JS
environment is a Firefox/Gecko engine) language detector, small enough to
bundle, accurate enough on short strings (titles are often only a few words),
and ideally emitting a format close to what Zotero's `language` field expects.

Options considered:

| Library                                    | Size                                 | Accuracy on short text                                     | Output format                         | Maintenance                                                                         |
| ------------------------------------------ | ------------------------------------ | ---------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| **eld** (`efficient-language-detector-js`) | XS model: 940KB raw / ~264KB gzipped | Good; ships `isReliable()` confidence flag                 | **ISO 639-1** directly (e.g. `"en"`)  | Active (v2.0.3 at time of writing, Apache-2.0)                                      |
| tinyld                                     | 68–110KB (web build)                 | Best raw accuracy (~95% at 24 chars) in its own benchmarks | own codes, would need a mapping table | Inactive 3+ years (algorithm is static data, so not fatal, but no bugfixes/updates) |
| franc-min                                  | 119KB                                | Weakest on short text (~65% in third-party benchmarks)     | ISO 639-3, needs mapping to 639-1     | Actively maintained, widely used (unified/remark ecosystem)                         |

**Decision: `eld`, using its XS language-frequency database.** It is the only
option that is simultaneously actively maintained, emits Zotero-ready ISO
639-1 codes with no mapping table needed, and has a built-in reliability
signal that directly drives the low-confidence marker in preview. It's pure
JS/ESM with no WASM or native bindings, safe to bundle into a Zotero 8+
chrome script via the build's bundler.

Classification input: `title + "\n" + abstractNote` (whichever are present)
passed to `eld.detect()`. The returned `{ language, isReliable() }` becomes
`{ code, reliable }` in our wrapper.

### Classifier adapter architecture

`eld` is wired in behind a small adapter interface, not called directly from
`scan.ts`/the dialog, so a different classifier can be swapped in later
without touching anything else. v1 ships only the `eld` adapter and no
config/UI for choosing between adapters — but the factory already takes a
classifier id, so adding a second adapter plus a pref-backed selector later
is a matter of registering it, not restructuring.

`reliable` is a `boolean`, not a numeric `0–1` confidence, deliberately:
`eld`'s `getScores()` values are an internal relative ranking, not documented
as calibrated probabilities (they don't sum to 1), and `isReliable()`'s own
threshold is undisclosed. Exposing a numeric confidence here would mean
fabricating a normalization eld doesn't actually provide. The boolean asks
each adapter the one question it can honestly answer — "is this good enough
to trust" — in whatever terms fit its own algorithm, rather than forcing
every future adapter's internal metric onto one normalized scale that may
not mean the same thing across algorithms. The trade-off: a future adapter
with genuinely calibrated probabilities would have to collapse that number
down to `true`/`false` to fit this interface, losing it for things like
sorting by confidence or a user-adjustable threshold — acceptable for v1
since only `eld` exists today.

```ts
// src/classifiers/types.ts
export interface ClassificationResult {
  code: string; // ISO 639-1 language code
  reliable: boolean;
}

export interface LanguageClassifier {
  id: string; // stable id, e.g. "eld"
  classify(text: string): ClassificationResult | null; // null = no usable prediction
}
```

```ts
// src/classifiers/eld-classifier.ts
import { eld } from "eld";
import type { LanguageClassifier } from "./types";

export const eldClassifier: LanguageClassifier = {
  id: "eld",
  classify(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const result = eld.detect(trimmed);
    if (!result.language) return null;
    return { code: result.language, reliable: result.isReliable() };
  },
};
```

```ts
// src/classifiers/index.ts
import type { LanguageClassifier } from "./types";
import { eldClassifier } from "./eld-classifier";

const registry: Record<string, LanguageClassifier> = {
  [eldClassifier.id]: eldClassifier,
};

const DEFAULT_CLASSIFIER_ID = "eld";

// `id` is unused today (always the default) but is already the extension
// point: a future pref pane would read `Zotero.Prefs.get('zotero-lang-cat.classifierId')`
// and pass it here, with no changes needed in scan.ts or the dialog.
export function getClassifier(
  id: string = DEFAULT_CLASSIFIER_ID,
): LanguageClassifier {
  const classifier = registry[id];
  if (!classifier) throw new Error(`Unknown classifier: ${id}`);
  return classifier;
}
```

`scan.ts` and the dialog controller only ever import `getClassifier` from
`src/classifiers/index.ts` and call `.classify(text)` — they never import
`eld` or any adapter directly.

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
- Pref branch: `extensions.zotero-lang-cat.*` (currently unused in v1 — no
  pref pane is built yet. Reserved for a future `classifierId` pref that
  would be read by `getClassifier()`, and the only other configurable
  aspect, scope, is derived from the current pane selection rather than
  stored).

### Directory layout

```text
zotero-language-categorizer/
├── manifest.json
├── bootstrap.ts                     # lifecycle hooks (startup/shutdown/window load+unload)
├── src/
│   ├── classifiers/
│   │   ├── types.ts                 # LanguageClassifier interface, ClassificationResult type
│   │   ├── eld-classifier.ts        # adapter wrapping `eld`
│   │   └── index.ts                 # registry + getClassifier(id?) factory (default: "eld")
│   ├── scan.ts                      # reads active pane's current item list, applies eligibility filter
│   └── dialog/
│       ├── classify.xhtml           # dialog document (VirtualizedTableHelper host)
│       └── classify.ts              # dialog controller: auto-classify on open, Apply/Cancel wiring, chunked processing
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

### Release pipeline

Replaced the template's default (`zotero-plugin-scaffold`'s own `release`
command — an interactive `bumpp` version prompt run locally, triggering a
reusable `zotero-plugin-dev/workflows` GitHub Action on the pushed tag) with
**semantic-release**, driven by Conventional Commits, after the user
compared it against a working semantic-release setup in another of their
projects (`zotero-rag`) and preferred it. No more manual version prompts —
the commit history itself decides whether and how to release.

- **Enforcement:** `commitlint` (`.commitlintrc.json`, extending
  `@commitlint/config-conventional`) runs on every commit via a Husky
  `commit-msg` hook (`.husky/commit-msg`), installed automatically by the
  `prepare` npm script. `npm run commit` (commitizen + `cz-conventional-changelog`,
  configured via `.czrc`) is available as an optional guided prompt for
  writing a compliant message, but isn't required — any commit meeting the
  convention passes.
- **CI wiring:** `.github/workflows/ci.yml` (lint/build/test) is unchanged.
  `.github/workflows/release.yml` was rewritten to trigger via
  `workflow_run` once CI completes successfully on `main` (gated on both
  `conclusion == 'success'` and `head_branch == 'main'`, since `workflow_run`
  fires for every CI run, PRs included), then simply runs `npx semantic-release`.
- **`.releaserc.json` plugin pipeline:** `commit-analyzer` (decide
  patch/minor/major from commit types, or no release) → `release-notes-generator`
  → `changelog` (writes `CHANGELOG.md`) → `npm` (bumps `package.json`'s
  `version` field only — `npmPublish: false`, this project is never
  published to the npm registry) → `exec` (runs
  `node scripts/update-updates-json.mjs ${nextRelease.version} && npm run build`,
  i.e. updates `updates.json` for the already-bumped version, then builds
  the `.xpi` using it, since the build's `buildVersion` define pulls from
  `package.json`) → `git` (commits the bumped `package.json`,
  `package-lock.json`, `updates.json`, and `CHANGELOG.md` back to `main`,
  `[skip ci]` to avoid a release loop) → `github` (creates the GitHub
  Release for the new tag and uploads `.scaffold/build/zotero-language-categorizer.xpi`
  as an asset).
- **Update mechanism changed along with this:** `zotero-plugin.config.ts`'s
  `updateURL` now points at a stable
  `https://raw.githubusercontent.com/<owner>/<repo>/main/updates.json` (a
  file committed at the repo root, always reflecting the latest version),
  rather than the scaffold's own convention of overwriting assets on a fixed
  `release` git tag. `scripts/update-updates-json.mjs` is what keeps that
  file's `update_link` pointed at the correct versioned release-asset URL
  (`.../releases/download/v<version>/zotero-language-categorizer.xpi`) on
  every release. Zotero's installed copy of the plugin polls the stable
  `updates.json` URL; the actual file it downloads is still the immutable,
  versioned GitHub Release asset.
- No git tag exists yet for this repo, and none of the commits made before
  this pipeline landed use Conventional Commit prefixes, so
  semantic-release's commit-analyzer won't find anything release-worthy in
  that history — the first release only happens on the next
  properly-prefixed commit afterward. Decided: no `v0.1.0` tag is seeded;
  semantic-release starts fresh and will land on `1.0.0` for that first
  `feat` commit (its default first-release version), not on `package.json`'s
  pre-pipeline `0.1.0` — semantic-release computes versions purely from git
  tag history, never from `package.json`.

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
  `window.openDialog("chrome://zotero-lang-cat/content/dialog/classify.xhtml", ...)`.
- `openClassifyDialog()` is idempotent: it first checks
  `Services.wm.getMostRecentWindow("zotero-lang-cat:dialog")` and, if a
  dialog is already open, just focuses it instead of opening a second one —
  triggering the Tools-menu entry again while the dialog is up re-focuses
  rather than stacking windows.
- Includes the two extra stylesheets `VirtualizedTableHelper` requires
  (`zotero-react-client.css`, `zotero.css`) and the flex/min-height container
  CSS the toolkit docs specify. The root container is anchored with
  `position: fixed; inset: 0` (not `height: 100%` on `html`/`body`) — in this
  Gecko chrome-dialog context a percentage-height chain through `html`/`body`
  did not reliably track the live window size on resize, leaving blank
  window space below content sized to its initial layout. `html`/`body` and
  the container all get `overflow: hidden` so only the table panel (the one
  element with `overflow: auto`) scrolls; header and footer are pinned via
  `flex: 0 0 auto`.
- Layout is header / body / footer, not just a bare table: a **header**
  (title + one-line explanation of what the plugin does and what it leaves
  untouched), a **body** that is the table (or the empty-state message) and
  takes all remaining vertical space, and a **footer** with the two buttons,
  flat/modern styled (no native OS button chrome — custom flat background,
  border-radius, a filled primary color for Apply, a neutral gray for
  Cancel).
- Table columns: Creators (fixed — first creator's last name, plus
  `et al.` when there's more than one; empty when the item has no creators),
  Title (flex, truncated), **Change** (fixed — `old value → new value`,
  using a real arrow character; `—` when there was no previous value, `…`
  while classification hasn't filled in a prediction yet, and a `(?)` suffix
  on the new value when `!reliable`), Status (fixed-width, custom `renderer`
  that paints nothing → a green check or red X once that row's write
  resolves or fails during Apply). The status column is the progress
  indicator; there's no separate progress bar. No Item Type column — not
  useful enough to earn the space.
- Classification is defensive per-row: if a classifier throws for one item
  (rather than returning `null`), that row's prediction is just left blank
  instead of leaving the whole batch — and the Apply button — stuck, since
  Apply is only re-enabled once the classification pass finishes.
- Buttons: **Cancel** and **Apply**. Apply starts disabled until
  classification finishes, then writes. There is no separate Preview step or
  button — opening the dialog classifies immediately, since the classifier
  is fast enough that a manual trigger would just be friction. Once Apply's
  write batch finishes, it relabels to **Done** and stays clickable (another
  click just closes the dialog, same as Cancel), while **Cancel** itself
  becomes disabled — once changes are applied there's nothing left to
  cancel, so leaving it enabled would be a redundant, slightly misleading
  second "close" action next to Done.
- Classification and Apply both process the item list in small chunks (e.g.
  50 items at a time) with a yield (`await new Promise(r => setTimeout(r, 0))`)
  between chunks, calling `table.treeInstance.invalidate()` after each
  update, so the UI stays responsive on large collections without needing to
  virtualize the processing itself (the table is already virtualized for
  rendering). (The installed `zotero-plugin-toolkit` version's
  `VirtualizedTable` only types a full `invalidate()`, not a per-row
  `invalidateRow(i)`, so a full repaint is triggered per update instead.)

### Localization

Every user-visible label — the Tools-menu entry, the dialog's window title,
heading, explanation, empty-state message, both button labels (including the
"Apply" → "Done" relabel), and the table's column headers — is a Fluent
message in `addon/locale/en-US/addon.ftl`, not a hardcoded string. The menu
entry goes through `Zotero.MenuManager`'s own `l10nID` mechanism; everything
in the dialog goes through `getString()` (`src/utils/locale.ts`), which wraps
a synchronous `Localization` instance.

`getString()` had to be changed to not depend on the `addon` global: this
bundle is loaded twice — once into the main process by `bootstrap.js`, and
again into each dialog window via `Services.scriptloader.loadSubScript(url,
window)` (see Dialog implementation above). Those are independent script
executions with their own module instances; the dialog's load skips
re-creating `addon` (the bundle's own startup guard checks whether
`Zotero[addonInstance]` already exists), so a bare reference to the `addon`
global inside dialog-context code throws. `getString()` now lazily creates
and caches its own `Localization` instance per execution scope instead of
reading `addon.data.locale`, so it works identically whether called from the
main process or from inside a dialog's own copy of the module.

Translations: `addon/locale/<locale>/addon.ftl`, one directory per locale,
same message IDs as `en-US`. Currently `de`, `fr`, and `es` alongside the
`en-US` source — base language codes (not region-qualified like `de-DE`),
matching common practice in other Zotero plugins and relying on Fluent's
locale negotiation to match regional variants (`de-AT`, `fr-CA`, …) to the
base. Adding a language is just adding its directory; nothing else to wire
up, since `getString()` and `Zotero.MenuManager`'s `l10nID` both resolve
against whatever locale Zotero negotiates at runtime.

The explanation text names the written value as an **ISO 639-1** code and
says it's the format Zotero's citation style processor expects — not just
"language code" — since that's the detail that actually matters to a user
deciding whether to trust the plugin's output. A small link underneath,
"What is ISO 639-1?", opens the corresponding Wikipedia article via
`Zotero.launchURL()` (not a plain `<a>` navigation — chrome-privileged
documents don't reliably navigate on link clicks, and opening in the user's
actual browser is what's wanted here anyway). Both the link text and its
`href` are per-locale `addon.ftl` messages, so each translation points at
that language's own Wikipedia edition.

## Data flow

1. User clicks the Tools-menu entry.
2. `scan.ts` reads the items currently shown in the active pane (respecting
   the user's current collection/search/sort/subcollection settings) and
   filters to eligible items as defined above.
3. Dialog opens with one row per eligible item, Change column showing
   `old value → …` and Apply disabled. If there are zero eligible items, an
   empty-state message is shown instead of the table and Apply stays
   disabled. Classification starts automatically as soon as the dialog opens
   — no separate trigger.
4. Each row is classified via `getClassifier().classify(...)` in chunks; the
   Change column updates to `old value → new value` (with the low-confidence
   marker when applicable) as each chunk completes. Once every row has been
   classified, Apply becomes enabled.
5. **Apply**: for each row with a prediction, `item.setField('language', code)`
   then `await item.saveTx()`; on success paint a green check in Status and
   repaint; on a thrown error (e.g. the item was concurrently modified or
   deleted) paint a red marker instead and continue to the next row — one
   failure never aborts the batch. Once the batch finishes, the button
   relabels to "Done" (stays enabled — another click closes the dialog) and
   Cancel becomes disabled.
6. **Cancel** is available up through Apply being clicked. Before
   classification finishes or before Apply is clicked, it's a no-op exit —
   nothing has been written yet. During Apply, whatever has already been
   saved stays saved — each
   item's write is its own transaction, not one all-or-nothing batch.

## Error handling

- Read-only (group) libraries are excluded at the scan step; their items
  never appear in the dialog.
- A per-item save failure during Apply is caught, that row gets an error
  marker, and processing continues with the next row.
- If the plugin is disabled/shut down while the dialog is open, `shutdown()`
  closes it via the `windowtype` lookup.

## Testing

- Unit tests for the `eld` adapter (`eld-classifier.ts`) as a pure function:
  sample strings across several languages, short-title-only inputs (to
  exercise the low-confidence path), empty/whitespace-only input (must return
  `null`, not throw).
- A trivial fake `LanguageClassifier` (fixed/canned results) is used in
  dialog-level tests (`buildRows`/`previewRows`) so the row-state logic can
  be tested without depending on real classification output.
- Unit tests for `isIso6391Code` (`iso639-1.ts`): valid codes, codes with a
  region subtag, case-insensitivity, spelled-out names, unrecognized strings.
- Manual verification checklist in a dedicated dev Zotero profile:
  - Library with items in several languages, some already holding a valid
    ISO 639-1 code (must remain untouched after Apply) and some holding a
    spelled-out name like "German" (must be corrected to the code on Apply,
    with the Change column showing `German → de` before Apply is clicked).
  - Title-only items (no abstract) — low-confidence marker should appear.
  - A read-only group library — its items never appear in the dialog.
  - A large collection (hundreds+ items) — classification-on-open and Apply
    stay responsive, scrolling the virtualized table stays smooth.
  - Disable → re-enable the plugin, and close → reopen the main window — no
    duplicate Tools-menu entries.

## Out of scope (v1)

- Per-row include/exclude checkboxes before Apply.
- A separate scope picker inside the dialog (library/collection dropdown).
- Persisted preferences/pref pane, including any UI for choosing between
  classifiers — the adapter/factory architecture supports adding this later
  without restructuring, but no pref pane or classifier-selection UI ships
  in v1.
- Re-classifying items that already have a `language` value.
