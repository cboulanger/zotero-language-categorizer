import { isIso6391Code } from "./iso639-1";
import { getString } from "../utils/locale";
import { createProgressWindow, runChunked } from "./progress";

export interface ScannableItem {
  isRegularItem(): boolean;
  library: { editable: boolean };
  getField(field: string): string;
}

export function isEligible(item: ScannableItem): boolean {
  if (!item.isRegularItem()) return false;
  if (!item.library.editable) return false;
  const language = item.getField("language") || "";
  if (language.trim() && isIso6391Code(language)) return false;
  const title = item.getField("title") || "";
  const abstractNote = item.getField("abstractNote") || "";
  return Boolean(title.trim() || abstractNote.trim());
}

export function getEligibleItems<T extends ScannableItem>(items: T[]): T[] {
  return items.filter(isEligible);
}

// Touches the live Zotero global — not unit tested, exercised via the manual
// checklist instead. Returns whatever the active pane currently displays
// (respects the user's current collection/search/subcollection/sort state).
//
// Filtering runs in yielding chunks, with a progress popup shown immediately
// (before the first chunk), because a large library/"My Library" view can
// hold tens of thousands of items — `isEligible` calling `getField` per item
// in one unbroken synchronous pass would otherwise freeze the UI for
// seconds with no feedback.
export async function getScopedEligibleItems(
  win: Window,
): Promise<Zotero.Item[]> {
  const pane = Zotero.getActiveZoteroPane();
  if (!pane) return [];
  const items = pane.getSortedItems();
  const eligible: Zotero.Item[] = [];
  const progress = createProgressWindow(
    getString("progress-scan-headline"),
    items.length,
  );
  await runChunked(win, items, progress, (group) => {
    for (const item of group) {
      if (isEligible(item)) eligible.push(item);
    }
  });
  return eligible;
}
