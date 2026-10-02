import {
  ProgressWindowHelper,
  VirtualizedTableHelper,
} from "zotero-plugin-toolkit";
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
    code: null,
    reliable: null,
    status: "pending",
    excluded: false,
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
  private cancelButton?: HTMLButtonElement;

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
    this.cancelButton = cancelButton;

    doc.title = getString("dialog-title");
    heading.textContent = getString("dialog-heading");
    explanation.textContent = getString("dialog-explanation");
    emptyState.textContent = getString("dialog-empty-state");
    cancelButton.textContent = getString("dialog-cancel");
    actionButton.textContent = getString("dialog-apply");

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
      : "…";
    const change = `${oldValue} → ${newValue}`;
    return {
      title: row.title,
      creators: row.creators,
      change: row.excluded ? `🚫 ${change}` : change,
      status:
        row.status === "success" ? "✓" : row.status === "error" ? "✗" : "",
      highlighted: row.excluded ? "1" : "",
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
        previewRows(group, classifier);
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
      actionButton.disabled = false;
      progress.startCloseTimer(2000);
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
