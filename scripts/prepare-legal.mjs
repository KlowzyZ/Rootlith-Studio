// Copyright (c) 2026 KLOWZY. SPDX-License-Identifier: MIT
import { readFile, mkdir, writeFile, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
const manifest = JSON.parse(await readFile("build/packaging-sources.json", "utf8"));
await mkdir("build/legal/sources", { recursive: true });
for (const item of manifest.archives) {
  const response = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`Source download failed: ${item.file} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== item.bytes || createHash("sha256").update(bytes).digest("hex") !== item.sha256)
    throw Error(`Unverified packaging source: ${item.file}`);
  await writeFile(`build/legal/sources/${item.file}`, bytes);
}
await cp("licenses/packaging", "build/legal/licenses", { recursive: true });
await cp("LICENSE", "build/legal/FixFlow-Studio-MIT.txt");
await cp("node_modules/electron-builder/LICENSE", "build/legal/electron-builder-MIT.txt");
await cp("PACKAGING_NOTICES.md", "build/legal/PACKAGING_NOTICES.md");
await cp("build/shell-plugin", "build/legal/FixFlowShell-source", { recursive: true });
await mkdir("build/legal/template-changes", { recursive: true });
await cp("scripts/prepare-windows-branding.mjs", "build/legal/template-changes/prepare-windows-branding.mjs");
await cp("scripts/prepare-nsis.mjs", "build/legal/template-changes/prepare-nsis.mjs");
await cp("build/installer.nsh", "build/legal/template-changes/installer.nsh");
await writeFile("build/legal/SOURCES.json", JSON.stringify(manifest, null, 2) + "\n");
console.log("Verified and prepared packaging licenses and corresponding sources for distribution.");
