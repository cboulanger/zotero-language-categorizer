import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import { getClassifier } from "../classifiers";
import type { LanguageClassifier } from "../classifiers/types";
import type { ScannableItem } from "../scan";

export interface RowState {
  item: ScannableItem;
  title: string;
  itemType: string;
  currentLanguage: string;
  code: string | null;
  reliable: boolean | null;
  status: "pending" | "success" | "error";
}

export function buildRows(
  items: (ScannableItem & { itemType: string })[],
): RowState[] {
  return items.map((item) => ({
    item,
    title: item.getField("title") || "(no title)",
    itemType: item.itemType,
    currentLanguage: item.getField("language") || "",
    code: null,
    reliable: null,
    status: "pending",
  }));
}

export function previewRows(
  rows: RowState[],
  classifier: LanguageClassifier,
): void {
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

type ApplyableItem = ScannableItem & {
  itemType: string;
  setField(field: string, value: string): void;
  saveTx(): Promise<unknown>;
};

export function openClassifyDialog(items: ApplyableItem[]): void {
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
  mode: "preview" | "apply" = "preview";

  constructor(
    private win: Window,
    rows: RowState[],
  ) {
    this.rows = rows;
  }

  init(): void {
    const doc = this.win.document;
    const emptyState = doc.getElementById(
      "zotero-lang-cat-empty-state",
    ) as HTMLElement;
    const tableContainer = doc.getElementById(
      "zotero-lang-cat-table-container",
    ) as HTMLElement;
    const actionButton = doc.getElementById(
      "zotero-lang-cat-action",
    ) as HTMLButtonElement;
    const closeButton = doc.getElementById(
      "zotero-lang-cat-close",
    ) as HTMLButtonElement;

    closeButton.addEventListener("click", () => this.win.close());

    if (this.rows.length === 0) {
      emptyState.hidden = false;
      tableContainer.hidden = true;
      actionButton.disabled = true;
      return;
    }

    this.table = new VirtualizedTableHelper(this.win)
      .setProp("id", "zotero-lang-cat-table")
      .setProp("getRowCount", () => this.rows.length)
      .setProp("getRowData", (i: number) => this.rowData(i))
      .setProp("columns", [
        { dataKey: "title", label: "Title", flex: 3 },
        { dataKey: "itemType", label: "Type", fixedWidth: true, width: 110 },
        { dataKey: "currentLanguage", label: "Current", fixedWidth: true, width: 90 },
        { dataKey: "code", label: "Detected", fixedWidth: true, width: 80 },
        { dataKey: "status", label: "", fixedWidth: true, width: 32 },
      ])
      .setProp("multiSelect", false)
      .setProp("onSelectionChange", () => {})
      .setContainerId("zotero-lang-cat-table-container");
    this.table.render();

    actionButton.addEventListener("click", () => this.onActionClick(actionButton));
  }

  rowData(i: number): Record<string, string> {
    const row = this.rows[i];
    const code = row.code ?? "";
    return {
      title: row.title,
      itemType: row.itemType,
      currentLanguage: row.currentLanguage,
      code: row.reliable === false && code ? `${code} (?)` : code,
      status:
        row.status === "success" ? "✓" : row.status === "error" ? "✗" : "",
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
    const toApply = this.rows.filter((r) => r.code);
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
