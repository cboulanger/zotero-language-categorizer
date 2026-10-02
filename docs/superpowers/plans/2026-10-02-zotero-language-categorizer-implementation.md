# Zotero Language Categorizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline execution on `main`, no subagents — per explicit user instruction). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Zotero 8+ plugin that classifies the language of title+abstract for items with no `language` field set, previews the predictions in a virtualized table, and writes them on Apply with a per-row progress checkmark.

**Architecture:** `zotero-plugin-template` (TypeScript/esbuild) scaffold. A `LanguageClassifier` adapter interface wraps `eld` behind a `getClassifier(id?)` factory. A pure `isEligible()` filter selects items from whatever the active pane currently displays. A `VirtualizedTableHelper`-based dialog drives Preview (classify, fill predictions) then Apply (write fields, paint checkmarks), both chunked to stay responsive.

**Tech Stack:** TypeScript, `zotero-plugin-scaffold`/`zotero-plugin-toolkit`/`zotero-types`, `eld` (classifier), mocha/chai (template's built-in test runner, runs inside the Zotero process).

## Global Constraints

- `strict_min_version: "8.0"` in manifest (uses `Zotero.MenuManager`; no Zotero 7 fallback).
- `strict_max_version` pinned to the newest tested minor (start at `10.0.*`; this machine has Zotero installed at `/Applications/Zotero.app`, binary at `/Applications/Zotero.app/Contents/MacOS/zotero`).
- Plugin ID: `zotero-language-categorizer@cboulanger.github.io`. Namespace/addonRef: `zotero-lang-cat`. Pref branch: `extensions.zotero-lang-cat.*` (unused in v1).
- Never write `language` on an item that already has a non-empty one.
- No per-row checkboxes, no scope picker, no pref pane, no re-classification of already-tagged items (all out of scope for v1 — see spec).
- Classifier access always goes through `getClassifier(id?).classify(text)` — never import `eld` outside `src/modules/classifiers/`.
- `reliable` on `ClassificationResult` is a `boolean`, never a numeric confidence (see spec rationale).
- Commit after every task on `main` directly (no worktree, no feature branch — per explicit user instruction).

---

### Task 1: Scaffold the plugin and verify the build pipeline

**Files:**
- Create: entire project scaffold (`addon/`, `src/`, `package.json`, etc.) from `zotero-plugin-template`
- Modify: `package.json` (`config` block), `addon/manifest.json`, `.env`

**Interfaces:**
- Produces: a working `npm run build` pipeline later tasks add code to.

- [ ] **Step 1: Fetch the template into the current directory**

The project directory already has a `.git` repo and `docs/` committed — degit into a temp dir, then merge, so we don't clobber `.git`/`docs/`:

```bash
npx --yes degit windingwind/zotero-plugin-template /tmp/zotero-plugin-template-src
rsync -a --exclude='.git' /tmp/zotero-plugin-template-src/ /Volumes/Hub/Users/christianboulanger/Code/zotero-language-categorizer/
rm -rf /tmp/zotero-plugin-template-src
```

Expected: `addon/`, `src/`, `package.json`, `tsconfig.json` etc. now exist alongside the existing `docs/` and `.git`.

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

Expected: exits 0, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 3: Configure plugin identity in `package.json`**

Open `package.json`, set the `config` block (keys per the template's convention):

```json
{
  "config": {
    "addonName": "Zotero Language Categorizer",
    "addonID": "zotero-language-categorizer@cboulanger.github.io",
    "addonRef": "zotero-lang-cat",
    "addonInstance": "LanguageCategorizer",
    "prefsPrefix": "extensions.zotero-lang-cat"
  }
}
```

- [ ] **Step 4: Set manifest version floor**

In `addon/manifest.json`, under `applications.zotero`, set:

```json
"strict_min_version": "8.0",
"strict_max_version": "10.0.*"
```

- [ ] **Step 5: Configure `.env` for local Zotero**

```bash
cp .env.example .env
```

Edit `.env`:
```
ZOTERO_PLUGIN_ZOTERO_BIN_PATH=/Applications/Zotero.app/Contents/MacOS/zotero
ZOTERO_PLUGIN_PROFILE_PATH=/Volumes/Hub/Users/christianboulanger/Library/Application Support/Zotero/Profiles/lang-cat-dev
ZOTERO_PLUGIN_DATA_DIR=/Volumes/Hub/Users/christianboulanger/Zotero-lang-cat-dev-data
```

(The profile/data dirs don't need to exist yet — `npm start` creates them on first run. This step only matters for later manual testing with `npm start`; it does not block `npm run build`.)

- [ ] **Step 6: Verify the build**

```bash
npm run build
```

Expected: exits 0, produces a `.xpi` under `.scaffold/build` (or the template's equivalent build output dir — note the actual path printed in the build log for later tasks), and `tsc --noEmit` reports no type errors.

- [ ] **Step 7: Inspect the real module layout**

```bash
find src addon -type f | sort
```

Record the actual paths for `hooks.ts`, the examples module, and where the build writes the bundled chrome script (e.g. `addon/content/scripts/...`) — later tasks in this plan reference `src/hooks.ts`, `src/modules/`, and `addon/content/`; if the installed template names these differently, use the real names from this listing instead.

- [ ] **Step 8: Remove unused example modules**

Delete the template's example module(s) under `src/modules/` (e.g. `examples.ts`) and any calls to them from `src/hooks.ts`, keeping only the lifecycle hook function shells (`onStartup`, `onMainWindowLoad`, `onMainWindowUnload`, `onShutdown`, `onNotify`, `onPrefsEvent`).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Scaffold plugin from zotero-plugin-template"
```

---

### Task 2: Classifier adapter module

**Files:**
- Create: `src/modules/classifiers/types.ts`
- Create: `src/modules/classifiers/eld-classifier.ts`
- Create: `src/modules/classifiers/index.ts`
- Test: `test/classifiers/eld-classifier.test.ts` (adjust to the real test dir found in Task 1 Step 7 if it differs)

**Interfaces:**
- Produces: `ClassificationResult { code: string; reliable: boolean }`, `LanguageClassifier { id: string; classify(text: string): ClassificationResult | null }`, `getClassifier(id?: string): LanguageClassifier`. These are the only things Task 3+ import from this module.

- [ ] **Step 1: Add the `eld` dependency**

```bash
npm install eld
```

- [ ] **Step 2: Write the types module**

`src/modules/classifiers/types.ts`:

```ts
export interface ClassificationResult {
  code: string; // ISO 639-1 language code
  reliable: boolean;
}

export interface LanguageClassifier {
  id: string;
  classify(text: string): ClassificationResult | null; // null = no usable prediction
}
```

- [ ] **Step 3: Write the failing test**

`test/classifiers/eld-classifier.test.ts`:

```ts
import { expect } from "chai";
import { eldClassifier } from "../../src/modules/classifiers/eld-classifier";

describe("eldClassifier", () => {
  it("has id 'eld'", () => {
    expect(eldClassifier.id).to.equal("eld");
  });

  it("detects English text", () => {
    const result = eldClassifier.classify(
      "The Origin of Species by Means of Natural Selection",
    );
    expect(result).to.not.be.null;
    expect(result!.code).to.equal("en");
  });

  it("detects German text", () => {
    const result = eldClassifier.classify(
      "Die Grundlagen der allgemeinen Relativitätstheorie",
    );
    expect(result).to.not.be.null;
    expect(result!.code).to.equal("de");
  });

  it("returns null for empty input", () => {
    expect(eldClassifier.classify("")).to.be.null;
  });

  it("returns null for whitespace-only input", () => {
    expect(eldClassifier.classify("   \n\t  ")).to.be.null;
  });

  it("flags a bare one-word title as potentially unreliable", () => {
    const result = eldClassifier.classify("Introduction");
    expect(result).to.not.be.null;
    expect(result).to.have.property("reliable").that.is.a("boolean");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npm test -- --grep eldClassifier
```

Expected: FAIL — `Cannot find module '../../src/modules/classifiers/eld-classifier'`.

- [ ] **Step 5: Write the adapter**

`src/modules/classifiers/eld-classifier.ts`:

```ts
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

- [ ] **Step 6: Write the registry/factory**

`src/modules/classifiers/index.ts`:

```ts
import type { LanguageClassifier } from "./types";
import { eldClassifier } from "./eld-classifier";

const registry: Record<string, LanguageClassifier> = {
  [eldClassifier.id]: eldClassifier,
};

const DEFAULT_CLASSIFIER_ID = "eld";

export function getClassifier(id: string = DEFAULT_CLASSIFIER_ID): LanguageClassifier {
  const classifier = registry[id];
  if (!classifier) throw new Error(`Unknown classifier: ${id}`);
  return classifier;
}

export type { ClassificationResult, LanguageClassifier } from "./types";
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
npm test -- --grep eldClassifier
```

Expected: PASS, all 6 assertions green.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/modules/classifiers test/classifiers
git commit -m "Add eld-backed classifier adapter with getClassifier factory"
```

---

### Task 3: Item eligibility filter (`scan.ts`)

**Files:**
- Create: `src/modules/scan.ts`
- Test: `test/scan.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ScannableItem` (structural interface), `isEligible(item: ScannableItem): boolean`, `getEligibleItems(items: ScannableItem[]): ScannableItem[]`, `getScopedEligibleItems(): ScannableItem[]` (the only one of these that touches the live `Zotero` global — Task 7 calls this one).

- [ ] **Step 1: Write the failing test**

`test/scan.test.ts`:

```ts
import { expect } from "chai";
import { isEligible, getEligibleItems, type ScannableItem } from "../src/modules/scan";

function makeItem(overrides: Partial<{
  isRegular: boolean;
  editable: boolean;
  language: string;
  title: string;
  abstractNote: string;
}> = {}): ScannableItem {
  const {
    isRegular = true,
    editable = true,
    language = "",
    title = "Some Title",
    abstractNote = "",
  } = overrides;
  const fields: Record<string, string> = { language, title, abstractNote };
  return {
    isRegularItem: () => isRegular,
    library: { editable },
    getField: (field: string) => fields[field] ?? "",
  };
}

describe("isEligible", () => {
  it("accepts a regular editable item with no language and a title", () => {
    expect(isEligible(makeItem())).to.be.true;
  });

  it("rejects a non-regular item (note/attachment)", () => {
    expect(isEligible(makeItem({ isRegular: false }))).to.be.false;
  });

  it("rejects an item in a read-only library", () => {
    expect(isEligible(makeItem({ editable: false }))).to.be.false;
  });

  it("rejects an item that already has a language set", () => {
    expect(isEligible(makeItem({ language: "fr" }))).to.be.false;
  });

  it("rejects an item with no title and no abstract", () => {
    expect(isEligible(makeItem({ title: "", abstractNote: "" }))).to.be.false;
  });

  it("accepts an item with only an abstract and no title", () => {
    expect(isEligible(makeItem({ title: "", abstractNote: "Some abstract text." }))).to.be.true;
  });
});

describe("getEligibleItems", () => {
  it("filters a mixed list down to eligible items only", () => {
    const items = [
      makeItem(),
      makeItem({ language: "en" }),
      makeItem({ isRegular: false }),
    ];
    expect(getEligibleItems(items)).to.deep.equal([items[0]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --grep isEligible
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/modules/scan.ts`:

```ts
export interface ScannableItem {
  isRegularItem(): boolean;
  library: { editable: boolean };
  getField(field: string): string;
}

export function isEligible(item: ScannableItem): boolean {
  if (!item.isRegularItem()) return false;
  if (!item.library.editable) return false;
  if (item.getField("language")) return false;
  const title = item.getField("title") || "";
  const abstractNote = item.getField("abstractNote") || "";
  return Boolean(title.trim() || abstractNote.trim());
}

export function getEligibleItems<T extends ScannableItem>(items: T[]): T[] {
  return items.filter(isEligible);
}

// Touches the live Zotero global — not unit tested, exercised via the manual
// checklist in Task 8. Returns whatever the active pane currently displays
// (respects the user's current collection/search/subcollection/sort state).
export function getScopedEligibleItems(): Zotero.Item[] {
  const pane = Zotero.getActiveZoteroPane();
  const items = pane.itemsView.getSortedItems() as Zotero.Item[];
  return getEligibleItems(items);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --grep isEligible
```

Expected: PASS, all 6 `isEligible` assertions plus the `getEligibleItems` assertion green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/scan.ts test/scan.test.ts
git commit -m "Add item eligibility filter for language classification scope"
```

---

### Task 4: Dialog shell (static XHTML + empty table)

**Files:**
- Create: `addon/content/dialog/classify.xhtml`
- Create: `addon/content/dialog/classify.css`
- Modify: `addon/manifest.json` (none needed — content dir is already packaged), `src/modules/classifiers/index.ts` (no change)

**Interfaces:**
- Produces: a dialog document with a `#zotero-lang-cat-table-container` div, a `#zotero-lang-cat-empty-state` div (hidden by default), and `#zotero-lang-cat-close` / `#zotero-lang-cat-action` buttons for Task 5 to wire up. No behavior yet — this task only gets the static shell to render.

- [ ] **Step 1: Write the dialog XHTML**

`addon/content/dialog/classify.xhtml`:

```xml
<?xml version="1.0"?>
<?xml-stylesheet href="chrome://global/skin/" type="text/css"?>
<?xml-stylesheet href="chrome://zotero/skin/zotero.css" type="text/css"?>
<?xml-stylesheet href="chrome://zotero-platform/content/zotero-react-client.css" type="text/css"?>
<?xml-stylesheet href="chrome://zotero-platform/content/zotero.css" type="text/css"?>
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"
      xmlns:xul="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
      windowtype="zotero-lang-cat:dialog">
<head>
  <title>Classify Item Languages</title>
  <meta charset="utf-8"/>
  <link rel="stylesheet" href="classify.css"/>
  <script>
    document.addEventListener("DOMContentLoaded", () => {
      Services.scriptloader.loadSubScript("chrome://zotero/content/include.js", this);
      Services.scriptloader.loadSubScript(
        "chrome://zotero-lang-cat/content/scripts/zotero-language-categorizer.js",
        window,
      );
    });
  </script>
</head>
<body>
  <div class="zotero-lang-cat-dialog-container">
    <p id="zotero-lang-cat-empty-state" hidden="hidden">
      No items without a language found in the current view.
    </p>
    <div id="zotero-lang-cat-table-container"></div>
    <div class="zotero-lang-cat-button-row">
      <button id="zotero-lang-cat-close">Close</button>
      <button id="zotero-lang-cat-action">Preview</button>
    </div>
  </div>
</body>
</html>
```

(The script src path `chrome://zotero-lang-cat/content/scripts/zotero-language-categorizer.js` must match the real bundle filename found in Task 1 Step 7 — update this line if the build emits a different path.)

- [ ] **Step 2: Write the dialog CSS**

`addon/content/dialog/classify.css`:

```css
.zotero-lang-cat-dialog-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px 12px 0;
  box-sizing: border-box;
}
#zotero-lang-cat-table-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #ccc;
  border-radius: 4px;
}
#zotero-lang-cat-table-container .virtualized-table-header {
  position: sticky;
  top: 0;
  z-index: 1;
}
.zotero-lang-cat-button-row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0;
}
.zotero-lang-cat-status-reliable {
  color: inherit;
}
.zotero-lang-cat-status-unreliable {
  color: #b05a00;
}
.zotero-lang-cat-status-success::before {
  content: "✓";
  color: #2e7d32;
}
.zotero-lang-cat-status-error::before {
  content: "✗";
  color: #c62828;
}
```

- [ ] **Step 3: Verify it builds**

```bash
npm run build
```

Expected: exits 0, `.xhtml`/`.css` present in the built `.xpi`'s content dir (unzip the build output and check, e.g. `unzip -l .scaffold/build/*.xpi | grep classify`).

- [ ] **Step 4: Commit**

```bash
git add addon/content/dialog
git commit -m "Add static dialog shell for the classify UI"
```

---

### Task 5: Dialog controller — table + Preview flow

**Files:**
- Create: `src/modules/dialog/classify-dialog.ts`
- Test: `test/dialog/classify-dialog.test.ts` (tests the row-state logic in isolation from the real `VirtualizedTableHelper`/DOM)

**Interfaces:**
- Consumes: `getClassifier` from `src/modules/classifiers/index.ts`; `ScannableItem`/`isEligible` types from `src/modules/scan.ts`.
- Produces: `RowState { item: ScannableItem; title: string; itemType: string; code: string | null; reliable: boolean | null; status: "pending" | "success" | "error" }`, `buildRows(items)`, `previewRows(rows, classifier)` (mutates rows in place, returns void — called by both the dialog and the test).

- [ ] **Step 1: Write the failing test**

`test/dialog/classify-dialog.test.ts`:

```ts
import { expect } from "chai";
import { buildRows, previewRows, type RowState } from "../../src/modules/dialog/classify-dialog";
import type { LanguageClassifier } from "../../src/modules/classifiers/types";

function makeItem(title: string, abstractNote = "") {
  const fields: Record<string, string> = { title, abstractNote, language: "" };
  return {
    isRegularItem: () => true,
    library: { editable: true },
    getField: (f: string) => fields[f] ?? "",
    itemType: "journalArticle",
  };
}

const fakeClassifier: LanguageClassifier = {
  id: "fake",
  classify(text) {
    if (!text.trim()) return null;
    return { code: text.includes("bonjour") ? "fr" : "en", reliable: text.length > 20 };
  },
};

describe("buildRows", () => {
  it("creates one pending row per item", () => {
    const rows = buildRows([makeItem("Hello World") as any]);
    expect(rows).to.have.length(1);
    expect(rows[0].status).to.equal("pending");
    expect(rows[0].code).to.be.null;
  });
});

describe("previewRows", () => {
  it("fills in code and reliable for each row", () => {
    const rows = buildRows([
      makeItem("Hello World, a long enough title") as any,
      makeItem("bonjour le monde, un titre assez long") as any,
    ]);
    previewRows(rows, fakeClassifier);
    expect(rows[0].code).to.equal("en");
    expect(rows[0].reliable).to.be.true;
    expect(rows[1].code).to.equal("fr");
  });

  it("leaves code null when the classifier returns null", () => {
    const rows = buildRows([makeItem("") as any]);
    previewRows(rows, fakeClassifier);
    expect(rows[0].code).to.be.null;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --grep "buildRows|previewRows"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the row-state logic**

`src/modules/dialog/classify-dialog.ts`:

```ts
import type { LanguageClassifier } from "../classifiers/types";
import type { ScannableItem } from "../scan";

export interface RowState {
  item: ScannableItem;
  title: string;
  itemType: string;
  code: string | null;
  reliable: boolean | null;
  status: "pending" | "success" | "error";
}

export function buildRows(items: (ScannableItem & { itemType: string })[]): RowState[] {
  return items.map((item) => ({
    item,
    title: item.getField("title") || "(no title)",
    itemType: item.itemType,
    code: null,
    reliable: null,
    status: "pending",
  }));
}

export function previewRows(rows: RowState[], classifier: LanguageClassifier): void {
  for (const row of rows) {
    const title = row.item.getField("title") || "";
    const abstractNote = row.item.getField("abstractNote") || "";
    const text = [title, abstractNote].filter(Boolean).join("\n");
    const result = classifier.classify(text);
    row.code = result?.code ?? null;
    row.reliable = result?.reliable ?? null;
  }
}

export const CHUNK_SIZE = 50;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --grep "buildRows|previewRows"
```

Expected: PASS, all 3 assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/dialog/classify-dialog.ts test/dialog
git commit -m "Add dialog row-state model and Preview classification logic"
```

---

### Task 6: Wire the table and Preview/Apply buttons into the live dialog

**Files:**
- Modify: `src/modules/dialog/classify-dialog.ts` (add `openClassifyDialog(items)`, the only export the bootstrap hook calls)

**Interfaces:**
- Consumes: `VirtualizedTableHelper` from `zotero-plugin-toolkit`; `RowState`, `buildRows`, `previewRows`, `chunk`, `CHUNK_SIZE` from this same module; `getClassifier` from `../classifiers`.
- Produces: `openClassifyDialog(items: (ScannableItem & { itemType: string; setField: Function; saveTx: Function })[]): void` — called by Task 7's menu handler.

- [ ] **Step 1: Append the live-dialog wiring**

Add to `src/modules/dialog/classify-dialog.ts`:

```ts
import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import { getClassifier } from "../classifiers";

type ApplyableItem = ScannableItem & {
  itemType: string;
  setField(field: string, value: string): void;
  saveTx(): Promise<unknown>;
};

export function openClassifyDialog(items: ApplyableItem[]): void {
  const rows = buildRows(items);
  const win = Zotero.getMainWindow();

  if (rows.length === 0) {
    win.openDialog(
      "chrome://zotero-lang-cat/content/dialog/classify.xhtml",
      "zotero-lang-cat-dialog",
      "chrome,centerscreen,resizable=yes,width=700,height=100",
      { rows: [] },
    );
    return;
  }

  const dialogWin = win.openDialog(
    "chrome://zotero-lang-cat/content/dialog/classify.xhtml",
    "zotero-lang-cat-dialog",
    "chrome,centerscreen,resizable=yes,width=700,height=500",
    { rows },
  ) as Window & { ZoteroLangCatDialog?: DialogController };

  // `DialogController` below is instantiated from the dialog's own loaded
  // script once DOMContentLoaded fires there (see classify.xhtml); it reads
  // window.arguments[0].rows.
}

export class DialogController {
  table?: VirtualizedTableHelper;
  rows: RowState[];
  mode: "preview" | "apply" = "preview";

  constructor(
    private win: Window,
    rows: RowState[],
  ) {
    this.rows = rows;
  }

  init(): void {
    const doc = this.win.document;
    const emptyState = doc.getElementById("zotero-lang-cat-empty-state")!;
    const tableContainer = doc.getElementById("zotero-lang-cat-table-container")!;
    const actionButton = doc.getElementById("zotero-lang-cat-action") as HTMLButtonElement;
    const closeButton = doc.getElementById("zotero-lang-cat-close") as HTMLButtonElement;

    if (this.rows.length === 0) {
      emptyState.hidden = false;
      tableContainer.hidden = true;
      actionButton.disabled = true;
      closeButton.addEventListener("click", () => this.win.close());
      return;
    }

    this.table = new VirtualizedTableHelper(this.win)
      .setProp("id", "zotero-lang-cat-table")
      .setProp("getRowCount", () => this.rows.length)
      .setProp("getRowData", (i: number) => this.rowData(i))
      .setProp("columns", [
        { dataKey: "title", label: "Title", flex: 3 },
        { dataKey: "itemType", label: "Type", fixedWidth: true, width: 110 },
        { dataKey: "code", label: "Detected", fixedWidth: true, width: 80 },
        { dataKey: "status", label: "", fixedWidth: true, width: 32 },
      ])
      .setProp("multiSelect", false)
      .setProp("onSelectionChange", () => {})
      .setContainerId("zotero-lang-cat-table-container");
    this.table.render();

    closeButton.addEventListener("click", () => this.win.close());
    actionButton.addEventListener("click", () => this.onActionClick(actionButton));
  }

  rowData(i: number): Record<string, string> {
    const row = this.rows[i];
    const code = row.code ?? "";
    const statusClass =
      row.status === "success"
        ? "zotero-lang-cat-status-success"
        : row.status === "error"
          ? "zotero-lang-cat-status-error"
          : "";
    return {
      title: row.title,
      itemType: row.itemType,
      code: row.reliable === false && code ? `${code} (?)` : code,
      status: "",
      statusClass,
    };
  }

  async onActionClick(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    if (this.mode === "preview") {
      await this.runPreview();
      button.textContent = "Apply";
      this.mode = "apply";
      button.disabled = false;
    } else {
      await this.runApply();
      button.textContent = "Done";
      button.disabled = true;
    }
  }

  async runPreview(): Promise<void> {
    const classifier = getClassifier();
    for (const group of chunk(this.rows, CHUNK_SIZE)) {
      previewRows(group, classifier);
      this.table?.treeInstance.invalidate();
      await new Promise((r) => this.win.setTimeout(r, 0));
    }
  }

  async runApply(): Promise<void> {
    for (const group of chunk(
      this.rows.map((r, i) => [r, i] as const).filter(([r]) => r.code),
      CHUNK_SIZE,
    )) {
      for (const [row, index] of group) {
        try {
          (row.item as ApplyableItem).setField("language", row.code!);
          await (row.item as ApplyableItem).saveTx();
          row.status = "success";
        } catch (e) {
          row.status = "error";
        }
        this.table?.treeInstance.invalidateRow(index);
      }
      await new Promise((r) => this.win.setTimeout(r, 0));
    }
  }
}
```

- [ ] **Step 2: Wire the dialog script to instantiate the controller**

Append to `addon/content/dialog/classify.xhtml`'s inline `<script>`, after the two `loadSubScript` calls:

```xml
      const rows = window.arguments?.[0]?.rows ?? [];
      const controller = new Zotero.LanguageCategorizer.DialogController(window, rows);
      controller.init();
```

This assumes the template's bundled script exposes the addon's modules on `Zotero[addonInstance]` (configured as `LanguageCategorizer` in Task 1 Step 3), with `DialogController` reachable on it. Before running this step, check `src/index.ts` from Task 1 Step 7's listing for the exact assignment (e.g. `Zotero[config.addonInstance] = addon` and what `addon` exposes) and for how the template re-exports `src/modules/*` onto that object; if modules aren't auto-attached, add a line in `src/index.ts` exposing `DialogController` on the addon instance (e.g. `addon.DialogController = DialogController;`), and update the line above to match whatever path reaches it.

- [ ] **Step 3: Build and smoke-check**

```bash
npm run build
```

Expected: exits 0, no TypeScript errors in `classify-dialog.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/dialog/classify-dialog.ts addon/content/dialog/classify.xhtml
git commit -m "Wire VirtualizedTableHelper dialog with Preview/Apply flow"
```

---

### Task 7: Bootstrap wiring — Tools menu entry and lifecycle

**Files:**
- Modify: `src/hooks.ts` (or the real equivalent found in Task 1 Step 7) — `onStartup`, `onShutdown`
- Create: `addon/locale/en-US/zotero-language-categorizer.ftl`

**Interfaces:**
- Consumes: `getScopedEligibleItems` from `../modules/scan`, `openClassifyDialog` from `../modules/dialog/classify-dialog`.
- Produces: nothing further consumed by other tasks — this is the final wiring point.

- [ ] **Step 1: Add the Fluent string**

`addon/locale/en-US/zotero-language-categorizer.ftl`:

```
zotero-lang-cat-menu-classify =
    .label = Classify Item Languages…
```

- [ ] **Step 2: Register the Tools-menu entry in `onStartup`**

In `src/hooks.ts`, inside `onStartup` (after the addon's own FTL resource registration, which the template already does for its example module):

```ts
import { getScopedEligibleItems } from "./modules/scan";
import { openClassifyDialog } from "./modules/dialog/classify-dialog";

// inside onStartup(), after existing setup:
Zotero.MenuManager.registerMenu({
  menuID: "zotero-lang-cat-tools-menu",
  pluginID: addon.data.config.addonID,
  target: "main/menubar/tools",
  menus: [
    {
      menuType: "menuitem",
      l10nID: "zotero-lang-cat-menu-classify",
      onCommand: () => {
        const items = getScopedEligibleItems();
        openClassifyDialog(items as any);
      },
    },
  ],
});
```

(Adjust `addon.data.config.addonID` to however the template actually exposes the configured `addonID` at runtime — confirm against `src/index.ts`/`src/utils/` from Task 1.)

- [ ] **Step 3: Close any open dialog in `onShutdown`**

In `src/hooks.ts`, inside `onShutdown` (before/alongside the template's existing `if (reason === APP_SHUTDOWN) return;` shortcut):

```ts
function onShutdown({ reason }: { reason: string }): void {
  if (reason === "APP_SHUTDOWN") return;
  for (const win of Services.wm.getEnumerator("zotero-lang-cat:dialog")) {
    win.close();
  }
  // ...existing template teardown...
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/hooks.ts addon/locale
git commit -m "Register Tools-menu entry and dialog teardown on shutdown"
```

---

### Task 8: End-to-end manual verification and packaging

**Files:**
- None created — this task runs the plugin for real and records results; it does not produce more code unless a bug is found (in which case, fix it in the relevant task's file and re-commit).

- [ ] **Step 1: Launch the dev profile**

```bash
npm start
```

Expected: Zotero opens with the plugin loaded (check Tools menu for "Classify Item Languages…").

- [ ] **Step 2: Manual checklist**

Walk through each item from the spec's Testing section against the running dev profile, noting pass/fail for each:
- A collection with items in several languages, titles/abstracts only — Preview shows a plausible detected code per item.
- An item that already has `language` set — confirm it never appears in the dialog's rows.
- A title-only item (no abstract) — confirm it still gets a prediction, with the low-confidence marker when applicable.
- Click Apply — confirm green checkmarks appear per row as each save resolves, and the applied items now show the detected `language` in the Zotero item pane.
- Close the dialog mid-Apply (on a larger collection) — confirm already-applied items keep their language and the rest remain untouched.
- Disable then re-enable the plugin from the Zotero add-ons manager — confirm only one "Classify Item Languages…" entry exists afterward (no duplicate).
- Close and reopen the main Zotero window — confirm the menu entry still works and isn't duplicated.

- [ ] **Step 3: Record results**

Append a `## Manual verification results` section at the bottom of this plan file with the date and pass/fail notes for each bullet above. Fix and re-test anything that fails before considering the plan complete.

- [ ] **Step 4: Final build and commit**

```bash
npm run build
git add -A
git commit -m "Complete manual verification of classify dialog flow"
```
