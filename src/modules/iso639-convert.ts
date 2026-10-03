import { iso6393To1 } from "iso-639-3/iso6393-to-1.js";
import { iso6393To2B } from "iso-639-3/iso6393-to-2b.js";
import { iso6393To2T } from "iso-639-3/iso6393-to-2t.js";
import { isIso6391Code } from "./iso639-1";

let index: Map<string, string> | undefined;

function buildIndex(locales: string[]): Map<string, string> {
  const map = new Map<string, string>();
  // 639-3 → 639-1 (also covers 639-2/T, which equals 639-3 for these)
  for (const [code3, code1] of Object.entries(iso6393To1)) {
    map.set(code3, code1);
    const b = (iso6393To2B as Record<string, string>)[code3];
    if (b) map.set(b, code1);
    const t = (iso6393To2T as Record<string, string>)[code3];
    if (t) map.set(t, code1);
  }
  // Language names (e.g. "German", "Deutsch") via the platform's own data.
  for (const locale of locales) {
    let names: Intl.DisplayNames;
    try {
      names = new Intl.DisplayNames([locale], { type: "language" });
    } catch (e) {
      continue;
    }
    for (const code1 of new Set(Object.values(iso6393To1))) {
      const name = names.of(code1);
      if (name && name.toLowerCase() !== code1) {
        const key = name.trim().toLowerCase();
        if (!map.has(key)) map.set(key, code1);
      }
    }
  }
  return map;
}

// Maps a legacy language value (3-letter ISO 639-2/639-3 code or a spelled-out
// language name) to its ISO 639-1 code; null if unmappable. Already-valid
// 639-1 values are not "converted" and return null.
export function convertLanguageValue(
  value: string,
  locales: string[] = ["en"],
): string | null {
  const key = value.trim().toLowerCase();
  if (!key || isIso6391Code(key)) return null;
  index ??= buildIndex(locales);
  return index.get(key) ?? null;
}

export function resetConvertIndexForTests(): void {
  index = undefined;
}
