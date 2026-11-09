# Security policy

Only the latest alpha source is maintained. No stable or unattended-use guarantee is made.

Report vulnerabilities privately at https://github.com/KlowzyZ/Rootlith-Studio/security/advisories/new. Private vulnerability reporting is enabled; the maintainer should monitor it. If that interface is unavailable, do not open a public issue containing exploit details; wait for a verified private reporting route. No response-time guarantee is advertised.

Include affected commit/version, impact, minimal synthetic reproduction and proposed mitigation. Never send customer evidence, credentials or unauthorized target data.

Playbooks are untrusted data: no imported scripts, shell commands, repairs or elevation. Desktop diagnostics require exact-scope approval and bounded requests. Renderer Node integration is disabled; IPC is narrow and validated. Local state and recovery exports are not encrypted. Export redaction is a default, not proof that a document is safe to share.

Source checks and dependency audits have limits. Windows packaging, signing and redistribution require independent review before binary delivery. No official executable release accompanies this source snapshot.

Update discovery runs in Electron main, defaults to enabled, and can be disabled in Settings. It contacts only the official public GitHub repository without credentials; no investigation data is sent. Downloads/installation remain blocked until publisher authentication and native Windows upgrade validation exist. See [update security and publication gates](docs/updates.md). A release hash from the same server as its EXE is not publisher authentication.
