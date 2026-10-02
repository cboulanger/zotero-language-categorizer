import type { LanguageClassifier } from "./types";
import { eldClassifier } from "./eld-classifier";

const registry: Record<string, LanguageClassifier> = {
  [eldClassifier.id]: eldClassifier,
};

const DEFAULT_CLASSIFIER_ID = "eld";

// `id` is unused today (always the default) but is already the extension
// point: a future pref pane would read
// `Zotero.Prefs.get("zotero-lang-cat.classifierId")` and pass it here, with
// no changes needed in scan.ts or the dialog.
export function getClassifier(
  id: string = DEFAULT_CLASSIFIER_ID,
): LanguageClassifier {
  const classifier = registry[id];
  if (!classifier) throw new Error(`Unknown classifier: ${id}`);
  return classifier;
}

export type { ClassificationResult, LanguageClassifier } from "./types";
