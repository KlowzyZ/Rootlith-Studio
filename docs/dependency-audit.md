# Dependency advisory review

`npm run audit:deps` compares `npm audit` findings with the reviewed register in `security/dependency-exceptions.json`. It needs registry access, and it exits 0 only when every finding has a current development-only exception. See [building](building.md).

## GHSA-g3hv-75wg-m249 / CVE-2026-118764: minimatch (reviewed 2026-11-09)

**Status:** open, accepted for development tooling only, review by 2027-01-31. This is **not fixed**.

The advisory covers minimatch `>=7.0.0 <11.0.1` (moderate, CWE-405). It allows quadratic-or-worse CPU and memory growth in `firstPhasePreProcess`/`secondPhasePreProcess`. That code is reached only when a caller sets `optimizationLevel >= 2` and an attacker controls the glob **pattern**. Dependabot reported `security_update_not_possible`. npm audit reports 14 entries, all caused by this one advisory, and its suggested fixes are major downgrades (eslint 9, electron-builder 24, typescript-eslint 8.36), which are not acceptable.

| Installed copy | Required by | In range |
| --- | --- | --- |
| `minimatch@10.2.6` (hoisted, dev) | eslint 10.14.0 `^10.2.6`, @eslint/config-array 0.23.5 `^10.2.4`, @typescript-eslint/typescript-estree 8.72.1 `^10.2.2`, app-builder-lib 26.18.0 `^10.2.5` | yes |
| `minimatch@9.0.9` (dev) | @electron/universal 2.0.3 `^9.0.3`, pinned exactly by app-builder-lib | yes |
| `minimatch@5.1.9`, `3.1.5` (dev) | filelist, @electron/asar, dir-compare, glob 7 | no |

Why the risk is accepted for now:

- Every affected copy is a devDependency. The Vite and esbuild outputs (`dist/`, `dist-electron/`) contain no minimatch code, and electron-builder ships only those directories.
- Every call site (ESLint file and ignore matching, typescript-estree `allowDefaultProject`, app-builder-lib `fileMatcher`, @electron/universal allow-lists) uses the default `optimizationLevel` of 1. Patterns come from repository-owned configuration, not from untrusted input.

Why it is not fixed:

- The fix exists only in minimatch 11.x. 9.x and 10.x have no backport.
- minimatch 11.0 removes `makeRe()`, `Minimatch#regexp`, `matchOne()` and the `AST` class. It also changes trailing-empty-portion and Windows `..` matching.
- The latest releases of every parent still declare `^9` or `^10`, including app-builder-lib 27.0.0-alpha.14 and typescript-estree canary. Forcing `overrides` across that major would change how Windows asar contents are selected without native packaging verification.
- @electron/universal 3.0.4+ dropped minimatch, but app-builder-lib pins 2.0.3. Overriding only that pin would still leave the 10.2.6 copy vulnerable.

**Follow-up for maintainers:** when ESLint, typescript-eslint and electron-builder release versions that accept minimatch `>=11.0.1` (and app-builder-lib accepts @electron/universal `>=3.0.4`), update them normally. Run the full source checks and `npm run package:win` on Windows, then remove the exception. Re-review sooner if a vulnerable copy becomes a production dependency or any caller passes `optimizationLevel >= 2`.
