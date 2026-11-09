// Copyright (c) 2026 KLOWZY. SPDX-License-Identifier: MIT
// Display resources only. Never modify executable/install names, GUIDs, registry keys or signing order.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const definitions={
 app:{file:'node_modules/app-builder-lib/out/winPackager.js',hash:'ac4ae48193db71cc50be3eeb6017d4e35f934637eac0ae7ef4e0c62fbd9db552',changes:[['FileDescription: appInfo.productName,','FileDescription: "Rootlith Studio",'],['ProductName: appInfo.productName,','ProductName: "Rootlith Studio",']]},
 installer:{file:'node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js',hash:'f91b31d96cae53852f263ed89d2bc406ae2be7ff40ce3539b46e1cafe34a41b9',changes:[['ProductName "${(0, nsisScriptGenerator_1.nsisEscapeString)(appInfo.productName)}"','ProductName "Rootlith Studio"']]},
};
const marker='// Rootlith Studio: display version resources only; legacy install identity retained.\n';
export function transformWindowsBranding(text,kind){
 const d=definitions[kind];if(!d)throw Error('Unknown resource transform');
 let source=text.replaceAll('\r\n','\n');
 if(source.startsWith(marker)){source=source.slice(marker.length);for(const [before,after] of d.changes)source=source.replace(after,before);}
 if(createHash('sha256').update(source).digest('hex')!==d.hash)throw Error(`Unreviewed electron-builder resource source: ${kind}`);
 for(const [before,after] of d.changes){if(source.split(before).length!==2)throw Error('Unexpected resource-string count');source=source.replace(before,after);}
 return marker+source;
}
export async function prepareWindowsBranding(verifyOnly=false){
 for(const [kind,d] of Object.entries(definitions)){const original=await readFile(d.file,'utf8');const result=transformWindowsBranding(original,kind);if(!verifyOnly)await writeFile(d.file,result);}
 console.log(verifyOnly?'PASS: locked Windows display-resource transforms; no files changed':'Prepared Rootlith Windows display resources; executable and install identities unchanged.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await prepareWindowsBranding(process.argv.includes('--verify'));
