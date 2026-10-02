import { isIso6391Code } from "./iso639-1";

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
export function getScopedEligibleItems(): Zotero.Item[] {
  const pane = Zotero.getActiveZoteroPane();
  const items = pane.getSortedItems();
  return getEligibleItems(items);
}
