// Copyright (c) 2026 KLOWZY. SPDX-License-Identifier: MIT
// Narrow, version/hash-guarded transformation of MIT-licensed electron-builder templates.
// Fail closed on upstream changes; npm ci restores the originals.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const files = [
  ["include/installer.nsh", "0e319437dd01dcbf911f3f48f664fde0cefbaef704f1cdb1739f63d563f5d4a0", 7],
  ["uninstaller.nsh", "9ee2dac4593478083e8aa6f8487287ce9401006ccd50ecc538871d133ea4a42c", 3],
];
const marker = "; FixFlow Studio: original MIT shell replacement; upstream template altered.\n";
for (const [file, expected, count] of files) {
  const target = `node_modules/app-builder-lib/templates/nsis/${file}`;
  let source = (await readFile(target, "utf8")).replaceAll("\r\n", "\n");
  if (source.startsWith(marker)) source = source.slice(marker.length).replaceAll("!insertmacro FixFlowShell_", "WinShell::");
  if (hash(source) !== expected) throw Error(`Unreviewed electron-builder template: ${file}`);
  const matches = [...source.matchAll(/WinShell::(SetLnkAUMI|UninstShortcut|UninstAppUserModelId)/g)];
  if (matches.length !== count) throw Error(`Unexpected shell call count: ${file}`);
  const result = marker + source.replaceAll("WinShell::", "!insertmacro FixFlowShell_");
  if (result.includes("WinShell::")) throw Error("Unreplaced WinShell invocation");
  await writeFile(target, result);
}
console.log("Prepared reviewed NSIS templates with original MIT FixFlowShell replacement.");

// The locked common template defines visible Name/BrandingText exactly once.
// Change only those display strings, never PRODUCT_FILENAME, APP_FILENAME or app/GUID definitions.
const commonPath = "node_modules/app-builder-lib/templates/nsis/common.nsh";
const commonMarker = "; Rootlith Studio: visible labels only; legacy file/install identities retained.\n";
const substitutions = [
  ['BrandingText "${PRODUCT_NAME} ${VERSION}"', 'BrandingText "Rootlith Studio | Private branded preview"'],
  ['!searchreplace DoubleAmpersand "${PRODUCT_NAME}" "&" "&&"', '!searchreplace DoubleAmpersand "Rootlith Studio" "&" "&&"'],
  ['Name "${PRODUCT_NAME}" "${DoubleAmpersand}"', 'Name "Rootlith Studio" "${DoubleAmpersand}"'],
];
let common = (await readFile(commonPath, "utf8")).replaceAll("\r\n", "\n");
if (common.startsWith(commonMarker)) {
  common = common.slice(commonMarker.length);
  for (const [before, after] of substitutions) common = common.replace(after, before);
}
if (hash(common) !== "281e8071663d2ef3e9f00bb27e6ef09d2c2b52b85458da07082f2b186100e259")
  throw Error("Unreviewed electron-builder common display template");
for (const [before, after] of substitutions) {
  if (common.split(before).length !== 2) throw Error("Unexpected NSIS display-string count");
  common = common.replace(before, after);
}
await writeFile(commonPath, commonMarker + common);
console.log("Prepared installer/portable display names without changing legacy file/install identifiers.");

// Prepare PE/NSIS version display resources before electron-builder resource editing/signing.
await (await import('./prepare-windows-branding.mjs')).prepareWindowsBranding();
