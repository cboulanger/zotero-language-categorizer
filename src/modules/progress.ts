import { ProgressWindowHelper } from "zotero-plugin-toolkit";
import { getString } from "../utils/locale";

export const CHUNK_SIZE = 50;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Shown immediately (before the chunked work below starts) so the user sees
// feedback the instant a slow operation begins, rather than after however
// long the first chunk takes to run.
export function createProgressWindow(
  headline: string,
  total: number,
): ProgressWindowHelper {
  return new ProgressWindowHelper(headline)
    .createLine({
      text: getString("progress-items-processed", {
        args: { current: 0, total },
      }),
      progress: 0,
    })
    .show(-1);
}

export async function runChunked<T>(
  win: Window,
  items: T[],
  progress: ProgressWindowHelper,
  work: (group: T[]) => void | Promise<void>,
): Promise<void> {
  const total = items.length;
  try {
    let processed = 0;
    for (const group of chunk(items, CHUNK_SIZE)) {
      await work(group);
      processed += group.length;
      progress.changeLine({
        text: getString("progress-items-processed", {
          args: { current: processed, total },
        }),
        progress: Math.round((processed / total) * 100),
      });
      await new Promise((r) => win.setTimeout(r, 0));
    }
  } finally {
    progress.startCloseTimer(2000);
  }
}

export async function runWithProgress<T>(
  win: Window,
  items: T[],
  headline: string,
  work: (group: T[]) => void | Promise<void>,
): Promise<void> {
  const progress = createProgressWindow(headline, items.length);
  await runChunked(win, items, progress, work);
}
