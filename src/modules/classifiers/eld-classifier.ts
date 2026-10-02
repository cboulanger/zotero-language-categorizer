import { eld } from "eld/extrasmall";
import type { LanguageClassifier } from "./types";

export const eldClassifier: LanguageClassifier = {
  id: "eld",
  classify(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const result = eld.detect(trimmed);
    if (!result.language) return null;
    return { code: result.language, reliable: result.isReliable() };
  },
};
