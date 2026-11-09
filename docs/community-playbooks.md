# Contribute a troubleshooting playbook

No account system or marketplace is needed. Community workflows are reviewable JSON submitted through GitHub pull requests after publication. During private preparation, use the same process with repository access.

1. Start with a shipped template, or create a small, connected workflow in the editor. Prefer one investigation with an understandable outcome.
2. Use a unique workflow ID; preserve that ID when improving the same playbook. Export `.fixflow.json`. Follow the [v1 format](playbook-format.md), supported node schemas and graph limits.
3. Use loopback or reserved documentation endpoints in examples. Clearly explain which diagnostic targets users must edit before running. Do not embed internal domains, credentials, query tokens, usernames, customer evidence or copied proprietary guidance.
4. Submit the JSON under `examples/` with a short description: intended audience, prerequisites, exact checks and targets, each branch's meaning, expected failures, limitations and suggested next steps. Identify original or properly licensed source material.
5. Test both useful and unavailable evidence. Browser simulation proves the guided path only; label it as simulation. Claim native checks only when actually exercised against authorized targets. Include version and environment, with sensitive details removed.
6. Reviewers check strict import validation, reachability, no cycles, typed conditions, all branch outcomes, target authorization, cancellation/timeout settings and conservative language. Never infer a definitive root cause from a reachability failure alone.

Imported JSON cannot introduce scripts, commands or new native capabilities. Adding a diagnostic provider requires a separate engineering discussion and security review. Do not request unsafe targets or weaken native approval to make a playbook convenient.

Maintainer review is required before merging examples. Review the diff rather than trusting a familiar author; re-import the submitted file, inspect the scope and verify the changed branches. The repository's MIT contribution terms apply to original submitted playbooks; include any required third-party attribution. Never attach raw recovery bundles to an issue.
