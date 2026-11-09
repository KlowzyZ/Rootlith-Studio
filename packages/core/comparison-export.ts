import type { Report, Step } from "../workflow-engine";
import { compareSteps, comparisonScope, type RunWorkflows } from "./comparison";
import { redactedReport, reportHTML, escapeHTML } from "./reports";
export function comparisonExport(
  a: Report,
  b: Report,
  origins: RunWorkflows,
  sensitive = false,
  legacyAcknowledged = false,
) {
  const identity = comparisonScope(a, b, origins);
  if (identity !== "verified" && !(identity === "legacy" && legacyAcknowledged))
    throw Error(
      "Comparison requires matching identity or explicit legacy acknowledgment.",
    );
  const rows = compareSteps(a, b);
  const clean = (s: Step | undefined, index: number) =>
    s &&
    (sensitive
      ? structuredClone(s)
      : redactedReport({ ...a, steps: [s] }).steps.map((step) => ({
          ...step,
          nodeId: `step-${index + 1}`,
          label: `Step ${index + 1}`,
        }))[0]);
  const identify = (r: Report) => {
    const value = sensitive ? r : redactedReport(r);
    return {
      id: value.id,
      workflow: value.workflow,
      version: value.version,
      date: value.date,
      mode: r.demo ? "SIMULATED DEMO" : "NATIVE",
      limitations: value.limitations,
    };
  };
  return {
    format: "rootlith-comparison-v1",
    privacy: sensitive
      ? "Reviewed identifying details included"
      : "Identifying details withheld",
    baseline: identify(a),
    followup: identify(b),
    workflowIdentity:
      identity === "verified"
        ? "Same recorded workflow identity"
        : "Unverified legacy identity; user acknowledged",
    summary: {
      improvements: rows.filter((r) => r.classification === "Improvement")
        .length,
      regressions: rows.filter((r) => r.classification === "Regression").length,
      unchanged: rows.filter((r) => r.classification === "Unchanged status")
        .length,
    },
    limitations: [
      "Correlation does not establish root cause.",
      "Target equivalence uses recorded target text only; missing targets are unverified. Other settings may differ.",
      "Elapsed times include overhead and user-answer waits; faster does not imply healthier.",
    ],
    nodes: rows.map((r, i) => ({
      ...r,
      nodeId: sensitive ? r.nodeId : `step-${i + 1}`,
      left: clean(r.left, i),
      right: clean(r.right, i),
    })),
  };
}
export type ComparisonExport = ReturnType<typeof comparisonExport>;
export function comparisonHTML(value: ComparisonExport) {
  const esc = escapeHTML;
  const identify = (title: string, r: ComparisonExport["baseline"]) =>
    `<section><h2>${title} · ${esc(r.mode)}</h2><p>${esc(r.workflow)} · v${esc(r.version)}</p><p>Run ${esc(r.id)} · ${esc(r.date)}</p>${r.limitations.map((l) => `<p>${esc(l)}</p>`).join("")}</section>`;
  const evidence = (step?: Step) =>
    !step
      ? "<p>Node absent; evidence unavailable.</p>"
      : `<p><strong>${esc(step.status)}</strong> · ${esc(step.label)}</p><p>${esc(step.tested || "Target unavailable")}</p><pre>${esc(JSON.stringify(step.output || { detail: "No evidence collected" }, null, 2))}</pre><p>${step.output && !["pending", "running", "skipped"].includes(step.status) && Number.isFinite(step.duration) && step.duration >= 0 ? `${step.duration} ms elapsed` : "No measured execution time"}</p>`;
  const body = `${identify("Baseline", value.baseline)}${identify("Follow-up", value.followup)}<p>${esc(value.workflowIdentity)} · ${esc(value.privacy)}</p><h2>Comparison summary</h2><dl><div><dt>Improvements</dt><dd>${value.summary.improvements}</dd></div><div><dt>Regressions</dt><dd>${value.summary.regressions}</dd></div><div><dt>Unchanged statuses</dt><dd>${value.summary.unchanged}</dd></div></dl><h2>Node-by-node differences</h2>${value.nodes.map((n) => `<article><h3>${esc(n.right?.label || n.left!.label)} · ${esc(n.classification)}</h3><p>Node ${esc(n.nodeId)} · Recorded target: ${esc(n.target)} · Diagnostic details changed: ${n.evidenceChanged ? "yes" : "no"}</p><p>${n.durationDelta === undefined ? "Timing comparison unavailable" : `Elapsed change: ${n.durationDelta} ms`}</p><h4>Baseline</h4>${evidence(n.left)}<h4>Follow-up</h4>${evidence(n.right)}</article>`).join("")}`;
  const shell = reportHTML({
    id: "comparison",
    workflow: "Investigation comparison",
    version: "1",
    date: "Offline export",
    demo: value.baseline.mode === "SIMULATED DEMO",
    steps: [],
    limitations: value.limitations,
  });
  return shell
    .replace(
      /<h2>Execution summary<\/h2>[\s\S]*?<h2>Interpretation and next steps<\/h2>/,
      () => body + "<h2>Interpretation and next steps</h2>",
    )
    .replaceAll("DIAGNOSTIC REPORT", "INVESTIGATION COMPARISON")
    .replaceAll("Diagnostic report", "Investigation comparison");
}
