# Architecture

A single React/Vite renderer is reused by Electron and the browser demo. The root package is the build unit; folders are source modules rather than separately published workspaces. All paths use strict TypeScript.

- `packages/schemas`: strict Zod playbook boundary, limits, graph validation and target descriptions.
- `packages/workflow-engine`: Electron-free sequential DAG interpreter. Fixed typed equality expressions; no evaluation of source strings. Provider and question callbacks are injected.
- `packages/diagnostics`: Node-only adapter, DNS, TCP, and HEAD providers. Bounded and cancellable. DNS currently resolves IPv4 A records; IPv6-only records are not supported.
- `packages/core`: templates, storage, and escaped standalone reports.
- `packages/shared-ui`: graph nodes/canvas and inspector.
- `apps/web-demo`: shell, editor commands, execution and local history.
- `apps/desktop`: isolated main/preload bridge. The narrow bridge exposes diagnostic approval/invocation/cancellation, fixed-record storage initialization/commit, recovery and document exports through native Save dialogs, and close coordination. No arbitrary path or command API is exposed. Sender window, main frame and canonical renderer-file identity are checked. Native modal approval binds exact validated node configurations to a maximum 150-check session. Checks are serial. No Node in renderer.

## Execution semantics

Exactly one Start and at least one End; all nodes reachable; cycles rejected; End has no outgoing edge. Normal nodes have one exit. Yes/No, confirmation and conditions have exactly one `true` and one `false` edge; multiple choice uses exact unique choice strings. Execution follows one path. Providers return `ok`, optional HTTP `status`, and explanatory `detail`. Questions return typed `answer`. Conditions reference an executed node and compare a top-level allowed field with a typed literal. Missing evidence stops inconclusively. A failed diagnostic continues to its configured successor; add a condition when a check should gate another check. Unvisited nodes become skipped; cancellation is recorded separately.

Interfaces return inconclusive status because inventory is evidence, not a claim of internet health. Result and instruction nodes display author guidance verbatim; users must review imported guidance. Automated repairs and arbitrary extensions are out of scope.

## Storage

Alpha.3 desktop uses the main-process backend documented in [native-storage.md](native-storage.md). The following compatible record format remains in use; direct WebStorage access is browser-only. Desktop hydrates a bounded in-memory view and asynchronously commits through revision-checked IPC. Native save and close status wait for acknowledgement.


`fixflow-v1` remains the compatible versioned primary record: up to 100 workflows and 50 reports. Each successful replacement first saves a validated last-good record at `fixflow-v1-backup`. Backup/quota failure aborts the main replacement. Invalid main records are never overwritten automatically: a good backup can open read-only until Settings explicitly restores it, retaining the original under `fixflow-quarantine-v1`.

Canvas edits synchronously stage a bounded schema-validated `fixflow-draft-v1` before the 1.2-second autosave. Draft validation allows incomplete graphs and temporarily empty names/labels, while retaining all configuration and size limits. Reload recovers that draft; successful workflow save clears its matching draft. Quota errors are visible. A recovery export includes primary, backup, draft and quarantined records; treat it as sensitive. Clear run history removes reports from the primary and last-good backup. Quarantined damaged records are preserved until explicit Reset local data; the UI discloses this retention.

A baseline record check rejects stale writes, and cross-window storage events pause autosave. This reduces accidental overwrites but is not an atomic multi-tab lock: use a single editor window. WebStorage is not an fsync guarantee and can be cleared by the browser or OS. Export independent backups. Desktop already uses transactional native disk storage and file-based recovery as described above; those WebStorage limitations apply to browser simulation.

## UI

Graphite #101417 / surface #141b20, mint #5ee3ba, system UI fonts (no remote font requests), 4/8px spacing rhythm, restrained node-category colors. Native labels, focus indicators, modal tab containment, reduced-motion support. Desktop minimum 1000×680; narrower browser screens use a compact sidebar. Mobile editing is not a release target. Undo retains at most 40 graph snapshots, groups a full node drag, and coalesces inspector typing bursts within 800 ms. Ctrl+Z undoes; Ctrl+Shift+Z or Ctrl+Y redoes. Native text-field undo remains available while typing.


## Integrated case workbench and local reuse

`case-command.ts` derives an overview from existing case/action-plan/session records. It does not add a case engine or persist inferred health. Selected case/section is renderer navigation state; after restart the most recently updated active case is selected. `CaseWorkbench` delegates overview, bounded evidence management, forms and lazy-loaded kit/dossier/action dialogs. Existing workspace writer and native ACK/close fences remain the only save path. Manual attachment rechecks case identity/archive state, the exact saved report snapshot and capacity against the latest queued workspace. It changes references only, preserving report origin. Missing/expired references remain visible.

Local kits use the existing strict workflow format and reserved `rootlith:local-kit:v1` tag, up to 20 records inside the existing 100-workflow collection. There are **no new Store fields, storage keys, case/report schemas or backup versions**. Creation strips concrete target fields (including HTTP paths), source author/version/category/tags and source graph identities, generates fresh IDs, and remaps condition sources. Step wording clears by default; optionally copied wording and retained branch choices/condition literals require human review. This is not automatic secret detection. Template descriptions/guidance may still be sensitive and workspace backups are unredacted. Dossier/handover defaults continue withholding identifying/authored data.

