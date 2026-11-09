import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
test("Windows resource transform is hash-guarded, idempotent and preserves installer definitions", () => {
  const code = `import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {transformWindowsBranding} from './scripts/prepare-windows-branding.mjs';
 for(const [kind,path] of [['app','node_modules/app-builder-lib/out/winPackager.js'],['installer','node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js']]){const text=await readFile(path,'utf8');const changed=transformWindowsBranding(text,kind);assert.equal(transformWindowsBranding(changed,kind),changed);assert.throws(()=>transformWindowsBranding(text+'\\n// changed',kind));if(kind==='app'){assert.ok(changed.includes('FileDescription: "Rootlith Studio"'));assert.ok(changed.includes('ProductName: "Rootlith Studio"'));}else{for(const def of ['APP_ID: appInfo.id','APP_GUID: guid','PRODUCT_FILENAME: appInfo.productFilename','APP_FILENAME: (0, targetUtil_1.getWindowsInstallationDirName)'])assert.ok(changed.includes(def));}}`;
  expect(() =>
    execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: process.cwd(),
    }),
  ).not.toThrow();
});
test("desktop keeps renderer isolation and trusted official-link IPC", () => {
 const main = readFileSync("apps/desktop/main.ts", "utf8");
 for (const invariant of ["contextIsolation: true", "sandbox: true", "nodeIntegration: false"]) expect(main).toContain(invariant);
 expect(main).toMatch(/ipcMain.handle\("open-official-link",[\s\S]*?trusted\(event\)/);
});
