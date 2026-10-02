#!/usr/bin/env node
// Run by semantic-release's exec plugin (.releaserc.json, prepareCmd) with
// the new version as the first argument. Rewrites updates.json — the file
// Zotero polls at a stable URL (see zotero-plugin.config.ts's updateURL) —
// to point at that version's GitHub release asset.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const version = process.argv[2];
if (!version) {
  console.error("Usage: update-updates-json.mjs <version>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const addonID = pkg.config.addonID;
const repoSlug = pkg.repository.url
  .replace(/^git\+https:\/\/github\.com\//, "")
  .replace(/\.git$/, "");

const updatesPath = join(root, "updates.json");
const updates = JSON.parse(readFileSync(updatesPath, "utf8"));

updates.addons[addonID].updates = [
  {
    version,
    update_link: `https://github.com/${repoSlug}/releases/download/v${version}/${pkg.name}.xpi`,
  },
];

writeFileSync(updatesPath, `${JSON.stringify(updates, null, 2)}\n`);
console.log(`updates.json updated to version ${version}`);
