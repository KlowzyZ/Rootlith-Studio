import type { Report } from "../workflow-engine";
export function redactedReport(r: Report): Report {
  return {
    ...r,
    id: "[withheld]",
    date: "[withheld]",
    limitations: [
      r.demo
        ? "SIMULATED DEMO: no native diagnostics performed."
        : "Read-only evidence; results do not establish a root cause.",
      "Identifying evidence and authored text withheld by export privacy controls.",
    ],
    workflow: "[redacted workflow]",
    version: "[withheld]",
    steps: r.steps.map((s, i) => ({
      ...s,
      nodeId: `step-${i + 1}`,
      label: `Step ${i + 1}`,
      tested: s.tested === undefined ? undefined : "[Target withheld]",
      output: s.output
        ? {
            ...s.output,
            answer: s.output.answer === undefined ? undefined : "[redacted]",
            detail:
              "[Evidence withheld for privacy. Export reviewed details to include it.]",
          }
        : undefined,
    })),
  };
}
export const escapeHTML = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function reportHTML(r: Report) {
  const counts = new Map<string, number>();
  for (const step of r.steps)
    counts.set(step.status, (counts.get(step.status) || 0) + 1);
  const summary = [...counts]
    .map(
      ([status, count]) =>
        `<div><dt>${escapeHTML(status)}</dt><dd>${count}</dd></div>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Rootlith Studio · Diagnostic report</title><style>
 *{box-sizing:border-box}body{font:15px/1.6 system-ui,sans-serif;color:#233238;background:#f3f6f5;margin:0;padding:48px 24px}main{max-width:960px;margin:auto;background:white;padding:40px;border:1px solid #dbe4e0;border-radius:10px}header{border-bottom:3px solid #227c66;padding-bottom:20px;margin-bottom:28px}.brand{color:#227c66;font-size:12px;letter-spacing:2px;font-weight:700}h1{font-size:30px;letter-spacing:-1px;margin:16px 0 8px}h2{font-size:19px;margin:28px 0 14px}p{margin:8px 0}small,.meta{color:#60736e}dl{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}dl div{border:1px solid #dbe4e0;padding:12px 20px;min-width:105px;border-radius:5px}dt{text-transform:capitalize;font-size:12px}dd{margin:0;font-size:25px;font-weight:600}article{padding:20px 0;border-bottom:1px solid #dbe4e0;break-inside:avoid}.step-title{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.status{font-size:11px;text-transform:uppercase;border:1px solid #a6b8b1;padding:2px 7px;border-radius:4px}.failed{color:#943636}.passed{color:#227c66}.inconclusive{color:#89611d}pre{font:12px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f5;padding:16px;border-radius:4px}.notice{border-left:3px solid #b18438;padding:12px 18px;background:#faf6ec}footer{font-size:11px;color:#60736e;border-top:1px solid #dbe4e0;margin-top:30px;padding-top:16px}@media print{body{background:white;padding:0}main{border:0;padding:0}article{break-inside:avoid}pre{background:white;border:1px solid #dbe4e0}}@media(max-width:600px){body{padding:12px}main{padding:20px}}
 </style></head><body><main><header><div class="brand">ROOTLITH STUDIO / DIAGNOSTIC REPORT</div><h1>${escapeHTML(r.workflow)}</h1><p class="meta">Workflow version ${escapeHTML(r.version)} · ${escapeHTML(r.date)}</p></header>${r.demo ? '<p class="notice"><strong>SIMULATED DEMO DATA.</strong> No native diagnostic checks were performed.</p>' : ""}<h2>Execution summary</h2><dl>${summary}</dl><p class="meta">${r.steps.length} steps recorded · ${r.steps.reduce((sum, s) => sum + s.duration, 0)} ms in recorded steps</p><h2>Execution path and evidence</h2>${r.steps.map((s, i) => `<article><div class="step-title"><small>${String(i + 1).padStart(2, "0")}</small><strong>${escapeHTML(s.label)}</strong><span class="status ${escapeHTML(s.status)}">${escapeHTML(s.status)}</span><small>${s.output ? `${s.duration} ms elapsed` : "Not executed"}</small></div>${s.tested ? `<p>${escapeHTML(s.tested)}</p>` : ""}<pre>${escapeHTML(s.output?.detail || "No evidence collected. This step was not executed.")}</pre></article>`).join("")}<h2>Interpretation and next steps</h2><p>Review failed and inconclusive checks with your support technician. Confirm the configured target and service state before changing settings. Reachability alone does not establish a root cause.</p><h2>Limitations and privacy</h2>${r.limitations.map((l) => `<p>${escapeHTML(l)}</p>`).join("")}<footer>Generated offline by Rootlith Studio. This report contains no scripts, remote fonts, tracking, or external resources. Share only after reviewing identifying details.</footer></main></body></html>`;
}
