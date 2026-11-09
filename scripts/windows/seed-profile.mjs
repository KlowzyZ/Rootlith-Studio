// Refuses any existing profile. Use ONLY a disposable Windows standard-user account.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
if (process.platform !== 'win32' || !process.env.APPDATA) throw Error('Native Windows required');
const profile = path.join(process.env.APPDATA, 'fixflow-studio');
// No recursive/force: an existing profile is a hard stop, even if empty.
await mkdir(profile);
await writeFile(path.join(profile, 'ROOTLITH-SYNTHETIC-VALIDATION.txt'), 'Disposable test account only. No owner data.\n', { flag: 'wx' });
const result = await build({ stdin: { contents: `
import { syntheticRecords } from './scripts/windows/synthetic-workspace';
import { NativeStorage } from './apps/desktop/native-storage';
import path from 'node:path';
const storage = new NativeStorage(path.join(process.env.APPDATA, 'fixflow-studio', 'fixflow-data'));
await storage.initialize(syntheticRecords());
await storage.drain();
`, resolveDir: process.cwd(), sourcefile: 'seed.ts' }, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24' });
await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
console.log('Synthetic profile created. This is fixture preparation, not Windows acceptance.');
