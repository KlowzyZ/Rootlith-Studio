import { caseTimeline } from "./action-plan";
import type { InvestigationCase } from "./cases";
import type { Store } from "./storage";
import { redactedReport, reportHTML, escapeHTML } from "./reports";
export function caseDossier(
  value: InvestigationCase,
  store: Store,
  reviewed = false,
) {
  const profile = store.targetProfiles?.find((p) => p.id === value.profileId);
  const timeline = caseTimeline(value, store);
  const tasks = value.actionPlan || [];
  const latest = store.reports
    .filter((r) => value.runIds.includes(r.id))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .find((r) => Number.isFinite(Date.parse(r.date)));
  return {
    handover: {
      latestEvidence: latest
        ? {
            availability: "available",
            title: reviewed ? latest.workflow : "[Workflow withheld]",
            date: reviewed ? latest.date : "[withheld]",
            mode: latest.demo ? "SIMULATED" : "NATIVE",
          }
        : {
            availability: "unavailable",
            title: "No dated saved execution available",
            date: "[unavailable]",
            mode: "[unavailable]",
          },
      checked: tasks.filter((t) => t.done).length,
      pending: tasks.filter((t) => !t.done).length,
      nextPending: tasks.some((t) => !t.done)
        ? reviewed
          ? tasks.find((t) => !t.done)!.title
          : "[Task description withheld]"
        : "No pending item recorded",
      notice:
        "Checklist states are manually recorded claims, not proof of execution. Timeline is derived from current saved records, not a complete audit log.",
    },
    actionPlan: tasks.map((task, i) => ({
      id: reviewed ? task.id : `Task ${i + 1}`,
      title: reviewed ? task.title : "[Task description withheld]",
      done: task.done,
      created: reviewed ? task.created : "[withheld]",
      updated: reviewed ? task.updated : "[withheld]",
      comment: reviewed ? task.comment : "[Comment withheld]",
      recordedBy: reviewed ? task.recordedBy : "[Author withheld]",
      suggested: task.suggested,
    })),
    timeline: timeline.events.map((event, i) =>
      reviewed
        ? event
        : {
            kind: event.kind,
            at: "[withheld]",
            reference: `Entry ${i + 1}`,
            label:
              event.kind === "execution"
                ? "Recorded run timestamp"
                : event.kind === "authored"
                  ? "Authored task timestamp"
                  : "Case metadata timestamp",
            ...(event.mode ? { mode: event.mode } : {}),
          },
    ),
    format: "rootlith-case-dossier-v1",
    privacy: reviewed
      ? "Reviewed identifying details and notes included"
      : "Identifiers, authored text, targets and evidence withheld",
    case: {
      name: reviewed ? value.name : "Investigation case",
      id: reviewed ? value.id : "[withheld]",
      state: value.archived ? "archived" : "active",
      created: reviewed ? value.created : "[withheld]",
      updated: reviewed ? value.updated : "[withheld]",
      note: reviewed ? value.note : "[Notes withheld]",
    },
    profile: {
      availability: !value.profileId
        ? "not linked"
        : profile
          ? "available"
          : "unavailable",
      ...(reviewed && value.profileId
        ? { id: value.profileId, name: profile?.name }
        : {}),
    },
    workflows: value.workflowIds.map((id, i) => {
      const workflow = store.workflows.find((w) => w.id === id);
      return {
        reference: reviewed ? id : `Playbook ${i + 1}`,
        availability: workflow ? "available" : "unavailable",
        title: workflow
          ? reviewed
            ? workflow.name
            : `Playbook ${i + 1}`
          : "Unavailable playbook",
      };
    }),
    runs: value.runIds.map((id, i) => {
      const original = store.reports.find((r) => r.id === id);
      if (!original)
        return {
          reference: reviewed ? id : `Run ${i + 1}`,
          availability: "unavailable" as const,
          notice:
            "Reference absent from saved history; no evidence or execution mode can be inferred.",
        };
      const report = reviewed
        ? structuredClone(original)
        : redactedReport(original);
      const counts: Record<string, number> = {};
      for (const step of report.steps)
        counts[step.status] = (counts[step.status] || 0) + 1;
      return {
        reference: reviewed ? id : `Run ${i + 1}`,
        availability: "available" as const,
        title: report.workflow,
        date: report.date,
        mode: report.demo ? "SIMULATED DEMO" : "NATIVE",
        counts,
        observations: report.steps.filter(
          (s) => s.status === "failed" || s.status === "inconclusive",
        ),
        limitations: report.limitations,
      };
    }),
    limitations: [
      "This dossier summarizes existing saved references only; it creates no new evidence and does not establish root cause or device health.",
      "Linked profiles are context, not evidence of targets tested. Profile configurations are not exported.",
      "Missing references may have been deleted or expired from the 50-run history; this export does not restore or retain their evidence.",
      "Each available run is explicitly marked SIMULATED DEMO or NATIVE. Elapsed step times include overhead and user-answer waits.",
      reviewed
        ? "Review all identifiers, notes, labels, recorded targets and evidence before sharing."
        : "Identifying fields and authored notes/evidence are withheld by default; availability, modes, statuses and measured durations remain.",
    ],
  };
}
export type CaseDossier = ReturnType<typeof caseDossier>;
export function caseDossierHTML(value: CaseDossier) {
  const esc = escapeHTML;
  const handover = `<h2>Handover Summary</h2><p>${value.handover.checked} checked · ${value.handover.pending} pending</p><p>Next pending: ${esc(value.handover.nextPending)}</p><p>Latest recorded evidence: ${esc(value.handover.latestEvidence.title)} · ${esc(value.handover.latestEvidence.date)} · ${esc(value.handover.latestEvidence.mode)}</p><p>${esc(value.handover.notice)}</p><h2>Action plan — manually recorded</h2>${value.actionPlan.map((t) => `<article><h3>${t.done ? "Checked" : "Pending"} · ${esc(t.title)}</h3><p>${esc(t.id)} · ${t.suggested ? "Suggested human action" : "Authored task"}</p><pre>${esc(t.comment || "")}</pre><p>Recorded by (self-reported): ${esc(t.recordedBy || "Not recorded")} · Created ${esc(t.created)} · Last updated ${esc(t.updated)}</p></article>`).join("") || "<p>No action plan recorded.</p>"}<h2>Case timeline — saved timestamps only</h2>${value.timeline.map((e) => `<p>${esc(e.at)} · ${esc(e.kind)} · ${esc(e.label)}${"mode" in e && e.mode ? ` · ${esc(e.mode)}` : ""}${"recordedBy" in e && e.recordedBy ? ` · Self-reported author: ${esc(e.recordedBy)}` : ""}</p>`).join("")}`;
  const body =
    handover +
    `<h2>Case metadata</h2><p>${esc(value.privacy)}</p><p>Case ${esc(value.case.id)} · ${esc(value.case.state)}</p><p>Created: ${esc(value.case.created)} · Updated: ${esc(value.case.updated)}</p><h2>Technician note</h2><pre>${esc(value.case.note || "No note recorded")}</pre><p>Profile reference: ${esc(value.profile.availability)}${value.profile.name ? ` · ${esc(value.profile.name)}` : ""}</p><h2>Linked playbooks</h2>${value.workflows.map((w) => `<article><strong>${esc(w.title)}</strong><p>${esc(w.reference)} · ${esc(w.availability)}</p></article>`).join("") || "<p>No playbooks linked.</p>"}<h2>Linked run summaries and observed failures</h2>${
      value.runs
        .map(
          (r) =>
            `<article><h3>${esc(r.reference)} · ${esc(r.availability)}</h3>${
              r.availability === "unavailable"
                ? `<p>${esc(r.notice!)}</p>`
                : `<p><strong>${esc(r.mode!)}</strong> · ${esc(r.title!)} · ${esc(r.date!)}</p><p>${Object.entries(
                    r.counts!,
                  )
                    .map(([status, count]) => `${esc(status)}: ${count}`)
                    .join(
                      " · ",
                    )}</p>${r.observations!.map((s) => `<section><h4>${esc(s.label)} · ${esc(s.status)}</h4><p>Node ${esc(s.nodeId)} · ${esc(s.tested || "Target not recorded")}</p><pre>${esc(s.output?.detail || "No diagnostic detail recorded")}</pre>${s.output?.status !== undefined ? `<p>HTTP status: ${s.output.status}</p>` : ""}<p>${s.output && Number.isFinite(s.duration) && s.duration >= 0 ? `${s.duration} ms elapsed` : "No measured execution time available"}</p></section>`).join("") || "<p>No failed or inconclusive steps in this available report. This does not establish health.</p>"}${r.limitations!.map((l) => `<p>${esc(l)}</p>`).join("")}`
            }</article>`,
        )
        .join("") || "<p>No runs linked.</p>"
    }`;
  return reportHTML({
    id: "dossier",
    workflow: "Investigation case dossier",
    version: "dossier-v1",
    date: value.case.updated,
    demo: false,
    steps: [],
    limitations: value.limitations,
  })
    .replace(
      "<title>Rootlith Studio · Diagnostic report</title>",
      "<title>Rootlith Studio · Investigation case dossier</title>",
    )
    .replace(
      '<div class="brand">ROOTLITH STUDIO / DIAGNOSTIC REPORT</div>',
      '<div class="brand">ROOTLITH STUDIO / INVESTIGATION CASE DOSSIER</div>',
    )
    .replace(
      "<h1>Investigation case dossier</h1>",
      () => `<h1>${esc(value.case.name)}</h1>`,
    )
    .replace("Workflow version dossier-v1", "Case dossier")
    .replace(
      /<h2>Execution summary<\/h2>[\s\S]*?<h2>Interpretation and next steps<\/h2>/,
      () => body + "<h2>Interpretation and next steps</h2>",
    );
}
