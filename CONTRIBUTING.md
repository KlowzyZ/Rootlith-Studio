# Contributing

Submit issues and pull requests to https://github.com/KlowzyZ/Rootlith-Studio after launch. Use synthetic or reserved example targets; never post client data, credentials, internal hostnames, recovery bundles or raw evidence.

Discuss major changes first. For a small fix, fork, create a topic branch and describe the problem, resulting behavior and relevant verification. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. Browser simulation does not establish native Windows acceptance. Include your environment and any checks you could not run.

Tests live in tests/*.test.ts. Add meaningful regression coverage for behavior changes. Follow existing TypeScript conventions. Keep changes focused and preserve legacy install identifiers, storage compatibility, exact target authorization and IPC boundaries. New diagnostic capabilities require scope/privacy review. Playbook contributions follow docs/community-playbooks.md.

Contribute only material you have the right to submit under this project's MIT license. Identify third-party material and preserve its notices. There is no CLA; do not submit proprietary code or captured customer data.

Public PR checks have read-only tokens and no release credentials. Maintainers review the complete diff, including lockfiles, lifecycle scripts, workflows and native code. Approved public commits are incorporated through a separate reviewed private release process; a merged PR does not automatically ship a binary. See SECURITY.md for private reports and CODE_OF_CONDUCT.md for conduct.
