import { VirtualizedTableHelper } from "zotero-plugin-toolkit";
import { getClassifier } from "../classifiers";
import { getString } from "../../utils/locale";
import { isIso6391Code } from "../iso639-1";
import { runWithProgress } from "../progress";
import { filterEligibleItems } from "../scan";
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
      if (row.reliable === false) row.excluded = true;
    } catch (e) {
      row.code = null;
      row.reliable = null;
    }
  }
}

// Commits a manually-typed predicted code. Editing counts as confirming the
// row (same as the double-click toggle), since a user-supplied value is no
// longer a low-confidence guess.
export function commitCodeEdit(row: RowState, rawValue: string): boolean {
  const value = rawValue.trim().toLowerCase();
  if (!isIso6391Code(value)) return false;
  row.code = value.split(/[-_]/)[0];
  row.excluded = false;
  row.reliable = true;
  return true;
}

type ApplyableItem = ScannableItem & {
  getCreators(): CreatorLike[];
  setField(field: string, value: string): void;
  saveTx(): Promise<unknown>;
};

export const DIALOG_WINDOW_TYPE = "zotero-lang-cat:dialog";

// Idempotent: focuses the existing dialog instead of opening a second one
// if the user triggers the menu entry again while it's already open.
//
// `items` must be captured by the caller before this opens the dialog
// window — see getScopedItems's doc comment for why it can't be looked up
// from inside the dialog itself.
export function openClassifyDialog(items: ApplyableItem[]): void {
  const existing = Services.wm.getMostRecentWindow(DIALOG_WINDOW_TYPE) as
    (Window & { focus(): void }) | null;
  if (existing) {
    existing.focus();
    return;
  }

  const win = Zotero.getMainWindow();
  win.openDialog(
    "chrome://zotero-lang-cat/content/dialog/classify.xhtml",
    "zotero-lang-cat-dialog",
    "chrome,centerscreen,resizable=yes,width=700,height=500",
    { items },
  );
}

export class DialogController {
  table?: VirtualizedTableHelper;
  rows: RowState[];
  applied = false;
  private cancelled = false;
  private busy = false;
  private cancelButton?: HTMLButtonElement;
  private emptyState?: HTMLElement;
  private tableContainer?: HTMLElement;
  private activeEditor?: HTMLInputElement;

