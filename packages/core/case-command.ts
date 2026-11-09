import { canonical } from "./workspace-backup";
import { caseEvidence } from "./case-session";
import type { InvestigationCase } from "./cases";
import type { Store } from "./storage";
import type { Report } from "../workflow-engine";
export type CasePane =
  "overview" | "playbooks" | "evidence" | "actions" | "timeline";
export function commandOverview(value: InvestigationCase, store: Store) {
  const evidence = caseEvidence(store, value.id),
    tasks = value.actionPlan || [];
  const missingWorkflows = value.workflowIds.filter(
    (id) => !store.workflows.some((w) => w.id === id),
  );
  const missingProfile =
    !!value.profileId &&
    !store.targetProfiles?.some((p) => p.id === value.profileId);
  const next = tasks.find((t) => !t.done);
  return {
    evidence,
    tasks: tasks.length,
    checked: tasks.filter((t) => t.done).length,
    next,
    missingWorkflows,
    missingProfile,
    status: value.archived
      ? "Archived · read-only"
      : evidence.missing || missingWorkflows.length || missingProfile
        ? "References need review"
        : !evidence.available
          ? "Awaiting recorded evidence"
          : evidence.latest?.steps.some((s) =>
                ["cancelled", "pending", "running"].includes(s.status),
              )
            ? "Latest linked run incomplete"
            : evidence.failed || evidence.inconclusive
              ? "Recorded observations need review"
              : next
                ? "Manual follow-up pending"
                : "Review and handover",
    nextStep: value.archived
      ? "Reopen the case before changing its plan or linking evidence."
      : missingWorkflows.length
        ? "Review unavailable playbooks and link the intended saved workflow explicitly."
        : !value.workflowIds.length
          ? "Attach a saved playbook in Edit case, or create an investigation from a kit."
          : evidence.missing
            ? "Review missing history references; they are not retained by case links."
            : !evidence.available
              ? "Configure a linked playbook's targets, then choose Run for this case."
              : next
                ? next.title
                : "Review saved evidence and prepare a privacy-reviewed handover. This is not a claim of resolution.",
  };
}
export function attachCaseEvidence(
  store: Store,
  caseId: string,
  created: string,
  reviewedReport: Report,
): Store {
  const value = store.cases?.find((c) => c.id === caseId);
  if (!value || value.created !== created)
    throw Error("Case context changed or was removed. Reopen evidence review.");
  if (value.archived)
    throw Error("Reopen the archived case before attaching evidence.");
  const report = store.reports.find((r) => r.id === reviewedReport.id);
  if (!report || canonical(report) !== canonical(reviewedReport))
    throw Error(
      "Report changed or expired since review. No evidence link saved.",
    );
  if (value.runIds.includes(report.id))
    throw Error("This report is already linked to the case.");
  if (value.runIds.length >= 50)
    throw Error(
      "Case has 50 references, including missing reports. Explicitly unlink old references before attaching another report.",
    );
  return {
    ...store,
    cases: store.cases!.map((c) =>
      c.id === value.id
        ? {
            ...c,
            runIds: [report.id, ...c.runIds],
            updated: new Date().toISOString(),
          }
        : c,
    ),
  };
}
export function unlinkCaseEvidence(
  store: Store,
  caseId: string,
  created: string,
  id: string,
): Store {
  const value = store.cases?.find((c) => c.id === caseId);
  if (
    !value ||
    value.created !== created ||
    value.archived ||
    !value.runIds.includes(id)
  )
    throw Error("Case or reference changed. Reopen evidence review.");
  return {
    ...store,
    cases: store.cases!.map((c) =>
      c.id === caseId
        ? {
            ...c,
            runIds: c.runIds.filter((r) => r !== id),
            updated: new Date().toISOString(),
          }
        : c,
    ),
  };
}
