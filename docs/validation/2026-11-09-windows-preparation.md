# Windows release preparation evidence — 2026-11-09

Status: **not release ready; no Windows binaries built or published**.

Baseline public main: `1542cc759c086fd6fd49b8a9cce7460bc13eda6f` (merged PR #4); PR #3 is also merged. Candidate changes are the commit containing this report (record exact `git rev-parse HEAD` on Windows). Package version remains `0.13.0-alpha.1`. Main reports `protected: true`; detailed protection API returned 403. Public release listing was empty. The internal repository was not accessed or changed.

Host: Linux x64, Node v24.22.1, npm 11.9.0. No native Windows runtime, graphical Windows session, Windows standard-user account, MSVC, PowerShell or NSIS compiler execution was available. No Wine-based acceptance was attempted. Lockfile SHA-256: `4dbbcccc8a16df7d9c698b066a47e285ba18bf3f0ea01f968a95ac0ac93e8a30` (unchanged).

## Exercised

* `npm ci`, lint, typecheck, all 109 existing tests, build, identity verification: passed on the baseline; lint/typecheck and both new targeted tests also passed after implementation. PR CI supplies the final full-suite result.
* `npm run audit:deps`: passed the reviewed gate with unresolved dev-only minimatch advisory `GHSA-g3hv-75wg-m249`, copies 9.0.9 and 10.2.6. Exception unchanged, review deadline 2027-01-31. No incompatible overrides or dependency replacements.
* `node scripts/prepare-nsis.mjs`: passed locked template hashes/counts and idempotent Windows branding transforms on Linux. This does not compile an installer.
* `NODE_USE_ENV_PROXY=1 node scripts/prepare-legal.mjs`: passed all five pinned source downloads/size/SHA-256 checks after enabling Node's inherited proxy support (direct Node fetch initially failed). Staged legal verifier passed against those real downloaded archives and local sources/notices. Legal staging remains ignored/uncommitted.
* New tests: synthetic primary/backup/draft/quarantine records round-trip through NativeStorage/restart without changing state bytes; legal verification accepts matching fixture sources and rejects altered archive/template bytes and unexpected DLLs.
* Static review: renderer sandbox/context isolation and disabled Node integration, canonical trusted-frame IPC checks, schema-validated storage/diagnostics, deny-window/navigation/permission policy, enum-only official links, explicit diagnostic authorization and normal-close renderer handshake/native write drain remain intact. No runtime security settings changed. This is source review, not native attack testing.
* Source retains legacy package, appId, GUID, executable/install naming, explicit profile path, single-instance lock, storage/recovery formats and uninstall data retention. Portable shares the same profile intentionally. Discovery remains public metadata only; no executable downloader/installer or publisher trust anchor was added.

## Native gates — all unverified

| Gate | Result |
|---|---|
| Installer / portable EXE built | No / No |
| Native launch / fresh install | No / No |
| Historical upgrade | Blocked: no trustworthy public prior installer |
| Native user-data preservation / uninstall | No / No |
| Portable launch / coexistence / cleanup | No / No / No |
| Each embedded wrapper/plugin/legal inventory | Not inspected |
| Packaged manual/automatic checks / native notifications | Not exercised |
| Authenticated download / update installation | Not implemented; disabled |
| Publisher signing identity | Not established |
| Windows PowerShell harness execution | Not exercised on this Linux host |

The new verifier checks unpacked payloads and wrapper file hashes only. Wrapper extraction/plugin inventory and both embedded legal bundles still require manual evidence. Source archive verification alone does not establish the license provenance of every compiled component. Host compiler/SDK versions also need recording on Windows.

Follow [the Windows procedure](../windows-validation.md) in a disposable standard-user account. Fill native evidence with pass/fail/blocked observations, source/binary hashes and screenshots. Establish publisher signing/authentication, validate a trustworthy prior-to-candidate upgrade, and obtain explicit owner distribution approval before any public binary release. See [update activation gates](../updates.md).
