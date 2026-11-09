import { comparisonExport, comparisonHTML } from "../core/comparison-export";
import type { ExportRequest } from "../core/desktop-client";
import { useState } from "react";
import type { Report, Step } from "../workflow-engine";
import {
  comparisonScope,
  compareSteps,
  type RunWorkflows,
} from "../core/comparison";
function Evidence({ step }: { step?: Step }) {
  if (!step)
    return (
      <p className="muted">
        Node absent from this report. No result or target can be inferred.
      </p>
    );
  const measured =
    !!step.output &&
    !["pending", "running", "skipped"].includes(step.status) &&
    Number.isFinite(step.duration) &&
    step.duration >= 0;
  return (
    <>
      <span className={`status ${step.status}`}>{step.status}</span>
      <p className="tested">
        {step.tested ||
          "Target not recorded · older, guided or unexecuted step"}
      </p>
      <pre>{step.output?.detail || "No evidence collected."}</pre>
      {step.output?.status !== undefined && (
        <small>HTTP {step.output.status} · </small>
      )}
      <small>
        {measured
          ? `${step.duration} ms elapsed`
          : "No measured execution time"}
      </small>
    </>
  );
}
export function RunComparison({
  baseline,
  followup,
  origins,
  close,
  swap,
  exportFile,
}: {
  baseline: Report;
  followup: Report;
  origins: RunWorkflows;
  close: () => void;
  swap: () => void;
  exportFile: (
    name: string,
    content: string,
    type?: ExportRequest["type"],
  ) => Promise<void>;
}) {
  const [exporting, setExporting] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [legacyConfirmed, setLegacyConfirmed] = useState(false);
  const [changesOnly, setChangesOnly] = useState(false);
  const scope = comparisonScope(baseline, followup, origins);
  const permitted =
    scope === "verified" || (scope === "legacy" && legacyConfirmed);
  let rows: ReturnType<typeof compareSteps> = [],
    error = "";
  try {
    if (permitted) rows = compareSteps(baseline, followup);
  } catch (e) {
    error = (e as Error).message;
  }
  const counts = (classification: string) =>
    rows.filter((row) => row.classification === classification).length;
  return (
    <div className="modal-backdrop">
      <section
        className="modal comparison-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="comparison-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <div className="report-heading">
          <div>
            <small>
              INVESTIGATION COMPARISON ·{" "}
              {baseline.demo ? "SIMULATED DEMO" : "NATIVE RUNS"}
            </small>
            <h2 id="comparison-title">What changed between runs?</h2>
          </div>
          <button onClick={close} aria-label="Close comparison">
            ×
          </button>
        </div>
        <div className="comparison-pair">
          {[
            ["Baseline", baseline],
            ["Follow-up", followup],
          ].map(([title, value]) => {
            const report = value as Report;
            return (
              <div key={title as string}>
                <small>{title as string}</small>
                <strong>{report.workflow}</strong>
                <p>
                  {new Date(report.date).toLocaleString()} · workflow v
                  {report.version}
                </p>
              </div>
            );
          })}
        </div>
        <div className="comparison-tools">
          <button onClick={swap}>Swap baseline and follow-up</button>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={changesOnly}
              onChange={(e) => setChangesOnly(e.target.checked)}
            />
            Show changed evidence only
          </label>
        </div>
        {scope === "legacy" ? (
          <div className="explanation">
            <strong>Older run identity is unverified</strong>
            <p>
              These reports share a workflow name, but at least one has no
              recorded workflow ID. Renamed or duplicated workflows cannot be
              distinguished. Matching node IDs alone does not prove common
              origin.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={legacyConfirmed}
                onChange={(e) => setLegacyConfirmed(e.target.checked)}
              />
              I recognize these as runs of the same workflow; compare with this
              limitation.
            </label>
          </div>
        ) : scope !== "verified" ? (
          <p role="alert">{scope}</p>
        ) : (
          <p className="muted">
            Same workflow identity · matched by stable node IDs, including
            renamed steps.
          </p>
        )}
        <p className="muted">
          Only failed ↔ passed at the same recorded target is labeled
          improvement or regression. Target changes and missing targets remain
          explicit. Other settings may differ. Elapsed times include step
          overhead and user-answer waits; faster does not imply healthier. This
          comparison does not establish a root cause.
        </p>
        {error && <p role="alert">{error}</p>}
        {permitted && !error && (
          <>
            <button
              onClick={() => {
                setSensitive(false);
                setExporting(true);
              }}
            >
              Preview comparison export
            </button>
            {exporting &&
              (() => {
                const value = comparisonExport(
                  baseline,
                  followup,
                  origins,
                  sensitive,
                  legacyConfirmed,
                );
                return (
                  <div className="export-preview">
                    <h3>Comparison export preview</h3>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={sensitive}
                        onChange={(e) => setSensitive(e.target.checked)}
                      />
                      Include identifying details after review
                    </label>
                    <p>
                      Review this exact payload before saving. Labels, targets
                      and evidence may identify private devices.
                    </p>
                    <pre>{JSON.stringify(value, null, 2)}</pre>
                    <div className="modal-actions">
                      <button onClick={() => setExporting(false)}>
                        Cancel export
                      </button>
                      <button
                        onClick={() =>
                          exportFile(
                            "rootlith-comparison.json",
                            JSON.stringify(value, null, 2),
                            "application/json",
                          )
                        }
                      >
                        Export Comparison as JSON
                      </button>
                      <button
                        onClick={() =>
                          exportFile(
                            "rootlith-comparison.html",
                            comparisonHTML(value),
                            "text/html",
                          )
                        }
                      >
                        Export Comparison as HTML
                      </button>
                    </div>
                  </div>
                );
              })()}
            <div className="comparison-summary">
              <span>{counts("Improvement")} improvements</span>
              <span>{counts("Regression")} regressions</span>
              <span>{counts("Unchanged status")} unchanged statuses</span>
              <span>
                {rows.filter((r) => !r.left || !r.right).length} unmatched nodes
              </span>
            </div>
            <div className="comparison-rows">
              {rows
                .filter(
                  (row) =>
                    !changesOnly ||
                    row.classification !== "Unchanged status" ||
                    row.evidenceChanged ||
                    row.left?.tested !== row.right?.tested ||
                    (row.durationDelta !== undefined &&
                      row.durationDelta !== 0) ||
                    row.left?.label !== row.right?.label,
                )
                .map((row) => (
                  <article key={row.nodeId}>
                    <div className="timeline-title">
                      <h3>{row.right?.label || row.left?.label}</h3>
                      <span
                        className={`comparison-tag ${row.classification.toLowerCase()}`}
                      >
                        {row.classification}
                      </span>
                      {row.evidenceChanged && (
                        <small>Diagnostic details changed</small>
                      )}
                    </div>
                    <small>
                      Node ID: {row.nodeId} ·{" "}
                      {row.target === "same"
                        ? "Same recorded target"
                        : row.target === "changed"
                          ? "Target changed — results are not equivalent"
                          : "Target unavailable — comparability unverified"}
                      {row.durationDelta !== undefined
                        ? ` · Elapsed change: ${row.durationDelta > 0 ? "+" : ""}${row.durationDelta} ms`
                        : " · Timing comparison unavailable"}
                    </small>
                    {row.left?.label !== row.right?.label &&
                      row.left &&
                      row.right && (
                        <p className="muted">
                          Label changed: {row.left.label} → {row.right.label}
                        </p>
                      )}
                    <div className="comparison-pair">
                      <div>
                        <small>BASELINE</small>
                        <Evidence step={row.left} />
                      </div>
                      <div>
                        <small>FOLLOW-UP</small>
                        <Evidence step={row.right} />
                      </div>
                    </div>
                  </article>
                ))}
            </div>
            {rows.length === 0 && <p>No steps recorded in either report.</p>}
          </>
        )}
      </section>
    </div>
  );
}
