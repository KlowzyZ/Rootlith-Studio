# Windows candidate validation (no distribution approval)

Use a **disposable Windows x64 VM**, a new local standard-user account, and a clean committed checkout of this PR. Never use the owner's Windows account/workspace. Do not delete an existing profile to make a test proceed. Take a VM checkpoint before each scenario. This procedure does not publish or upload binaries. Keep evidence outside the repository. A successful build is not native acceptance.

## Build once

Install Node.js 24 LTS, Git, and Visual Studio 2022 Build Tools with Desktop development with C++ (MSVC x86/x64 tools and Windows SDK). The original shell helper requires `vswhere`, `VsDevCmd.bat`, `cl` and `dumpbin`; no MinGW substitution is reviewed. Use normal Windows PowerShell 5.1 or later, **without elevation**. Provisioning build tools can require a separate administrator; application installation must not.

From the repository root:

```powershell
powershell -NoProfile -File scripts/windows/build-candidate.ps1 -EvidenceDirectory C:\RootlithEvidence\build-1
```

The script refuses a dirty checkout, existing `release/`, non-Windows host, wrong Node major, or elevated account. It runs `npm ci`, lint, typecheck, tests, build, identity, audit and `package:win`. Packaging runs the existing shell-helper compile/import check, hash-guarded NSIS/branding transformations, legal-source verification, electron-builder with `--publish never`, and the new package-content verification. Downloads require normal HTTPS connectivity. On a configured proxy Node 24 can use `NODE_USE_ENV_PROXY=1`; do not disable certificate verification. Stop on hash, compiler, license or verification errors.

Expected outputs (version is read from package.json):

* `release/Rootlith-Studio-0.13.0-alpha.1-x64-setup.exe`
* `release/Rootlith-Studio-0.13.0-alpha.1-x64-portable.exe`
* `release/PACKAGE_CONTENTS.json`, copied into evidence alongside `BUILD_INFO.json`, `SIGNATURES.json` and build transcript.

Record Visual Studio/MSVC/SDK versions from compiler output and installed components. Lockfile pins Electron 45.2.1, electron-builder/app-builder-lib 26.18.0; NSIS toolset 1.2.1 is explicitly configured. The host compiler/SDK are **not** currently pinned reproducibly. A non-Valid Authenticode result is a signing blocker, not a reason to disable verification. Unsigned private validation is not public-release approval.

`PACKAGE_CONTENTS.json` validates the **unpacked** payload and hashes the two PE files. It does not prove what each wrapper extracts. On the VM, inspect/extract each setup, portable and generated uninstaller with a trusted locally installed archive inspection tool (e.g. 7-Zip); retain file listings, hashes and extraction logs in `WRAPPER_COMPONENTS.json`. Extract nested application archives too. Compare app.asar and legal directory with `win-unpacked`; enumerate wrapper plugins and match hashes to the reviewed toolset and locally built FixFlowShell. Reject WinShell and unknown components. Retain the actual NSIS toolset archive and verify SHA-256 `56997fdefe25e7928a1a68b4583d08b240b66cf660234053b20131a74cc082f4`. Verify Electron/Chromium notices beside the extracted executable, all corresponding-source archives and notices in **both** payloads. Do not infer these results from the unpacked verifier. Use `DISTRIBUTION_ACCEPTANCE.json` to record each observation, evidence path, and pass/fail/blocked status.

## Fresh install and synthetic profile

1. Confirm `%APPDATA%\fixflow-studio` does not exist and no FixFlow Studio process runs. Record Windows build, account type and VM checkpoint.
2. Run setup interactively. Verify Rootlith wizard/icon/version, per-user default directory, no UAC request, optional directory selection and shortcuts. Record actual install path rather than assuming it. Preserve executable filename `FixFlow Studio.exe`, appId `org.klowzy.fixflowstudio`, GUID `c41b684f-fd57-5c09-b4a7-68101139f192`. Uncheck launch at completion for fixture preparation.
3. Run `node scripts/windows/seed-profile.mjs`. It refuses any existing profile and creates only schema-validated synthetic cases, playbooks, evidence, notes, backup/draft and raw recovery records through NativeStorage. If setup already launched, use another clean checkpoint/account; never reset that profile with this script. No diagnostics run during seeding.
4. Launch using the Start Menu shortcut. Confirm a genuine Electron window and Settings runtime reports packaged Windows x64/Electron, installed version and correct distribution mode. Verify icon/title, desktop shortcut, HKCU uninstall entry (no machine-wide entry), workspace case/note/evidence and recoverable draft. Export recovery and a case dossier to an external evidence directory. Confirm exact native profile path. Record screenshots and results in `STANDARD_USER_ACCEPTANCE.json`.
5. Edit a case note and playbook, save, close normally and restart. Confirm edits persist. Approve only local interface/loopback diagnostics against a controlled local test service; verify approval/cancellation, native results and file export. Cancel authorization and verify unauthorized checks cannot execute. Test closing with pending edits and active diagnostics: stay-open choice, successful save/drain and clean exit. Never use force-kill as proof of graceful shutdown.
6. In Settings save update preferences (including previews), close/restart and verify persistence. Use the snapshot tool after all instances exit:

