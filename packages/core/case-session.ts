import { canonical } from "./workspace-backup";
import { retainedFavorites } from "./history";
import { storeSchema, type Store } from "./storage";
import type { Workflow } from "../schemas";
import type { Report } from "../workflow-engine";
export type CaseSession = {
  caseId: string;
  caseCreated: string;
  workflowId: string;
};
export function validateCaseSession(
  store: Store,
  session: CaseSession,
  workflowId: string,
) {
  const value = store.cases?.find((c) => c.id === session.caseId);
  if (
    !value ||
    value.created !== session.caseCreated ||
    value.archived ||
    session.workflowId !== workflowId ||
    !value.workflowIds.includes(workflowId) ||
    !store.workflows.some((w) => w.id === workflowId)
  )
    throw Error(
      "Case context is no longer valid: case/workflow removed, archived or unlinked. Reopen the linked playbook from an active case.",
    );
  if (value.runIds.length >= 50)
    throw Error(
      "Case has 50 run references. Export its dossier and explicitly unlink old references in Edit case before starting another case run. No links were evicted.",
    );
  return value;
}
export function beginCaseSession(
  store: Store,
  caseId: string,
  workflowId: string,
): CaseSession {
  const value = store.cases?.find((c) => c.id === caseId);
  const session = { caseId, caseCreated: value?.created || "", workflowId };
  validateCaseSession(store, session, workflowId);
  return session;
}
// One reducer produces the report, provenance and optional case link together.
// No live UI selection or global context is consulted after execution begins.
export function recordCaseRun(
  store: Store,
  workflow: Workflow,
  report: Report,
  session?: CaseSession,
  cancelled = false,
): Store {
  const saved = store.workflows.find((w) => w.id === workflow.id);
  if (!saved || canonical(saved) !== canonical(workflow))
    throw Error(
      "Run was not saved: workflow changed or was removed during execution. Export this report and reopen the intended playbook before retrying.",
    );
  if (
    store.reports.some((r) => r.id === report.id) ||
    Object.hasOwn(store.runWorkflows || {}, report.id) ||
    store.favoriteRuns?.includes(report.id) ||
    store.cases?.some((c) => c.runIds.includes(report.id))
  )
    throw Error(
      "Run ID collides with existing or missing evidence. Report not saved; export it before retrying with a new run.",
    );
  const aborted =
    cancelled || report.steps.some((s) => s.status === "cancelled");
  const owner =
    session && !aborted
      ? validateCaseSession(store, session, workflow.id)
      : undefined;
  const reports = [report, ...store.reports].slice(0, 50);
  const origins = { ...store.runWorkflows, [report.id]: workflow.id };
  return storeSchema.parse({
    ...store,
    reports,
    favoriteRuns: retainedFavorites(reports, store.favoriteRuns || []),
    runWorkflows: Object.fromEntries(
      reports.filter((r) => origins[r.id]).map((r) => [r.id, origins[r.id]]),
    ),
    ...(owner
      ? {
          cases: store.cases!.map((c) =>
            c.id === owner.id
              ? {
                  ...c,
                  runIds: [report.id, ...c.runIds],
                  updated: new Date().toISOString(),
                }
              : c,
          ),
        }
      : {}),
  });
}
export function caseEvidence(store: Store, caseId: string) {
  const value = store.cases?.find((c) => c.id === caseId);
  const refs = value?.runIds || [];
  const time = (date: string) =>
    Number.isFinite(Date.parse(date)) ? Date.parse(date) : -Infinity;
  const reports = store.reports
    .filter((r) => refs.includes(r.id))
    .sort((a, b) => time(b.date) - time(a.date));
  const checks = reports.flatMap((r) => r.steps.filter((s) => !!s.tested));
  return {
    latest: reports.find((r) => Number.isFinite(Date.parse(r.date))),
    recent: reports.slice(0, 5),
    available: reports.length,
    missing: refs.filter((id) => !store.reports.some((r) => r.id === id))
      .length,
    failed: checks.filter((s) => s.status === "failed").length,
    inconclusive: checks.filter((s) => s.status === "inconclusive").length,
  };
}
