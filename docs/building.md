# Building

Use Node.js 24 LTS and npm. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. `npm run dev` serves the browser simulation; `npm run desktop` starts Electron where graphical libraries are available. Public CI runs source checks on Linux only, without packaging or artifact uploads.

Windows packaging requires a trustworthy Windows host with the compiler/tooling used by scripts/build-shell-plugin.ps1. `npm run package:win` prepares the original MIT shell helper, verifies pinned NSIS transformations and downloads hash-checked corresponding component sources before packaging. It does not authorize publication. Inspect PACKAGING_NOTICES.md before redistribution. Do not bypass a source hash failure to make packaging succeed.

Legacy package name fixflow-studio, product filename FixFlow Studio, appId org.klowzy.fixflowstudio, installer GUID and %APPDATA%\fixflow-studio are deliberately retained. Changing public repository links must not migrate these identities. `npm run verify:identity` checks source-level invariants; it does not test installed Windows upgrades.

The portable wrapper still stores data in the OS user profile. Uninstall retains user data. Before any binary release, verify standard-user install/uninstall, upgrade/data preservation, shortcuts, native diagnostics, wrapper components and corresponding source on Windows. Record exact source and executable hashes, notices and signing status. Byte-for-byte reproducibility is not claimed.

The development server defaults to loopback (127.0.0.1). Explicit LAN development requires `npm run dev -- --host 0.0.0.0` and an intentional network-access decision. Electron main owns background update discovery; browser development mode does not simulate an installed updater. See [update behavior and future release workflow](updates.md).