```powershell
powershell -NoProfile -File scripts/windows/snapshot-profile.ps1 -EvidenceFile C:\RootlithEvidence\before-upgrade.json
```

Snapshots include durable storage/recovery files and update preferences, excluding volatile Chromium caches. The marker is a guard against selecting the real workspace, not a security boundary. Use only the disposable account. Keep full VM checkpoints as well; snapshots are not backups.

## Upgrade, restart and uninstall

A historical upgrade requires a trustworthy prior installer with provenance, source commit and checksum. The first public unsigned **v0.13.0-alpha.1** pre-release now exists, but its native install/upgrade behavior is unverified. It may be evaluated as a prior build for a future version **only after independent verification in an isolated Windows test environment**; it cannot prove an upgrade to itself. Do not use old private Draft binaries. Reinstalling the same candidate tests same-version behavior only.

With the app closed, run the candidate setup over the trustworthy prior install (or same candidate in a separate labelled test). Before launching, capture:

```powershell
powershell -NoProfile -File scripts/windows/snapshot-profile.ps1 -EvidenceFile C:\RootlithEvidence\after-install.json -CompareWith C:\RootlithEvidence\before-upgrade.json
```

Require identical durable bytes before first launch. Launch, confirm the old case, playbook, evidence, notes, settings and recovery data, edit/save again and restart. Snapshot again; inspect expected edits and preference timestamps rather than blindly approving all differences. Record prior/new binary hashes and actual install directory, GUID, shortcut targets and uninstall entry. Check for duplicate identities and missing DLL errors.

Close all instances, snapshot, uninstall through Windows Settings and snapshot again using `-CompareWith`. Require identical retained durable bytes. Check shortcuts, install files and uninstall entry are removed, with `%APPDATA%\fixflow-studio` retained. Reinstall and confirm the same workspace loads. Do not approve an uninstall that deletes user data.

## Portable and installed coexistence

Use a fresh VM account/checkpoint with no installation first. Place portable EXE in a normal user-writable directory, record its SHA-256, launch without elevation, and verify branding, packaged/portable runtime, native storage, approved local diagnostics, exports, close and restart. Portable uses `%APPDATA%\fixflow-studio`, **not** a profile beside the EXE. It intentionally shares the legacy profile and single-instance lock with the installed build; it is not an isolated workspace.

Launch twice: require one active application/profile writer, existing window focused and clean wrapper exits. In another checkpoint, install the candidate then test portable while installed is running and vice versa. Record process paths and actual behavior; snapshot installed files before/after, require no portable modification of installation/registration/shortcuts. Profile changes from deliberate edits are expected, executable changes are not. Verify launcher SHA-256 unchanged after every run and clean temporary extraction cleanup. Replacement stays manual: close **all** instances, replace the launcher yourself only with an independently authenticated build. No running-EXE overwrite or automatic installer exists.

## Update discovery and final acceptance

In the actual packaged builds, verify startup check after about 20 seconds; daily scheduling (controller fixture tests cover timing, but record any native observation separately); manual Check for Updates; correct version and preview preference; release notes; offline errors; cooldown; saved preferences and notification deduplication after restart. An empty public release feed must show unavailable, never up-to-date. Never create a public test Release for this procedure. With no suitable published newer release, live available-update/OS-notification/channel tests are **blocked**, though controlled source fixtures pass. Do not repeatedly hammer the public API to induce rate limits. Record fixture evidence separately from live native observations.

No binary download, verification or installation capability is implemented. The planned maintained NSIS path is electron-updater with independently verified publisher identity and signature verification left enabled; re-review the current version before adoption. A SHA-256 beside an EXE on GitHub is integrity evidence, not publisher authentication. Signing identity/key, authenticated metadata and native safe-time restart/upgrade evidence are required before enabling delivery. See [updates.md](updates.md).

Before a future stable release or authenticated executable delivery, review every gate as pass/fail/blocked; pin the exact source commit and executable SHA-256 values. Resolve signing, historical upgrade and native acceptance gaps and obtain explicit owner approval. The experimental, unsigned v0.13.0-alpha.1 public pre-release was published with these limits disclosed; it does not retroactively satisfy those gates. This document itself does not authorize further publication.
