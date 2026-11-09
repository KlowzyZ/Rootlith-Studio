import { useMemo, useState } from "react";
import { caseDossier, caseDossierHTML } from "../core/case-export";
import type { InvestigationCase } from "../core/cases";
import type { Store } from "../core/storage";
import type { ExportRequest } from "../core/desktop-client";
import type { ExportOutcome } from "../core/export-document";
import { MAX_RECORD_BYTES } from "../core/native-contract";
import { useDialog } from "./useDialog";
export function CaseDossierDialog({
  value,
  store,
  exportFile,
  close,
  handover = false,
}: {
  handover?: boolean;
  value: InvestigationCase;
  store: Store;
  exportFile: (
    name: string,
    content: string,
    type?: ExportRequest["type"],
  ) => Promise<ExportOutcome>;
  close: () => void;
}) {
  const [reviewed, setReviewed] = useState(false),
    [format, setFormat] = useState("html"),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const dialog = useDialog(close, busy);
  const dossier = useMemo(
    () => caseDossier(value, store, reviewed),
    [value, store, reviewed],
  );
  const payload = useMemo(() => {
    return format === "html"
      ? caseDossierHTML(dossier)
      : JSON.stringify(dossier, null, 2);
  }, [dossier, format]);
  const bytes = useMemo(
    () => new TextEncoder().encode(payload).length,
    [payload],
  );
  const linked = value.runIds.map((id) =>
    store.reports.find((r) => r.id === id),
  );
  return (
    <div className="modal-backdrop">
      <section
        ref={dialog}
        role="dialog"
        data-case-dialog="true"
        aria-modal="true"
        aria-labelledby="dossier-title"
        className="modal dossier-dialog"
      >
        <div className="report-heading">
          <div>
            <small>OFFLINE CASE DOSSIER · SNAPSHOT</small>
            <h2 id="dossier-title">
              {handover ? "Handover Summary" : "Review case export"}
            </h2>
          </div>
          <button
            disabled={busy}
            onClick={close}
            aria-label="Close case export"
          >
            ×
          </button>
        </div>
        {!window.fixflow && (
          <p className="kit-simulation">
            BROWSER SIMULATION · local browser storage and downloads; no native
            diagnostics.
          </p>
        )}
        <p>
          Only saved case data and available linked history from when you opened
          this preview are included. Missing links remain unavailable. Each run
          keeps its native or simulated marker.
        </p>
        <p>
          Unencrypted local export. Authored task descriptions, comments, names,
          identifiers, notes, targets and evidence can be sensitive; review
          before sharing.
        </p>
        {handover && (
          <section className="handover-summary" aria-label="Handover snapshot">
            <h3>
              {dossier.case.name} · {value.archived ? "archived" : "active"}
            </h3>
            <p>
              {(value.actionPlan || []).filter((t) => t.done).length}/
              {value.actionPlan?.length || 0} manually checked.{" "}
              {
                value.runIds.filter(
                  (id) => !store.reports.some((r) => r.id === id),
                ).length
              }{" "}
              missing reports ·{" "}
              {
                value.workflowIds.filter(
                  (id) => !store.workflows.some((w) => w.id === id),
                ).length
              }{" "}
              missing playbooks · Profile: {dossier.profile.availability}.
            </p>
            <p>
              Latest recorded evidence: {dossier.handover.latestEvidence.title}{" "}
              · {dossier.handover.latestEvidence.date} ·{" "}
              {dossier.handover.latestEvidence.mode}
            </p>
            <ul>
              {dossier.actionPlan.map((t) => (
                <li key={t.id}>
                  {t.done ? "Checked" : "Pending"} · {t.title}
                </li>
              ))}
            </ul>
            <p>
              Checklist state is human-authored, not verification of execution.
              Available evidence keeps its recorded native/simulated mode. The
              exact payload below includes all available linked evidence,
              unresolved links, action states and the grounded timeline.
            </p>
          </section>
        )}
        <p className="dossier-modes">
          Linked evidence: {linked.filter((r) => r?.demo).length} simulated ·{" "}
          {linked.filter((r) => r && !r.demo).length} native ·{" "}
          {linked.filter((r) => !r).length} unavailable.
        </p>
        <fieldset disabled={busy}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => {
                setReviewed(e.target.checked);
                setStatus("");
              }}
            />
            Include reviewed identifiers, notes, action descriptions and
            diagnostic evidence
          </label>
          <p className={reviewed ? "target-error" : "muted"}>
            {reviewed
              ? "Identifying case/workflow titles, IDs, dates, notes, task descriptions/comments/authors, labels, targets and evidence are included. Review the entire payload before sharing."
              : "Redacted by default: authored titles, identifiers, dates, notes, task descriptions/comments/authors, targets and diagnostic details are withheld. Counts, statuses and run modes remain."}
          </p>
          <label>
            Export format
            <select
              aria-label="Export format"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
                setStatus("");
              }}
            >
              <option value="html">Offline HTML</option>
              <option value="json">JSON</option>
            </select>
          </label>
        </fieldset>
        <h3>
          Exact {format === "html" ? "HTML source" : "JSON payload"} ·{" "}
          {bytes.toLocaleString()} bytes
        </h3>
        <pre
          className="dossier-payload"
          tabIndex={0}
          aria-label="Exact case export payload"
        >
          {payload}
        </pre>
        {bytes > MAX_RECORD_BYTES && (
          <p role="alert">
            This export exceeds the native 8 MB boundary. Use the redacted
            export or reduce case links before exporting.
          </p>
        )}
        <p role="status">
          {status ||
            (busy
              ? "Waiting for Save dialog and durable file write…"
              : "No file has been exported from this preview.")}
        </p>
        <div className="modal-actions">
          <button disabled={busy} onClick={close}>
            Cancel export
          </button>
          <button
            className="primary"
            disabled={busy || bytes > MAX_RECORD_BYTES}
            onClick={async () => {
              setBusy(true);
              setStatus("");
              try {
                const result = await exportFile(
                  `rootlith-${handover ? "handover" : "case"}.${format}`,
                  payload,
                  format === "html" ? "text/html" : "application/json",
                );
                setStatus(
                  result === "saved"
                    ? `${handover ? "Handover" : "Case dossier"} saved after native acknowledgment.`
                    : result === "cancelled"
                      ? "Save cancelled. No file was exported."
                      : "Download requested. Confirm it in your browser downloads.",
                );
              } catch (e) {
                setStatus(
                  `Export failed: ${(e as Error).message}. Preview retained; no success is confirmed.`,
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Export in progress…"
              : handover
                ? "Save reviewed handover"
                : "Save reviewed dossier"}
          </button>
        </div>
      </section>
    </div>
  );
}
