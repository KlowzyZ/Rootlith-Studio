import {
  actionTaskSchema,
  caseSchema,
  type ActionTask,
  type InvestigationCase,
} from "./cases";
import { canonical } from "./workspace-backup";
import { storeSchema, type Store } from "./storage";
export type TaskChange =
  | { kind: "add"; task: ActionTask }
  | { kind: "toggle"; id: string }
  | { kind: "move"; id: string; direction: -1 | 1 }
  | { kind: "edit" | "remove"; before: ActionTask; task?: ActionTask };
export function newTask(
  title: string,
  comment = "",
  recordedBy = "",
  suggested = false,
): ActionTask {
  const now = new Date().toISOString();
  return actionTaskSchema.parse({
    id: crypto.randomUUID(),
    title,
    comment,
    recordedBy,
    suggested,
    done: false,
    created: now,
    updated: now,
  });
}
export function updateActionPlan(
  store: Store,
  caseId: string,
  created: string,
  change: TaskChange,
): Store {
  const value = store.cases?.find((c) => c.id === caseId);
  if (!value || value.created !== created)
    throw Error(
      "Case no longer matches this editor. Reopen it before editing tasks.",
    );
  if (value.archived)
    throw Error("Archived action plans are read-only. Reopen the case first.");
  const tasks = [...(value.actionPlan || [])];
  const now = new Date().toISOString();
  if (change.kind === "add") {
    if (tasks.some((t) => t.id === change.task.id))
      throw Error("Task ID already exists. Reopen the task editor.");
    if (change.task.done) throw Error("New tasks must start unchecked.");
    tasks.push(actionTaskSchema.parse(change.task));
  } else {
    const id = "before" in change ? change.before.id : change.id;
    const index = tasks.findIndex((t) => t.id === id);
    if (index < 0)
      throw Error("Task was removed. Reopen the plan to continue.");
    const task = tasks[index];
    if (
      (change.kind === "edit" || change.kind === "remove") &&
      canonical(task) !== canonical(change.before)
    )
      throw Error(
        "Task changed since editing began. Cancel and reopen it; newer changes were preserved.",
      );
    if (change.kind === "toggle")
      tasks[index] = { ...task, done: !task.done, updated: now };
    if (change.kind === "move") {
      const destination = index + change.direction;
      if (destination >= 0 && destination < tasks.length)
        [tasks[index], tasks[destination]] = [tasks[destination], tasks[index]];
    }
    if (change.kind === "remove") tasks.splice(index, 1);
    if (change.kind === "edit") {
      if (
        !change.task ||
        change.task.id !== task.id ||
        change.task.created !== task.created ||
        change.task.done !== task.done
      )
        throw Error(
          "Task identity/state changed; use the manual checkbox to change completion.",
        );
      tasks[index] = actionTaskSchema.parse({ ...change.task, updated: now });
    }
  }
  const next = caseSchema.parse({ ...value, actionPlan: tasks, updated: now });
  return storeSchema.parse({
    ...store,
    cases: store.cases!.map((c) => (c.id === value.id ? next : c)),
  });
}
// Apply only changed fields from the existing case form; concurrent task/run edits survive.
export function editCaseFields(
  store: Store,
  before: InvestigationCase,
  edited: InvestigationCase,
): Store {
  const current = store.cases?.find((c) => c.id === before.id);
  if (!current) {
    if (before.name) throw Error("Case was removed. Reopen the workspace.");
    return storeSchema.parse({
      ...store,
      cases: [...(store.cases || []), caseSchema.parse(edited)],
    });
  }
  if (!before.name || current.created !== before.created)
    throw Error("Case identity changed. Reopen the editor.");
  const next = { ...current };
  for (const key of [
    "name",
    "note",
    "profileId",
    "workflowIds",
    "runIds",
  ] as const) {
    if (canonical(before[key] ?? null) === canonical(edited[key] ?? null))
      continue;
    if (canonical(current[key] ?? null) !== canonical(before[key] ?? null))
      throw Error(
        `Case ${key} changed while editing. Cancel and reopen to preserve newer edits.`,
      );
    Object.assign(next, { [key]: edited[key] });
  }
  return storeSchema.parse({
    ...store,
    cases: store.cases!.map((c) =>
      c.id === current.id
        ? caseSchema.parse({ ...next, updated: new Date().toISOString() })
        : c,
    ),
  });
}
export function caseTimeline(value: InvestigationCase, store: Store) {
  const events: {
    kind: "authored" | "metadata" | "execution";
    at: string;
    reference: string;
    label: string;
    mode?: string;
    recordedBy?: string;
  }[] = [
    {
      kind: "metadata",
      at: value.created,
      reference: value.id,
      label: "Case creation timestamp",
    },
    {
      kind: "metadata",
      at: value.updated,
      reference: value.id,
      label: "Latest case metadata save (may include notes, links or tasks)",
    },
  ];
  for (const task of value.actionPlan || []) {
    events.push({
      kind: "authored",
      at: task.created,
      reference: task.id,
      label: `Task created: ${task.title}`,
      recordedBy: task.recordedBy,
    });
    if (task.updated !== task.created)
      events.push({
        kind: "authored",
        at: task.updated,
        reference: task.id,
        label: `Task last updated: ${task.title} — currently ${task.done ? "checked" : "pending"}`,
        recordedBy: task.recordedBy,
      });
  }
  for (const id of value.runIds) {
    const report = store.reports.find((r) => r.id === id);
    if (report)
      events.push({
        kind: "execution",
        at: report.date,
        reference: id,
        label: `Recorded run timestamp: ${report.workflow}${report.steps.some((s) => s.status === "cancelled") ? " (contains cancelled steps)" : ""}`,
        mode: report.demo ? "SIMULATED" : "NATIVE",
      });
  }
  return {
    events: events.sort(
      (a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0),
    ),
    missingRuns: value.runIds.filter(
      (id) => !store.reports.some((r) => r.id === id),
    ),
  };
}
