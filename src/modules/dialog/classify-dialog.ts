import {
  ProgressWindowHelper,
  VirtualizedTableHelper,
} from "zotero-plugin-toolkit";
import { getClassifier } from "../classifiers";
import { getString } from "../../utils/locale";
import type { LanguageClassifier } from "../classifiers/types";
import type { ScannableItem } from "../scan";
import { isIso6391Code } from "../iso639-1";
import { convertLanguageValue } from "../iso639-convert";

export interface RowState {
  item: ScannableItem;
  title: string;
  creators: string;
  currentLanguage: string;
  // Classifier result, cached so toggling options needn't re-classify.
  detected: { code: string; reliable: boolean } | null;
  // Resulting change under the current options; null = row left untouched.
  code: string | null;
  reliable: boolean | null;
  status: "pending" | "success" | "error";
  excluded: boolean;
}

type CreatorLike = { lastName: string };

export function formatCreators(creators: CreatorLike[]): string {
  if (creators.length === 0) return "";
  const first = creators[0].lastName;
  return creators.length > 1 ? `${first} et al.` : first;
}

export function buildRows(
  items: (ScannableItem & { getCreators(): CreatorLike[] })[],
): RowState[] {
  return items.map((item) => ({
    item,
    title: item.getField("title") || "(no title)",
    creators: formatCreators(item.getCreators()),
    currentLanguage: item.getField("language") || "",
    detected: null,
    code: null,
    reliable: null,
    status: "pending",
    excluded: false,
  }));
}

export interface RowOptions {
  overwrite: boolean;
  convert: boolean;
}

export const DEFAULT_OPTIONS: RowOptions = { overwrite: false, convert: false };

// Decides what (if anything) a row changes to, from its current language
// value, the cached detection and the footer options. Existing data is only
// touched when `overwrite` is on; `convert` (which requires overwrite) maps
// legacy codes/names to ISO 639-1 instead of re-detecting them.
export function resolveRow(row: RowState, options: RowOptions): void {
  const current = row.currentLanguage.trim();
  let result: { code: string; reliable: boolean | null } | null = null;
  if (!current) {
    result = row.detected;
  } else if (options.overwrite) {
    const converted =
      options.convert && !isIso6391Code(current)
        ? convertLanguageValue(current, ["en", Zotero.locale])
        : null;
    result = converted ? { code: converted, reliable: true } : row.detected;
  }
  row.code = result?.code ?? null;
  row.reliable = result?.reliable ?? null;
}

