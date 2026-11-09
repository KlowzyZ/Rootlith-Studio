# Desktop persistence and Alpha.2 migration

Alpha.3 keeps the existing playbook identities and schemas. The renderer uses the same small storage interface; desktop supplies an in-memory view hydrated from the Electron main process. Browser demo storage remains WebStorage. A desktop save is displayed as complete only after native acknowledgement. Draft writes are coalesced while a write is in flight; closing the window requests the latest draft and waits for pending writes. A failed write requires recovery or an explicit close-without-saving decision.

## Location and permissions

Files live in `app.getPath('userData')/fixflow-data` (explicitly `%APPDATA%\fixflow-studio` on Windows; the Rootlith preview retains the measured Alpha.2/Alpha.3 path). Electron enforces one app instance for a profile. Test processes select isolated temporary profiles using a command-line user-data directory, never a renderer-provided path. The renderer receives data and monotonically increasing revisions, not filesystem paths. There is no generic read/write-file or shell IPC capability.

## Write and recovery protocol

The bounded snapshot envelope contains format version 1, a revision, the compatible record bag, and a SHA-256 integrity digest. Maximum record bag size is 8 MiB. Main-process writes are serialized and compare the submitted revision with the current revision. Stale requests fail rather than replacing newer data.

Each generation is written to an exclusive temporary file, flushed with `FileHandle.sync`, closed, and renamed to `pending.json`. The same generation is atomically installed in `state.json` and `last-good.json`, then the pending record is removed before acknowledgement. Directory metadata is flushed where supported; Windows directory flushing is not universally supported. There is no claim that consumer hardware or Windows write caches make arbitrary power loss impossible.

Startup removes up to 64 interrupted temporary files matching the app’s exact generated naming pattern; unrelated files are untouched. Only these three fixed candidate filenames are considered, each with a bounded size. Schemas and digests are checked; the highest valid revision wins. Corrupt candidates are retained under fixed `damaged-*` names before repair. If a different damaged original already occupies that name, startup stops before replacing candidates; preserve/export both originals for manual recovery. Identical preserved bytes can be reused. When every candidate is invalid, initialization stops and offers a native recovery export rather than silently creating an empty workspace. A failed replacement can leave a valid pending generation which is recovered even when the renderer never received acknowledgement. An uncertain save therefore requires reopening/reconciliation, not blind retry.

Disk recovery generations converge to the newly committed snapshot. Removed workflow/report identities are pruned from compatible backup records as well. Normal deletions and automatic history retention preserve quarantine, damaged raw originals, and the Alpha.2 migration original; these may still contain removed private evidence and are not restored automatically. Only explicit reset clears these raw recovery originals, and raw-file cleanup follows durable replacement of the active records. A reset failure before replacement leaves recovery originals intact. User-requested recovery exports remain independent files and cannot be revoked by the app.

## Migration

On first desktop initialization, the renderer supplies the four Alpha.2 WebStorage records. Main preserves the complete original record bag in `alpha2-original.json` before validating or transforming anything. Valid primary/backup/draft data is migrated; a damaged primary can use a valid backup, with notice. No valid primary or backup means migration is blocked, with the untouched original retained. An interrupted migration retries from that untouched file.

Only after the native migration commit succeeds does the client clear the old WebStorage keys. The original native migration file remains across ordinary saves for recovery. Only explicit reset clears it after durable replacement; it can retain deleted historical private evidence until then. Workflow identifiers and schema version are unchanged. No imported code, scripts or new diagnostic privileges are introduced.

## Limits

This is a bounded snapshot/journal store, not a database or multi-process filesystem synchronization service. Electron's profile lock and revision-checked IPC protect normal app access. External tools editing files while the app runs are unsupported. Native recovery exports preserve raw file bytes as base64, including invalid UTF-8. Recovery exports can contain sensitive evidence and damaged raw data; review them before sharing. Atomic rename and fsync tests cover interrupted operations, not every possible hardware/power-failure scenario.
