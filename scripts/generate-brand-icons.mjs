// Original SVG geometry -> transparent PNG/ICO. No downloaded assets or fonts.
// Requires the existing Playwright Chromium development browser (npx playwright install chromium).
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = await readFile('assets/mark.svg', 'utf8');
const browser = await chromium.launch();
const chromiumVersion = browser.version();
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
try {
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>${source}`);
    images.push(await page.screenshot({ omitBackground: true }));
    await page.close();
  }
} finally { await browser.close(); }
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const at = 6 + 16 * i;
  header[at] = sizes[i] === 256 ? 0 : sizes[i]; header[at + 1] = header[at];
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(images[i].length, at + 8); header.writeUInt32LE(offset, at + 12);
  offset += images[i].length;
}
await writeFile('assets/icon.ico', Buffer.concat([header, ...images]));
await writeFile('public/app-icon.png', images.at(-1));
console.log(`Generated original Rootlith icons (${sizes.join(', ')}px); SVG SHA-256 ${createHash('sha256').update(source).digest('hex')}`);

await writeFile('assets/brand-provenance.json', JSON.stringify({
  source: 'assets/mark.svg', generator: 'scripts/generate-brand-icons.mjs', chromiumVersion,
  sourceSha256: createHash('sha256').update(source).digest('hex'), sizes,
  icoSha256: createHash('sha256').update(await readFile('assets/icon.ico')).digest('hex'),
  pngSha256: createHash('sha256').update(images.at(-1)).digest('hex'),
  originalProjectArtwork: true, externalAssets: false,
}, null, 2) + '\n');
