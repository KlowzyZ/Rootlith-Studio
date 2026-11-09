# Repository administration follow-up

Inspected 2026-11-09. Public repository ID: 1451178265. The existing Main-Protection ruleset (26845213) is active on the default main branch, requires PRs, requires zero external approvals, prohibits deletion and force pushes, and has no bypass actors. It was not replaced or weakened. Private vulnerability reporting is enabled, matching SECURITY.md.

The current GitHub integration returns HTTP 403 “Resource not accessible by integration” for repository metadata/topics writes, administration-only dependency-alert reads and repository security feature details. No alternative credential or protection bypass was attempted. The following exact owner actions remain:

1. About → Edit: description `Rootlith Studio — Open-source, local-first visual troubleshooting workbench.`; website `https://klowzy.com`; topics `electron`, `typescript`, `troubleshooting`, `desktop-app`, `open-source`, `windows`.
2. Settings → Rules → Rulesets → Main-Protection → Edit: retain active/default-main scope, PR requirement, zero required approvals, deletion/non-fast-forward restrictions and empty bypass list. Add **Require status checks to pass**, selecting the existing GitHub Actions job named `checks` from the `Source checks` workflow after a successful run. Do not replace the ruleset or add bypass actors.
3. Settings → Advanced Security (or Code security): verify free Dependabot/dependency alerts, secret scanning and push protection availability for this public repository. Enable free features where available; do not purchase or enable paid products. Keep private vulnerability reporting enabled and monitor incoming reports. Alerts/secret-scanning state could not be verified with this integration and must not be reported as enabled.

No repository visibility, private repository, website, release asset or history changes are part of this work.
