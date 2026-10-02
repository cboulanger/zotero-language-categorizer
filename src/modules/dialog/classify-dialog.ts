import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import { getClassifier } from "../classifiers";
import { getString } from "../../utils/locale";
import type { LanguageClassifier } from "../classifiers/types";
import type { ScannableItem } from "../scan";

export interface RowState {
  item: ScannableItem;
  title: string;
  creators: string;
  currentLanguage: string;
  code: string | null;
  reliable: boolean | null;
  status: "pending" | "success" | "error";
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
    try {
      const title = row.item.getField("title") || "";
      const abstractNote = row.item.getField("abstractNote") || "";
      const text = [title, abstractNote].filter(Boolean).join("\n");
      const result = classifier.classify(text);
      row.code = result?.code ?? null;
      row.reliable = result?.reliable ?? null;
    } catch (e) {
      row.code = null;
      row.reliable = null;
    }
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
  applied = false;
  private cancelButton?: HTMLButtonElement;

  constructor(
    private win: Window,
    rows: RowState[],
  ) {
    this.rows = rows;
  }

  init(): void {
    const doc = this.win.document;
    const heading = doc.getElementById("zotero-lang-cat-heading") as HTMLElement;
    const explanation = doc.getElementById(
      "zotero-lang-cat-explanation",
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
    this.cancelButton = cancelButton;

    doc.title = getString("dialog-title");
    heading.textContent = getString("dialog-heading");
    explanation.textContent = getString("dialog-explanation");
    emptyState.textContent = getString("dialog-empty-state");
    cancelButton.textContent = getString("dialog-cancel");
    actionButton.textContent = getString("dialog-apply");

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
      .setContainerId("zotero-lang-cat-table-container");
    this.table.render();

    // Opening the dialog performs the classification immediately (it's fast
    // enough not to need a separate "Preview" step); Apply only writes.
    void this.classify(actionButton);
  }

  rowData(i: number): Record<string, string> {
    const row = this.rows[i];
    const oldValue = row.currentLanguage || "—";
    const newValue = row.code
      ? row.reliable === false
        ? `${row.code} (?)`
        : row.code
      : "…";
    return {
      title: row.title,
      creators: row.creators,
      change: `${oldValue} → ${newValue}`,
      status:
        row.status === "success" ? "✓" : row.status === "error" ? "✗" : "",
    };
  }

  async classify(actionButton: HTMLButtonElement): Promise<void> {
    try {
      const classifier = getClassifier();
      for (const group of chunk(this.rows, CHUNK_SIZE)) {
        previewRows(group, classifier);
        this.table?.treeInstance.invalidate();
        await new Promise((r) => this.win.setTimeout(r, 0));
      }
    } finally {
      actionButton.disabled = false;
    }
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
