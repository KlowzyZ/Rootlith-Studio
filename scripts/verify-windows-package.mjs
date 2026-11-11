// Copyright (c) 2026 KLOWZY. SPDX-License-Identifier: MIT
// Content/integrity evidence only: never establishes native acceptance or publisher trust.
import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractFile } from '@electron/asar';
import { pathToFileURL } from 'node:url';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyLegal(root, manifest) {
  for (const item of manifest.archives) {
    assert.equal(path.basename(item.file), item.file);
    const bytes = await readFile(path.join(root, 'sources', item.file));
    assert.equal(bytes.length, item.bytes, item.file);
    assert.equal(sha256(bytes), item.sha256, item.file);
  }
  for (const [source, bundled] of [
    ['LICENSE', 'FixFlow-Studio-MIT.txt'],
    ['PACKAGING_NOTICES.md', 'PACKAGING_NOTICES.md'],
    ['node_modules/electron-builder/LICENSE', 'electron-builder-MIT.txt'],
    ['build/packaging-sources.json', 'SOURCES.json'],
    ...['FixFlowShell.cpp', 'FixFlowShell.def'].map(f => [`build/shell-plugin/${f}`, `FixFlowShell-source/${f}`]),
    ...['prepare-nsis.mjs', 'prepare-windows-branding.mjs'].map(f => [`scripts/${f}`, `template-changes/${f}`]),
    ['build/installer.nsh', 'template-changes/installer.nsh'],
    ...(await readdir('licenses/packaging')).map(f => [`licenses/packaging/${f}`, `licenses/${f}`]),
  ]) {
    const expected = await readFile(source), actual = await readFile(path.join(root, bundled));
    if (bundled === 'SOURCES.json') assert.deepEqual(JSON.parse(actual), JSON.parse(expected));
    else assert.deepEqual(actual, expected, bundled);
  }
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), 'Unexpected legal symlink');
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else assert(!/\.(exe|dll|com|bat|cmd|ps1)$/i.test(entry.name), `Executable in legal bundle: ${full}`);
    }
  }
  await walk(root);
}
export async function verifyWindowsPackage(output = 'release') {
  const pkg = JSON.parse(await readFile('package.json'));
  const unpacked = path.join(output, 'win-unpacked');
  for (const file of ['FixFlow Studio.exe', 'LICENSE.electron.txt', 'LICENSES.chromium.html']) {
    assert((await stat(path.join(unpacked, file))).size > 0, `Missing ${file}`);
  }
  const resources = await readdir(path.join(unpacked, 'resources'));
  assert(!resources.some(name => name.toLowerCase() === 'elevate.exe'), 'Unexpected updater elevation helper in application payload');
  const asar = path.join(unpacked, 'resources', 'app.asar');
  const bundled = JSON.parse(extractFile(asar, 'package.json'));
  assert.equal(bundled.name, 'fixflow-studio');
  assert.equal(bundled.version, pkg.version);
  assert.equal(bundled.main, 'dist-electron/main.cjs');
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'PACKAGING_NOTICES.md', 'dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs']) {
    assert.deepEqual(extractFile(asar, file), await readFile(file), `Bundled content differs: ${file}`);
  }
  const manifest = JSON.parse(await readFile('build/packaging-sources.json'));
  await verifyLegal(path.join(unpacked, 'resources', 'legal'), manifest);
  const artifacts = [];
  for (const mode of ['setup', 'portable']) {
    const name = `Rootlith-Studio-${pkg.version}-x64-${mode}.exe`;
    const bytes = await readFile(path.join(output, name));
    assert.equal(bytes.subarray(0, 2).toString(), 'MZ', `Invalid PE: ${name}`);
    artifacts.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const report = {
    format: 1, version: pkg.version, artifacts,
    checked: ['unpacked application identity and exact built JS', 'no unpacked updater elevation helper', 'unpacked legal source hashes and notices', 'setup/portable presence and hashes'],
    unverified: ['embedded wrapper/component inventory', 'each wrapper extraction matches unpacked payload', 'Authenticode publisher trust', 'native launch/install/upgrade/uninstall/portable acceptance'],
  };
  await writeFile(path.join(output, 'PACKAGE_CONTENTS.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyWindowsPackage(process.argv[2]);