  constructor(
    private win: Window,
    rows: RowState[] = [],
    private itemsToScan: ApplyableItem[] = [],
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
    const editHint = doc.getElementById(
      "zotero-lang-cat-edit-hint",
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
    this.emptyState = emptyState;
    this.tableContainer = tableContainer;

    doc.title = getString("dialog-title");
    heading.textContent = getString("dialog-heading");
    explanation.textContent = getString("dialog-explanation");
    skipHint.textContent = getString("dialog-skip-hint");
    editHint.textContent = getString("dialog-edit-hint");
    cancelButton.textContent = getString("dialog-cancel");
    actionButton.textContent = getString("dialog-apply");

    const isoLinkHref = getString("dialog-iso-link-href");
    isoLink.textContent = getString("dialog-iso-link-text");
    isoLink.href = isoLinkHref;
    isoLink.addEventListener("click", (e) => {
      e.preventDefault();
      Zotero.launchURL(isoLinkHref);
    });

    // Cancel is live through every phase (scanning, classifying, applying):
    // it flags cancellation for whichever chunked loop is running, which
    // stops at its next chunk boundary and closes the window itself (via
    // the `busy` check in each phase's `finally`) — closing here instead,
    // while a loop still holds a `this.win.setTimeout` in flight, would
    // tear down the window out from under it.
    cancelButton.addEventListener("click", () => {
      this.cancelled = true;
      cancelButton.disabled = true;
      if (!this.busy) this.win.close();
    });
    actionButton.addEventListener("click", () => {
      if (this.applied) {
        this.win.close();
      } else {
        void this.onApplyClick(actionButton);
      }
    });

    emptyState.textContent = getString("dialog-scanning");
    emptyState.hidden = false;
    tableContainer.hidden = true;

    void this.scanAndClassify(actionButton);
  }

  private async scanAndClassify(
    actionButton: HTMLButtonElement,
  ): Promise<void> {
    const emptyState = this.emptyState!;
    const tableContainer = this.tableContainer!;
    this.busy = true;
    try {
      const items = await filterEligibleItems(
        this.itemsToScan,
        this.win,
        () => this.cancelled,
      );
      if (this.cancelled) return;

      this.rows = buildRows(items);
      if (this.rows.length === 0) {
        emptyState.textContent = getString("dialog-empty-state");
        actionButton.disabled = true;
        return;
      }

      emptyState.hidden = true;
      tableContainer.hidden = false;
      const table = this.setupTable();
      // render()'s mount is async — treeInstance isn't set until its
      // onfulfilled callback fires, so classify() (which invalidates the
      // tree) must not start until then.
      table.render(undefined, () => {
        void this.classify(actionButton);
      });
    } finally {
      this.busy = false;
      if (this.cancelled) this.win.close();
    }
  }

  private setupTable(): VirtualizedTableHelper {
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
          dataKey: "current",
          label: getString("dialog-column-current"),
          fixedWidth: true,
          width: 60,
        },
        {
          dataKey: "predicted",
          label: getString("dialog-column-predicted"),
          fixedWidth: true,
          width: 110,
        },
        { dataKey: "status", label: "", fixedWidth: true, width: 32 },
      ])
      .setProp("multiSelect", false)
      .setProp("onSelectionChange", () => {})
      .setProp("onActivate", (e: Event, indices: number[]) => {
        const index = indices[0];
        const row = index !== undefined ? this.rows[index] : undefined;
        const target = (e as MouseEvent).target as Element | null;
        const isPredictedCell = !!target?.closest(".cell.predicted");

        if (row && isPredictedCell && !this.busy && !this.applied) {
          this.startCodeEdit(index, row);
          return;
        }
        for (const i of indices) {
          const r = this.rows[i];
          if (r) r.excluded = !r.excluded;
        }
        this.table?.treeInstance.invalidate();
      })
      .setContainerId("zotero-lang-cat-table-container");
    return this.table;
  }

  // Opens a floating text input over the Predicted cell for row `index`,
  // positioned via getBoundingClientRect() since the table's cells are
  // plain rendered spans, not individually-embeddable DOM nodes.
  private startCodeEdit(index: number, row: RowState): void {
    this.closeCodeEdit(); // commit/cancel any editor already open

    const cellEl = this.win.document.querySelector(
      `#zotero-lang-cat-table-row-${index} .cell.predicted`,
    );
    if (!cellEl || !(cellEl instanceof this.win.HTMLElement)) return;

    const rect = cellEl.getBoundingClientRect();
    const input = this.win.document.createElement("input");
    input.className = "zotero-lang-cat-code-editor";
    input.value = row.code ?? "";
    // Known limitation: the editor doesn't reposition or close on table
    // scroll or window resize, so it can visually drift from its cell if
    // the user scrolls/resizes mid-edit. Not handled — out of scope for
    // this task.
    Object.assign(input.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    const commit = () => {
      // `remove()`-ing a focused element synchronously fires a native
      // `blur` on it, which would re-enter `commit` through the listener
      // below even though the node is already detached. Guarding on
      // reference equality to `this.activeEditor` (cleared by
      // `closeCodeEdit` before the node is removed) makes this a no-op on
      // that re-entrant call.
      if (this.activeEditor !== input) return;
      if (commitCodeEdit(row, input.value)) {
        this.closeCodeEdit();
        this.table?.treeInstance.invalidate();
      } else {
        input.classList.add("invalid");
      }
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => {
      // This Gecko-flavored dom lib types "keydown" as the base Event, not
      // KeyboardEvent, so `.key` needs a cast.
      const key = (ev as KeyboardEvent).key;
      if (key === "Enter") commit();
      if (key === "Escape") this.closeCodeEdit();
    });

    this.win.document.body!.appendChild(input);
    input.focus();
    input.select();
    this.activeEditor = input;
  }

  private closeCodeEdit(): void {
    const editor = this.activeEditor;
    this.activeEditor = undefined;
    editor?.remove();
  }

  rowData(i: number): Record<string, string> {
    const row = this.rows[i];
    const current = row.currentLanguage || "—";
    const predicted = row.code
      ? row.excluded && row.reliable === false
        ? `${row.code} (?)`
        : row.code
      : "…";
    return {
      title: row.title,
      creators: row.creators,
      current,
      predicted: row.excluded ? `🚫 ${predicted}` : predicted,
      status:
        row.status === "success" ? "✓" : row.status === "error" ? "✗" : "",
      highlighted: row.excluded ? "1" : "",
    };
  }

  async classify(actionButton: HTMLButtonElement): Promise<void> {
    this.busy = true;
    try {
      const classifier = getClassifier();
      await runWithProgress(
        this.win,
        this.rows,
        getString("progress-classify-headline"),
        (group) => {
          previewRows(group, classifier);
          this.table?.treeInstance.invalidate();
        },
        () => this.cancelled,
      );
    } finally {
      this.busy = false;
      if (this.cancelled) {
        this.win.close();
      } else {
        actionButton.disabled = false;
      }
    }
  }

  async onApplyClick(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    await this.runApply();
    if (this.cancelled) return;
    this.applied = true;
    button.textContent = getString("dialog-done");
    button.disabled = false;
    // Cancel is redundant once changes are applied — there's nothing left
    // to cancel, and "Done" now closes the dialog on its own.
    if (this.cancelButton) this.cancelButton.disabled = true;
  }

  async runApply(): Promise<void> {
    this.busy = true;
    try {
      const toApply = this.rows.filter((r) => r.code && !r.excluded);
      await runWithProgress(
        this.win,
        toApply,
        getString("progress-apply-headline"),
        async (group) => {
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
        },
        () => this.cancelled,
      );
    } finally {
      this.busy = false;
      if (this.cancelled) this.win.close();
    }
  }
}
