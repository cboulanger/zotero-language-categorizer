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
// Must be called before any secondary window (e.g. the classify dialog)
// steals focus: `getActiveZoteroPane` resolves to whatever window currently
// has it, so calling this after a dialog has opened can silently return the
// wrong pane (or none) instead of the one the user had selected when they
// triggered the command.
export function getScopedItems(): Zotero.Item[] {
  const pane = Zotero.getActiveZoteroPane();
  return pane ? pane.getSortedItems() : [];
}

// Filtering runs in yielding chunks, with a progress popup shown immediately
// (before the first chunk), because a large library/"My Library" view can
// hold tens of thousands of items — `isEligible` calling `getField` per item
// in one unbroken synchronous pass would otherwise freeze the UI for
// seconds with no feedback. Takes the already-captured item list (see
// `getScopedItems`) rather than looking up the active pane itself, since by
// the time this runs the classify dialog is open and may have focus.
export async function filterEligibleItems<T extends ScannableItem>(
  items: T[],
  win: Window,
  shouldStop?: () => boolean,
): Promise<T[]> {
  const eligible: T[] = [];
  const progress = createProgressWindow(
    getString("progress-scan-headline"),
    items.length,
  );
  await runChunked(
    win,
    items,
    progress,
    (group) => {
      for (const item of group) {
        if (isEligible(item)) eligible.push(item);
      }
    },
    shouldStop,
  );
  return eligible;
}
