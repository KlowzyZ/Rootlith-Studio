import { z } from "zod";
import type { Store } from "./storage";
const reference = z.string().min(1).max(128);
export const actionTaskSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    title: z.string().trim().min(1).max(160),
    done: z.boolean(),
    created: z.string().datetime(),
    updated: z.string().datetime(),
    comment: z.string().max(500).optional(),
    recordedBy: z.string().trim().max(80).optional(),
    suggested: z.boolean().optional(),
  })
  .strict()
  .refine(
    (t) => Date.parse(t.updated) >= Date.parse(t.created),
    "Task update cannot precede creation",
  );
export type ActionTask = z.infer<typeof actionTaskSchema>;
export const caseSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    name: z.string().trim().min(1).max(100),
    note: z.string().max(4000),
    profileId: z.string().max(64).optional(),
    workflowIds: z.array(reference).max(100),
    runIds: z.array(reference).max(50),
    archived: z.boolean(),
    actionPlan: z
      .array(actionTaskSchema)
      .max(30)
      .refine(
        (tasks) => new Set(tasks.map((t) => t.id)).size === tasks.length,
        "Task IDs must be unique",
      )
      .optional(),
    created: z.string().datetime(),
    updated: z.string().datetime(),
  })
  .strict();
export type InvestigationCase = z.infer<typeof caseSchema>;
export function putCase(cases: InvestigationCase[], value: InvestigationCase) {
  const parsed = caseSchema.safeParse(value);
  if (!parsed.success) throw Error(parsed.error.issues[0].message);
  const next = [parsed.data, ...cases.filter((c) => c.id !== value.id)];
  if (next.length > 80)
    throw Error(
      "Case limit reached (80, including archived cases). Rename or reopen an existing case.",
    );
  return next;
}
export function caseOverview(value: InvestigationCase, store: Store) {
  const runs = value.runIds.map((id) => ({
    id,
    report: store.reports.find((r) => r.id === id),
  }));
  const available = runs
    .flatMap((r) => (r.report ? [r.report] : []))
    .sort((a, b) => {
      const time = (date: string) =>
        Number.isFinite(Date.parse(date)) ? Date.parse(date) : -Infinity;
      return time(b.date) - time(a.date) || 0;
    });
  return {
    runs,
    latest: available.find((r) => Number.isFinite(Date.parse(r.date))),
    workflows: value.workflowIds.map((id) => ({
      id,
      workflow: store.workflows.find((w) => w.id === id),
    })),
    profile: store.targetProfiles?.find((p) => p.id === value.profileId),
    observations: available.flatMap((r) =>
      r.steps
        .filter((s) => ["failed", "inconclusive"].includes(s.status))
        .map((step) => ({ runId: r.id, demo: r.demo, step })),
    ),
  };
}
export function filterCases(
  cases: InvestigationCase[],
  store: Store,
  query: string,
  state: string,
  order: string,
) {
  const text = query.trim().toLocaleLowerCase();
  return cases
    .filter(
      (c) =>
        (state === "all" || (state === "archived") === c.archived) &&
        (!text ||
          [
            c.name,
            c.note,
            ...(c.actionPlan || []).flatMap((t) => [t.title, t.comment || ""]),
            store.targetProfiles?.find((p) => p.id === c.profileId)?.name || "",
            ...c.workflowIds.map(
              (id) => store.workflows.find((w) => w.id === id)?.name || "",
            ),
          ].some((value) => value.toLocaleLowerCase().includes(text))),
    )
    .sort(
      (a, b) =>
        (Date.parse(a.updated) - Date.parse(b.updated)) *
          (order === "oldest" ? 1 : -1) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}
export function localDate(value: string) {
  return Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "Date unavailable";
}