export function previewRows(
  rows: RowState[],
  classifier: LanguageClassifier,
  options: RowOptions = DEFAULT_OPTIONS,
): void {
  for (const row of rows) {
    try {
      const title = row.item.getField("title") || "";
      const abstractNote = row.item.getField("abstractNote") || "";
      const text = [title, abstractNote].filter(Boolean).join("\n");
      row.detected = classifier.classify(text);
    } catch (e) {
      row.detected = null;
    }
    resolveRow(row, options);
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

type ApplyableItem = ScannableItem & {
  getCreators(): CreatorLike[];
  setField(field: string, value: string): void;
  saveTx(): Promise<unknown>;
};

export const DIALOG_WINDOW_TYPE = "zotero-lang-cat:dialog";

// Idempotent: focuses the existing dialog instead of opening a second one
// if the user triggers the menu entry again while it's already open.
export function openClassifyDialog(items: ApplyableItem[]): void {
  const existing = Services.wm.getMostRecentWindow(DIALOG_WINDOW_TYPE) as
    (Window & { focus(): void }) | null;
  if (existing) {
    existing.focus();
    return;
  }

  const rows = buildRows(items);
  const win = Zotero.getMainWindow();
  win.openDialog(
    "chrome://zotero-lang-cat/content/dialog/classify.xhtml",
    "zotero-lang-cat-dialog",
    "chrome,centerscreen,resizable=yes,width=700,height=500",
    { rows },
  );
}

export class DialogController {
  table?: VirtualizedTableHelper;
  rows: RowState[];
  applied = false;
  options: RowOptions = { ...DEFAULT_OPTIONS };
  classified = false;
  private cancelButton?: HTMLButtonElement;
  private actionButton?: HTMLButtonElement;
  private overwriteBox?: HTMLInputElement;
  private convertBox?: HTMLInputElement;

  constructor(
    private win: Window,
    rows: RowState[],
  ) {
    this.rows = rows;
  }

  init(): void {
    const doc = this.win.document;
    const heading = doc.getElementById(
      "zotero-lang-cat-heading",
    ) as HTMLElement;
    const explanation = doc.getElementById(
      "zotero-lang-cat-explanation",
    ) as HTMLElement;
    const skipHint = doc.getElementById(
      "zotero-lang-cat-skip-hint",
    ) as HTMLElement;
    const emptyState = doc.getElementById(
      "zotero-lang-cat-empty-state",
    ) as HTMLElement;
    const tableContainer = doc.getElementById(
      "zotero-lang-cat-table-container",
    ) as HTMLElement;
    const actionButton = doc.getElementById(
      "zotero-lang-cat-action",
    ) as HTMLButtonElement;
    const cancelButton = doc.getElementById(
      "zotero-lang-cat-cancel",
    ) as HTMLButtonElement;
    const isoLink = doc.getElementById(
      "zotero-lang-cat-iso-link",
    ) as HTMLAnchorElement;
    const overwriteBox = doc.getElementById(
      "zotero-lang-cat-opt-overwrite",
    ) as HTMLInputElement;
    const convertBox = doc.getElementById(
      "zotero-lang-cat-opt-convert",
    ) as HTMLInputElement;
    this.cancelButton = cancelButton;
    this.actionButton = actionButton;
    this.overwriteBox = overwriteBox;
    this.convertBox = convertBox;

    doc.title = getString("dialog-title");
    heading.textContent = getString("dialog-heading");
    explanation.textContent = getString("dialog-explanation");
    skipHint.textContent = getString("dialog-skip-hint");
    emptyState.textContent = getString("dialog-empty-state");
    cancelButton.textContent = getString("dialog-cancel");
    actionButton.textContent = getString("dialog-apply");
    doc.getElementById("zotero-lang-cat-opt-overwrite-label")!.textContent =
      getString("dialog-opt-overwrite");
    doc.getElementById("zotero-lang-cat-opt-convert-label")!.textContent =
      getString("dialog-opt-convert");
    overwriteBox.checked = false;
    convertBox.checked = false;
    convertBox.disabled = true;
    overwriteBox.addEventListener("change", () => {
      if (!overwriteBox.checked) convertBox.checked = false;
      convertBox.disabled = !overwriteBox.checked;
      this.onOptionsChange();
    });
    convertBox.addEventListener("change", () => this.onOptionsChange());

    const isoLinkHref = getString("dialog-iso-link-href");
    isoLink.textContent = getString("dialog-iso-link-text");
    isoLink.href = isoLinkHref;
    isoLink.addEventListener("click", (e) => {
      e.preventDefault();
      Zotero.launchURL(isoLinkHref);
    });

    cancelButton.addEventListener("click", () => this.win.close());
    actionButton.addEventListener("click", () => {
      if (this.applied) {
        this.win.close();
      } else {
        void this.onApplyClick(actionButton);
      }
    });

    if (this.rows.length === 0) {
      emptyState.hidden = false;
      tableContainer.hidden = true;
      actionButton.disabled = true;
      overwriteBox.disabled = true;
      return;
    }

    this.table = new VirtualizedTableHelper(this.win)
      .setProp("id", "zotero-lang-cat-table")
      .setProp("getRowCount", () => this.rows.length)
      .setProp("getRowData", (i: number) => this.rowData(i))
      .setProp("columns", [
        {
          dataKey: "creators",
          label: getString("dialog-column-creators"),
          fixedWidth: true,
          width: 130,
        },
        { dataKey: "title", label: getString("dialog-column-title"), flex: 3 },
        {
          dataKey: "change",
          label: getString("dialog-column-change"),
          fixedWidth: true,
          width: 140,
        },
        { dataKey: "status", label: "", fixedWidth: true, width: 32 },
      ])
      .setProp("multiSelect", false)
      .setProp("onSelectionChange", () => {})
      .setProp("onActivate", (_e: Event, indices: number[]) => {
        for (const i of indices) {
          const row = this.rows[i];
          if (row) row.excluded = !row.excluded;
        }
        this.table?.treeInstance.invalidate();
        this.updateActionState();
      })
      .setContainerId("zotero-lang-cat-table-container");

    // Opening the dialog performs the classification immediately (it's fast
    // enough not to need a separate "Preview" step); Apply only writes.
    // render()'s mount is async — treeInstance isn't set until its
    // onfulfilled callback fires, so classify() (which invalidates the
    // tree) must not start until then.
    this.table.render(undefined, () => {
      void this.classify(actionButton);
    });
  }

  rowData(i: number): Record<string, string> {
    const row = this.rows[i];
    const oldValue = row.currentLanguage || "—";
    const newValue = row.code
      ? row.reliable === false
        ? `${row.code} (?)`
        : row.code
      : !this.classified
        ? "…"
        : row.currentLanguage.trim()
          ? getString("dialog-unchanged")
          : "?";
    const change = row.code
      ? `${oldValue} → ${newValue}`
      : this.classified && row.currentLanguage.trim()
        ? `${oldValue} (${newValue})`
        : `${oldValue} → ${newValue}`;
    return {
      title: row.title,
      creators: row.creators,
      change: row.excluded ? `🚫 ${change}` : change,
      status:
        row.status === "success" ? "✓" : row.status === "error" ? "✗" : "",
      highlighted: row.excluded || (this.classified && !row.code) ? "1" : "",
    };
  }

  async classify(actionButton: HTMLButtonElement): Promise<void> {
    const total = this.rows.length;
    const progress = new ProgressWindowHelper(
      getString("progress-classify-headline"),
    )
      .createLine({
        text: getString("progress-items-processed", {
          args: { current: 0, total },
        }),
        progress: 0,
      })
      .show(-1);
    try {
      const classifier = getClassifier();
      let processed = 0;
      for (const group of chunk(this.rows, CHUNK_SIZE)) {
        previewRows(group, classifier, this.options);
        processed += group.length;
        progress.changeLine({
          text: getString("progress-items-processed", {
            args: { current: processed, total },
          }),
          progress: Math.round((processed / total) * 100),
        });
        this.table?.treeInstance.invalidate();
        await new Promise((r) => this.win.setTimeout(r, 0));
      }
    } finally {
      this.classified = true;
      this.updateActionState();
      this.table?.treeInstance.invalidate();
      progress.startCloseTimer(2000);
    }
  }

  onOptionsChange(): void {
    this.options = {
      overwrite: Boolean(this.overwriteBox?.checked),
      convert: Boolean(this.convertBox?.checked),
    };
    for (const row of this.rows) resolveRow(row, this.options);
    this.table?.treeInstance.invalidate();
    this.updateActionState();
  }

  // Apply needs finished classification and at least one pending change.
  updateActionState(): void {
    if (!this.actionButton || this.applied) return;
    this.actionButton.disabled =
      !this.classified || !this.rows.some((r) => r.code && !r.excluded);
  }

  async onApplyClick(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    await this.runApply();
    this.applied = true;
    button.textContent = getString("dialog-done");
    button.disabled = false;
    // Cancel is redundant once changes are applied — there's nothing left
    // to cancel, and "Done" now closes the dialog on its own.
    if (this.cancelButton) this.cancelButton.disabled = true;
    if (this.overwriteBox) this.overwriteBox.disabled = true;
    if (this.convertBox) this.convertBox.disabled = true;
  }

  async runApply(): Promise<void> {
    const toApply = this.rows.filter((r) => r.code && !r.excluded);
    for (const group of chunk(toApply, CHUNK_SIZE)) {
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
      await new Promise((r) => this.win.setTimeout(r, 0));
    }
  }
}