Template structural validation temporarily supplies reserved `.invalid` targets only to the existing validator; these placeholders are never stored, resolved or executed. Instantiation checks that targets are absent, clones fresh identities and removes the reserved tag. The existing case+workflow atomic reducer then applies current capacity/collision/profile checks. Concrete targets must be explicitly configured on each instance, followed by unchanged native exact-target authorization. The kit library never executes diagnostics. Deletion requires confirmation and refuses direct case/report-origin references; instantiated copies are independent.

Old versions can parse tagged kit records as ordinary workflows, but cannot enforce the target-free library convention. This app preserves such records on load and refuses reuse if concrete targets were added; make a clean reviewed copy. Do not reset storage to bypass validation. Keep a current offline backup before older-app use. Downgrading profiles with structured action plans remains unsupported as documented for v0.10. Over-capacity portable kit collections/merges reject without replacing originals; local storage load is not tightened to discard old records.

Backup canonicalization now omits object properties whose value is `undefined`, matching JSON serialization. This fixes newly created optional fields (for example absent case profileId) producing a backup that could not verify after export. Serialized JSON cannot contain undefined object values, so existing valid v1 backup SHA-256 checks are unchanged. No hash/damage checks were removed. Native migration/quarantine/journal implementation is unchanged; reviewer-added filesystem coverage verifies alpha2-original survives normal saves/history eviction and failed reset, and is cleaned only after acknowledged explicit reset.

## 0.12 performance and desktop design

The renderer now defers React Flow and its provider/styles until editor entry. Node kind metadata lives in shared-ui/node-library.ts so the inspector and palette do not accidentally import the runtime. The shell retains only a fit callback while the canvas is mounted; cleanup clears it. Settings backup and run comparison are lazy modules with local loading boundaries. No global state library or runtime dependency was added.

Canvas node/step lookup maps remove repeated linear searches. Render data is memoized by its actual inputs, and FlowCard compares node/step identities and selection. Dragging preserves unchanged node objects, updates editor memory during the gesture and stages the full durable draft at gesture completion. Autosave is suspended while a gesture is active; close handling still stages the current dirty canvas and drains the same revision-checked writer. A crash during a live drag can recover the preceding durable position, not an intermediate pointer frame. This is an intentional recovery granularity change, covered by focused UI checks.

Initial parsed workspace state is released after the state owners initialize; immutable export snapshots remain intentional. Report overlays unmount on navigation. Evidence output expansion stores only a boolean and never clones the output; timeline batches bound initial DOM. Large canvases enable React Flow viewport culling above 60 nodes. Recovery, backup SHA-256, identities, schema v1 and exact-scope approvals remain unchanged. The 600 KB primary workspace limit still constrains combined capacity: maximum counts do not imply unlimited evidence payloads.

### Review follow-up: loading and bootstrap ownership

EditorCanvas replaces only the canvas Suspense boundary with local asynchronous component state. The trace demonstrated a long post-download reveal gap with the prior boundary. Promise/module caches are shared by deliberate hover/focus preparation and actual navigation; failures clear the request cache, and unmounted components ignore completion. No startup/idle preload, hidden graph provider or new timer is used. Existing backup/comparison Suspense boundaries remain unchanged.

useWorkspaceState initializes the existing independent React state owners from a seed ref cleared synchronously. It removes the prior mount effect that called releaseInitial(undefined), avoiding an immediate whole-App rerender and keeping bootstrap values outside App's long-lived closure scope. There is no new global store, schema or persistence migration. Report-derived arrays are released outside report pages; deleted node IDs leave the measurement map. Fit/focus actions change only the viewport, never graph schema, targets or execution state.

## 0.13 Settings, updates and identity

SettingsPage is lazy and mounts selected-section controls only. Data operations remain App callbacks using the existing serialized writer; no storage schema or profile change. Notices are escaped local text imported on demand; navigation preference is explicitly session-only.

UpdateService retains bounded official publication metadata and one in-flight request. Public discovery and background scheduling run only in Electron main. The current provider constrains repository names/HTTPS, omits credentials, forbids redirects, and limits requests to 8 seconds / 128 KiB decoded / 20 entries. Actual native installed version uses app.getVersion; local status never networks. Exact trusted-sender checks guard status/check and enum-only official-link IPC. No generic URL, filesystem or process endpoint; no executable download/installation.

Resource transforms are hash/count guarded and precede resource editing/signing, without changing AppInfo filename/install derivation or native single-instance/profile behavior. Public source links use KlowzyZ/Rootlith-Studio. Legacy Windows identities remain unchanged.

UpdateController schedules delayed startup/daily checks, coordinates saved preferences and notifications, and uses a separate fixed update-state file. It cannot write workspace records or execute downloads. See updates.md for channel, cache, rate-limit and publisher-authentication boundaries.
