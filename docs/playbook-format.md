# FixFlow playbook format v1

Files use `.fixflow.json` and UTF-8 JSON. The executable specification is `packages/schemas/index.ts`; checked-in examples are in `examples/`. Required fields: schemaVersion (1), id, name, version, description, author, category, tags, requiredCapabilities, nodes, edges. The informational requiredCapabilities array is normalized on import/edit. Required capabilities are derived from node kinds rather than trusting a declared permission list. Network targets are derived from validated config and shown for approval. Documentation is supplied in workflow and node descriptions.

Nodes have id, kind, label, description, position {x,y}, config. Config supports timeout (100–10000 ms), host, port (1–65535), url, choices, source, field, operator, value. Kind names: start, end, instruction, question, condition, result, interfaces, dns, tcp, http, choice, confirmation. Unknown fields and unknown kinds are rejected. Defaults apply only to description and timeout. Imported files are limited to 500 KiB, 150 nodes and 300 edges; strings and coordinates are bounded. Save-time validation checks schema; execution additionally requires a complete valid graph.

Edges have id, source, target and optional branch. Branch is `true`/`false` for boolean decisions or an exact choice string. Graph execution does not run every connected branch. No variables, scripts, HTML, shell commands or general expression language are supported. Guidance is plain text. Conditions use fields `ok`, `status`, `answer` and operators `equals`, `notEquals`. Strict type comparison means boolean true differs from string "true".

DNS performs IPv4 record resolution. HTTP accepts HTTP(S) URLs without credentials, query or fragment. HEAD requests do not follow redirects. TCP opens a single host/port connection; it does not probe ranges. Network scope is approved in native UI in desktop. Browser evidence is always simulated.

## Compatibility and migration

Unsupported schema versions are rejected without mutating stored data. The first migration is the identity transform for v1. A future v2 must add an explicit pure migration, retain a backup/export path, validate migrated data and add fixtures for both versions. Never silently reinterpret unknown capabilities. Document every format change with the schema version and changelog.

## Contributing playbooks

Fork the repository after publication, export a playbook, remove private targets, and submit it under examples via pull request. Reviewers must inspect every target and guidance string, validate both branches, run without privileged permissions, and ensure conclusions match the available evidence. Do not contribute secrets, internal IPs or misleading guaranteed fixes. See CONTRIBUTING.md.

## Standalone guided HTML

Offline diagnostic report HTML is implemented and contains no scripts or external dependencies. Interactive standalone workflow HTML is deferred: the graph UI and safe native bridge are not embedded in reports. A future export could support pure question/instruction paths; any native diagnostic node must require FixFlow Desktop rather than inventing results.
