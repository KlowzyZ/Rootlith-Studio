import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const metadata = JSON.parse(await readFile('package.json','utf8'));
const provenance = JSON.parse(await readFile('assets/brand-provenance.json','utf8'));
assert.equal(metadata.name,'fixflow-studio');
assert.equal(metadata.version,'0.13.0-alpha.1');
assert.equal(metadata.build.productName,'FixFlow Studio');
assert.equal(metadata.build.appId,'org.klowzy.fixflowstudio');
assert.equal(metadata.build.nsis.guid,'c41b684f-fd57-5c09-b4a7-68101139f192');
assert.equal(metadata.build.nsis.perMachine,false);
assert.equal(metadata.build.nsis.allowElevation,false);
assert.equal(metadata.build.nsis.packElevateHelper,false);
assert.equal(metadata.build.nsis.deleteAppDataOnUninstall,false);
assert.equal(metadata.build.nsis.shortcutName,'Rootlith Studio');
assert.equal(metadata.build.toolsets.nsis,'1.2.1');
for(const [file,key] of [['assets/mark.svg','sourceSha256'],['assets/icon.ico','icoSha256'],['public/app-icon.png','pngSha256']]) {
  assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),provenance[key],`Brand asset differs from source manifest: ${file}`);
}
assert.deepEqual(await readFile('assets/mark.svg'),await readFile('public/favicon.svg'));
const ico=await readFile('assets/icon.ico');assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
console.log('PASS: frozen legacy package/install identity, per-user permissions and original multi-size icon provenance');

assert.equal(metadata.build.executableName,undefined);
assert.equal(metadata.build.win.executableName,undefined);
const native=await readFile('apps/desktop/main.ts','utf8');
assert.ok(native.includes('path.join(app.getPath("appData"), "fixflow-studio")'));
assert.ok(native.includes('app.requestSingleInstanceLock()'));
await (await import('./prepare-windows-branding.mjs')).prepareWindowsBranding(true);
console.log('Native friendly-name/upgrade acceptance remains pending; legacy executable filename is intentional.');
