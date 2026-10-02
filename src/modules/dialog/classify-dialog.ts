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

export function buildRows(
  items: (ScannableItem & { itemType: string })[],
): RowState[] {
  return items.map((item) => ({
    item,
    title: item.getField("title") || "(no title)",
    itemType: item.itemType,
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
