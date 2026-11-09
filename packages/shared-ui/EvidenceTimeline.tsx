import { useState } from "react";
import type { Step } from "../workflow-engine";
const meanings: Record<Step["status"], string> = {
  pending: "Waiting to run.",
  running: "Collecting evidence…",
  passed:
    "The step completed successfully; this alone does not establish service health.",
  failed:
    "The check did not meet its success criteria. This does not establish a root cause.",
  inconclusive: "The available evidence cannot establish success or failure.",
  skipped: "Not visited on the selected execution path.",
  cancelled: "Execution was cancelled; no completed result should be inferred.",
};
function EvidenceDetail({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length < 1200) return <pre>{text}</pre>;
  return (
    <div className="evidence-detail">
      <pre>{expanded ? text : `${text.slice(0, 900)}…`}</pre>
      <button aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        {expanded
          ? "Collapse output"
          : `Inspect full recorded output (${text.length.toLocaleString()} characters)`}
      </button>
    </div>
  );
}
export function EvidenceTimeline({
  steps,
  demo,
}: {
  steps: Step[];
  demo: boolean;
}) {
  const [limit, setLimit] = useState(20);
  const visited = steps.filter(
    (s) =>
      !["pending", "skipped"].includes(s.status) &&
      !(s.status === "cancelled" && !s.output),
  );
  const unvisited = steps.filter(
    (s) => s.status === "skipped" || (s.status === "cancelled" && !s.output),
  );
  const waiting = steps.filter((s) => s.status === "pending").length;
  return (
    <section className="evidence-timeline" aria-label="Evidence timeline">
      <div className="timeline-heading">
        <h3>Evidence timeline</h3>
        <small>
          {demo ? "SIMULATED · no native checks" : "Native run · read-only"}
        </small>
      </div>
      <p className="muted">
        Execution order · elapsed step time includes any wait for an answer.
      </p>
      <ol>
        {visited.slice(0, limit).map((s, i) => (
          <li key={s.nodeId}>
            <span className="timeline-number">{i + 1}</span>
            <div>
              <div className="timeline-title">
                <strong>{s.label}</strong>
                <span className={`status ${s.status}`}>{s.status}</span>
                {s.output && s.status !== "running" && (
                  <small>{s.duration} ms elapsed</small>
                )}
              </div>
              {s.tested && <p className="tested">{s.tested}</p>}
              <EvidenceDetail text={s.output?.detail || meanings[s.status]} />
              {s.output?.status !== undefined && (
                <small>HTTP status: {s.output.status}</small>
              )}
              <p className="muted">{meanings[s.status]}</p>
            </div>
          </li>
        ))}
      </ol>
      {visited.length > limit && (
        <button onClick={() => setLimit((n) => n + 20)}>
          Show next evidence steps ({visited.length - limit} remaining)
        </button>
      )}
      {unvisited.length > 0 && (
        <details className="unvisited">
          <summary>{unvisited.length} steps not executed</summary>
          {unvisited.map((s) => (
            <p key={s.nodeId}>
              <span className={`status ${s.status}`}>{s.status}</span> {s.label}{" "}
              — {meanings[s.status]}
            </p>
          ))}
        </details>
      )}
      {waiting > 0 && (
        <p className="muted" role="status">
          {waiting} steps waiting · branches may be skipped
        </p>
      )}
    </section>
  );
}
