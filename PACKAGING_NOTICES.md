# Windows redistribution obligations

Application and FixFlowShell source are MIT, copyright KLOWZY. Source publication includes no executable or third-party source archive. Windows binary redistribution is a separate gate. WinShell is excluded: its freeware label does not establish redistribution permission. The original shell replacement uses documented Windows APIs. Preserve all license notices and the matching component sources; never substitute upstream versions without review.

## Components and corresponding source

| Component | Terms / delivery |
|---|---|
| FixFlowShell | Original MIT source and project license included in `resources/legal/` |
| electron-builder templates | MIT; upstream license retained, modified templates explicitly marked |
| NSIS 3.12 stub and official System/nsDialogs/nsExec plugins | NSIS zlib/libpng terms, with separate compression-module terms in COPYING; full v312 source archive provided |
| StdUtils 1.14 | LGPL-2.1-or-later with installer clarification; pinned complete source, license, clarification and rhash/blake2 notices provided |
| nsis7z 19.00 | Matched distribution's LZMA SDK public-domain terms and author readme retained; plugin source distribution plus complete LZMA SDK 19.00 provided |
| UAC plugin | zlib/libpng terms and source/binary distribution retained; presence is not evidence that elevation is requested |
| Electron/Chromium | `LICENSE.electron.txt` and `LICENSES.chromium.html` alongside application executable |
| Runtime npm packages | MIT/ISC/BSD notices in `THIRD_PARTY_NOTICES.md` and original package files |

The compiler is pinned through electron-builder toolset `nsis: 1.2.1` (NSIS 3.12 bundle, SHA-256 `56997fdefe25e7928a1a68b4583d08b240b66cf660234053b20131a74cc082f4`). It replaces the legacy 3.0.4.1 toolset. `build/packaging-sources.json` pins archive URLs, sizes and SHA-256 values. Preparation fails on a failed download or mismatch. Required source/terms are copied into **each application's `resources/legal/`**, so delivery does not depend on future upstream availability or a written source offer. No WinShell binary is included in that legal bundle.

Targeted Windows evidence must enumerate setup, portable and uninstaller wrappers, reject WinShell or unknown DLLs, match every DLL to the reviewed toolset/original build, verify bundled source hashes and preserve shortcut identity. Results and build SHA belong in `WRAPPER_COMPONENTS.json`, `DISTRIBUTION_ACCEPTANCE.json`, `STANDARD_USER_ACCEPTANCE.json` and `BUILD_INFO.json`. Do not claim these checks passed before the corresponding run succeeds.


Electron must retain LICENSE.electron.txt and LICENSES.chromium.html. Modified electron-builder templates and display-resource transformations are marked and must accompany delivery. Preserve the legacy package/appId/GUID/profile identities. No native Windows validation or binary distribution approval is implied by this source review.
