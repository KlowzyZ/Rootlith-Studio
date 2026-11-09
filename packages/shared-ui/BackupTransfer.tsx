import { localKits } from "../core/local-kits";
import { useEffect, useRef, useState } from "react";
import { load, type Store } from "../core/storage";
import {
  applyImport,
  backupWarning,
  bytes,
  createBackup,
  MAX_BACKUP_BYTES,
  planImport,
  readBackup,
} from "../core/workspace-backup";
import { exportDocument } from "../core/export-document";
import { useDialog } from "./useDialog";

type Preview =
  | { kind: "export"; text: string; store: Store }
  | {
      kind: "import";
      source: Store;
      date: string;
      plan: ReturnType<typeof planImport>;
    };
export function BackupTransfer({
  store,
  blocked,
  idle,
  write,
}: {
  store: Store;
  blocked: boolean;
  idle: () => Promise<void>;
  write: (reduce: (s: Store) => Store) => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = file.current;
    const cancel = () =>
      setNotice("File selection cancelled. Workspace unchanged.");
    input?.addEventListener("cancel", cancel);
    return () => input?.removeEventListener("cancel", cancel);
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Backup operation failed; no success acknowledged.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section backup-transfer">
      <div className="backup-heading">
        <div>
          <h3>Backup &amp; Transfer</h3>
          <p>
            Take investigations between computers. Offline, under your control.
          </p>
        </div>
        <span className="backup-badge">Workspace Backup · v1</span>
      </div>
      <Summary store={store} />
      <p>{backupWarning}</p>
      <p className="muted">
        Saved records only; unsaved canvas drafts and recovery journals stay on
        this computer. Import never runs diagnostics or applies targets.
      </p>
      <div className="backup-actions">
        <button
          disabled={busy || blocked}
          onClick={() =>
            perform(async () => {
              await idle();
              const snapshot = load();
              setPreview({
                kind: "export",
                text: await createBackup(snapshot),
                store: snapshot,
              });
            })
          }
        >
          Workspace Backup
        </button>
        <button
          disabled={busy || blocked}
          onClick={() => {
            setNotice("");
            file.current?.click();
          }}
        >
          Preview Import
        </button>
      </div>
      <label className="backup-file">
        Local backup file (JSON, maximum 2 MiB)
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          disabled={busy || blocked}
          onChange={(e) => {
            const selected = e.target.files?.[0];
            e.target.value = "";
            if (!selected) return;
            void perform(async () => {
              if (selected.size > MAX_BACKUP_BYTES)
                throw Error("File exceeds 2 MiB. Nothing imported.");
              const parsed = await readBackup(await selected.text());
              await idle();
              setPreview({
                kind: "import",
                source: parsed.store,
                date: parsed.savedAt,
                plan: planImport(load(), parsed.store),
              });
            });
          }}
        />
      </label>
      {!window.fixflow && (
        <p className="backup-simulation">
          BROWSER SIMULATION — browser storage and downloads only. No real
          diagnostics performed; native durable storage is not exercised here.
        </p>
      )}
      {blocked && (
        <p role="alert">
          Workspace is read-only. Use Storage &amp; recovery before transferring
          data.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {preview && (
        <BackupDialog
          notice={notice}
          preview={preview}
          busy={busy}
          close={() => {
            setPreview(undefined);
            setNotice("Cancelled. Workspace unchanged.");
          }}
          confirm={() =>
            perform(async () => {
              if (preview.kind === "export") {
                const result = await exportDocument(
                  "Rootlith-workspace.rootlith-backup.json",
                  preview.text,
                );
                setNotice(
                  result === "saved"
                    ? "Backup saved — native Save acknowledged."
                    : result === "cancelled"
                      ? "Save cancelled. Workspace unchanged."
                      : "Browser simulation: download requested; verify the file in your downloads.",
                );
              } else {
                await write((current) =>
                  applyImport(current, preview.source, preview.plan.baseline),
                );
                setNotice(
                  window.fixflow
                    ? "Import saved — native durable storage acknowledged."
                    : "Browser simulation: import saved to this browser workspace.",
                );
              }
              setPreview(undefined);
            })
          }
        />
      )}
    </section>
  );
}
function Summary({ store }: { store: Store }) {
  return (
    <div className="backup-summary">
      {[
        ["Workflows", store.workflows.length],
        ["Local kits (within workflows)", localKits(store).length],
        ["Reports / history", store.reports.length],
        ["Target profiles", store.targetProfiles?.length || 0],
        ["Cases", store.cases?.length || 0],
        ["Favorites", store.favoriteRuns?.length || 0],
        ["Run links", Object.keys(store.runWorkflows || {}).length],
      ].map(([label, count]) => (
        <div key={label}>
          <strong>{count}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
function BackupDialog({
  notice,
  preview,
  busy,
  close,
  confirm,
}: {
  notice: string;
  preview: Preview;
  busy: boolean;
  close: () => void;
  confirm: () => void;
}) {
  const ref = useDialog(close, busy);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        className="modal backup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-title"
        aria-busy={busy}
      >
        {notice && <p role="alert">{notice}</p>}
        <h2 id="backup-title">
          {preview.kind === "export"
            ? "Confirm workspace backup"
            : "Import Preview"}
        </h2>
        <p>{backupWarning}</p>
        {!window.fixflow && (
          <p className="backup-simulation">
            BROWSER SIMULATION · No real diagnostics performed. Native durable
            storage is not exercised.
          </p>
        )}
        {preview.kind === "export" ? (
          <>
            <Summary store={preview.store} />
            <p>
              Copy size: {bytes(preview.text).toLocaleString()} bytes · SHA-256
              integrity included
            </p>
            <p>
              Destination:{" "}
              {window.fixflow
                ? "Choose a local destination in the native Save dialog after confirming."
                : "Browser downloads (simulation); your browser controls the destination."}
            </p>
            <p>Suggested filename: Rootlith-workspace.rootlith-backup.json</p>
          </>
        ) : (
          <>
            <p>SHA-256 verified · Saved UTC: {preview.date}</p>
            <p>
              Existing local records and IDs stay unchanged. Conflicts are
              skipped. Missing references remain missing; ambiguous cases are
              skipped.
            </p>
            <table>
              <caption>Import consequences by record type</caption>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Add</th>
                  <th>Skip</th>
                  <th>Conflict</th>
                </tr>
              </thead>
              <tbody>
                {[
                  "workflows",
                  "reports",
                  "targetProfiles",
                  "cases",
                  "favoriteRuns",
                  "runWorkflows",
                ].map((type) => (
                  <tr key={type}>
                    <th>
                      {
                        {
                          workflows: "Workflows",
                          reports: "Reports / history",
                          targetProfiles: "Target profiles",
                          cases: "Cases",
                          favoriteRuns: "Favorites",
                          runWorkflows: "Run origins",
                        }[type]
                      }
                    </th>
                    {["add", "skip", "conflict"].map((action) => (
                      <td key={action}>
                        {
                          preview.plan.rows.filter(
                            (r) => r.type === type && r.action === action,
                          ).length
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <details>
              <summary>
                Record IDs and decisions ({preview.plan.rows.length})
              </summary>
              <ul>
                {preview.plan.rows.map((r, i) => (
                  <li key={i}>
                    <code>
                      {r.type} / {r.id}
                    </code>
                    : {r.action} — {r.reason}
                  </li>
                ))}
              </ul>
            </details>
            {!!preview.plan.missing.length && (
              <details open>
                <summary>
                  Missing references ({preview.plan.missing.length})
                </summary>
                <ul>
                  {preview.plan.missing.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </details>
            )}
            {preview.plan.error && <p role="alert">{preview.plan.error}</p>}
            <p>
              Favorites and run origins are added only for new runs. Existing
              run metadata is retained. No checks will execute.
            </p>
          </>
        )}
        <div className="backup-actions">
          <button disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            disabled={
              busy ||
              (preview.kind === "import" &&
                (!!preview.plan.error ||
                  !preview.plan.rows.some((r) => r.action === "add")))
            }
            onClick={confirm}
          >
            {busy
              ? "Awaiting save acknowledgment…"
              : preview.kind === "export"
                ? "Confirm export"
                : "Merge into workspace"}
          </button>
        </div>
      </section>
    </div>
  );
}
