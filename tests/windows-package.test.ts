import { test, expect } from 'vitest';
import { syntheticRecords } from '../scripts/windows/synthetic-workspace';
import { NativeStorage } from '../apps/desktop/native-storage';
import { emptyRecords } from '../packages/core/native-contract';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
test('Windows synthetic fixture round-trips native primary, backup, draft and raw recovery without rewriting bytes on restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'rootlith-validation-'));
  try {
    const records = syntheticRecords();
    const storage = new NativeStorage(directory);
    expect((await storage.initialize(records)).records).toEqual(records);
    await storage.drain();
    const before = await readFile(path.join(directory, 'state.json'));
    const restarted = new NativeStorage(directory);
    expect((await restarted.initialize(emptyRecords())).records).toEqual(records);
    expect(await readFile(path.join(directory, 'state.json'))).toEqual(before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legal verifier accepts matching sources and rejects tampered sources and stray executables', async () => {
  const { execFileSync } = await import('node:child_process');
  // Run the distributable JS verifier directly, with isolated temporary legal files.
  const code = `
    import { verifyLegal, sha256 } from './scripts/verify-windows-package.mjs';
    import { mkdtemp, cp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import path from 'node:path';
    import assert from 'node:assert/strict';
    const root = await mkdtemp(path.join(tmpdir(), 'rootlith-legal-'));
    try {
      await mkdir(path.join(root, 'sources'));
      await cp('licenses/packaging', path.join(root, 'licenses'), { recursive: true });
      await cp('build/shell-plugin', path.join(root, 'FixFlowShell-source'), { recursive: true });
      await mkdir(path.join(root, 'template-changes'));
      for (const [from, to] of [['LICENSE','FixFlow-Studio-MIT.txt'], ['PACKAGING_NOTICES.md','PACKAGING_NOTICES.md'], ['node_modules/electron-builder/LICENSE','electron-builder-MIT.txt'], ['build/packaging-sources.json','SOURCES.json'], ['scripts/prepare-nsis.mjs','template-changes/prepare-nsis.mjs'], ['scripts/prepare-windows-branding.mjs','template-changes/prepare-windows-branding.mjs'], ['build/installer.nsh','template-changes/installer.nsh']]) await cp(from, path.join(root, to));
      const bytes = Buffer.from('synthetic archive');
      const manifest = { archives: [{file:'fixture.zip',bytes:bytes.length,sha256:sha256(bytes)}] };
      await writeFile(path.join(root,'sources/fixture.zip'),bytes);
      await verifyLegal(root, manifest);
      await writeFile(path.join(root,'sources/fixture.zip'),'tampered archive');
      await assert.rejects(verifyLegal(root, manifest));
      await writeFile(path.join(root,'sources/fixture.zip'),bytes);
      await writeFile(path.join(root,'unexpected.dll'),'MZ');
      await assert.rejects(verifyLegal(root, manifest), /Executable in legal bundle/);
      await rm(path.join(root,'unexpected.dll'));
      await writeFile(path.join(root,'template-changes/installer.nsh'),'changed');
      await assert.rejects(verifyLegal(root, manifest));
    } finally { await rm(root,{recursive:true,force:true}); }
  `;
  expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', code])).not.toThrow();
});
