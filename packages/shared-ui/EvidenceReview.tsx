import { useMemo, useRef, useState } from "react";
import { attachCaseEvidence } from "../core/case-command";
import { filterHistory } from "../core/history";
import { localDate, type InvestigationCase } from "../core/cases";
import type { Store } from "../core/storage";
import type { Report } from "../workflow-engine";
import { useDialog } from "./useDialog";
export function EvidenceReview({
  value,
  store,
  save,
  close,
  attached,
}: {
  value: InvestigationCase;
  store: Store;
  save: (reduce: (s: Store) => Store) => Promise<void>;
  close: () => void;
  attached: () => void;
}) {
  const [search, setSearch] = useState(""),
    [mode, setMode] = useState("all"),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<Report>(),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    ref = useDialog(close, busy);
  const reports = useMemo(
    () =>
      filterHistory(store.reports, [], {
        search,
        mode,
        status,
        order: "newest",
        favoritesOnly: false,
      }).filter((r) => !value.runIds.includes(r.id)),
    [store.reports, value.runIds, search, mode, status],
  );
  const origin =
    selected && Object.hasOwn(store.runWorkflows || {}, selected.id)
      ? store.runWorkflows![selected!.id]
      : undefined;
  const originWorkflow = store.workflows.find((w) => w.id === origin);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-review-title"
        data-case-dialog="true"
        data-saving={busy}
        className="modal evidence-review"
      >
        <h2 id="evidence-review-title">Review / Attach evidence</h2>
        <p>
          Choose an existing saved report, inspect its recorded scope, then
          explicitly link it. This does not execute checks, copy evidence,
          change origin or extend the 50-report retention limit. No file
          attachments.
        </p>
        <fieldset disabled={busy}>
          <div className="evidence-filters">
            <label>
              Find saved evidence
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Workflow or recorded step label"
              />
            </label>
            <label>
              Evidence mode
              <select
                aria-label="Evidence mode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="all">All recorded modes</option>
                <option value="simulated">SIMULATED only</option>
                <option value="native">NATIVE only</option>
              </select>
            </label>
            <label>
              Evidence status
              <select
                aria-label="Evidence status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">Any status</option>
                {[
                  "passed",
                  "failed",
                  "inconclusive",
                  "skipped",
                  "cancelled",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="evidence-review-columns">
            <div
              className="evidence-candidates"
              aria-label="Unlinked saved reports"
            >
              {reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={selected?.id === r.id}
                  onClick={() => {
                    setSelected(structuredClone(r));
                    setReviewed(false);
                    setError("");
                  }}
                >
                  <strong>{r.workflow}</strong>
                  <small>
                    {r.demo ? "SIMULATED" : "NATIVE as recorded"} ·{" "}
                    {localDate(r.date)} · {r.steps.length} steps
                  </small>
                </button>
              ))}
              {!reports.length && (
                <p>
                  No unlinked reports match. Run a configured workflow or clear
                  filters; missing references are not recreated.
                </p>
              )}
            </div>
            <section
              aria-label="Selected evidence preview"
              className="saved-evidence-preview"
            >
              {!selected ? (
                <p>
                  Select a report to review its actual details before linking.
                </p>
              ) : (
                <>
                  <h3>{selected.workflow}</h3>
                  <p>
                    <strong>
                      {selected.demo
                        ? "SIMULATED DEMO — no native result"
                        : "NATIVE as recorded"}
                    </strong>{" "}
                    · {localDate(selected.date)}
                  </p>
                  <p>
                    Recorded workflow origin:{" "}
                    {originWorkflow?.name ||
                      (origin
                        ? "Workflow no longer saved"
                        : "Unavailable / older report")}
                    {origin ? ` · ${origin}` : ""}
                  </p>
                  <p className="muted">
                    {origin && value.workflowIds.includes(origin)
                      ? "Origin matches a linked playbook ID. Targets/settings can still differ; review the evidence below."
                      : "Origin is outside this case's playbooks or unverified. Manual attachment is a contextual association, not proof of common targets or workflow identity."}
                  </p>
                  <p>
                    Run ID: {selected.id} · workflow version: {selected.version}
                  </p>
                  {!!selected.limitations?.length && (
                    <ul>
                      {selected.limitations.map((text, i) => (
                        <li key={i}>{text}</li>
                      ))}
                    </ul>
                  )}
                  {selected.steps.map((s, i) => (
                    <details key={`${s.nodeId}:${i}`}>
                      <summary>
                        {s.label} · {s.status}
                      </summary>
                      <p>{s.tested || "Target not recorded"}</p>
                      <pre>
                        {s.output
                          ? JSON.stringify(s.output, null, 2)
                          : "No evidence collected."}
                      </pre>
                      <small>
                        {s.output &&
                        !["pending", "running", "skipped"].includes(s.status) &&
                        Number.isFinite(s.duration) &&
                        s.duration >= 0
                          ? `${s.duration} ms recorded elapsed`
                          : "No measured time available"}
                      </small>
                    </details>
                  ))}
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    I reviewed the report's origin, mode and scope and want to
                    associate it with this case.
                  </label>
                </>
              )}
            </section>
          </div>
        </fieldset>
        {value.runIds.length >= 50 && (
          <p role="alert">
            Case reference cap reached (50, including unavailable history).
            Explicitly unlink a reference before attaching another.
          </p>
        )}
        {value.archived && (
          <p role="alert">
            Archived case: review only. Reopen to attach evidence.
          </p>
        )}
        <p role="status">
          {error ||
            (busy
              ? "Waiting for evidence-link save acknowledgment…"
              : `${reports.length} matching unlinked reports. Preview only; no new evidence created.`)}
        </p>
        <div className="modal-actions">
          <button disabled={busy} onClick={close}>
            Cancel evidence review
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              !reviewed ||
              !selected ||
              value.archived ||
              value.runIds.length >= 50
            }
            onClick={async () => {
              if (lock.current || !selected) return;
              lock.current = true;
              setBusy(true);
              setError("");
              try {
                await save((s) =>
                  attachCaseEvidence(s, value.id, value.created, selected),
                );
                attached();
              } catch (e) {
                setError(`Not attached: ${(e as Error).message}`);
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            Attach reviewed report
          </button>
        </div>
      </section>
    </div>
  );
}
