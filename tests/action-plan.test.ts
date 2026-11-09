import { expect, test, vi } from "vitest";
import { actionTaskSchema, caseSchema } from "../packages/core/cases";
import {
  newTask,
  updateActionPlan,
  editCaseFields,
  caseTimeline,
} from "../packages/core/action-plan";
import { caseDossier, caseDossierHTML } from "../packages/core/case-export";
import {
  createBackup,
  readBackup,
  planImport,
} from "../packages/core/workspace-backup";
import { prepareKit, addKit } from "../packages/core/investigation-kits";
import { beginCaseSession, recordCaseRun } from "../packages/core/case-session";
import {
  load,
  primaryRecord,
  storageKeys,
  useStoragePort,
  storeSchema,
  type Store,
} from "../packages/core/storage";
import { workspaceWriter } from "../packages/core/workspace-writer";
const fixture = (): Store => ({
  version: 1,
  workflows: [],
  reports: [],
  cases: [
    {
      id: "case",
      name: "Private cabinet",
      note: "Private notes",
      workflowIds: ["missing-workflow"],
      runIds: ["missing-run"],
      archived: false,
      created: "2026-11-07T10:00:00.000Z",
      updated: "2026-11-07T10:00:00.000Z",
    },
  ],
});
const change = (s: Store, operation: Parameters<typeof updateActionPlan>[3]) =>
  updateActionPlan(s, "case", s.cases![0].created, operation);
test("legacy cases stay unchanged; task schemas reject bounds, duplicate IDs and malformed data", () => {
  const store = fixture();
  expect(storeSchema.parse(store)).toEqual(store);
  expect(store.cases![0]).not.toHaveProperty("actionPlan");
  const task = newTask("Review authorization");
  expect(task.done).toBe(false);
  actionTaskSchema.parse(task);
  expect(() => newTask("x".repeat(161))).toThrow();
  expect(() => newTask(" ")).toThrow();
  expect(() => newTask("Task", "x".repeat(501))).toThrow();
  expect(() => newTask("Task", "", "x".repeat(81))).toThrow();
  for (const value of [
    { ...task, id: "bad/id" },
    { ...task, created: "yesterday" },
    { ...task, created: "2099-01-01T00:00:00.000Z" },
    { ...task, execute: "script" },
  ])
    expect(actionTaskSchema.safeParse(value).success).toBe(false);
  expect(() =>
    caseSchema.parse({ ...store.cases![0], actionPlan: [task, task] }),
  ).toThrow();
  let next = store;
  for (let i = 0; i < 30; i++)
    next = change(next, { kind: "add", task: newTask(`Task ${i}`) });
  expect(() =>
    change(next, { kind: "add", task: newTask("Over cap") }),
  ).toThrow();
  expect(next.cases![0].actionPlan).toHaveLength(30);
});
test("latest-state toggles and reorders preserve concurrent notes, links and tasks; stale edits/removal fail", () => {
  const initial = fixture();
  const task = newTask("Inspect cabling");
  let s = change(initial, { kind: "add", task });
  const stale = s.cases![0];
  const before = s.cases![0].actionPlan![0];
  s = {
    ...s,
    cases: [
      {
        ...s.cases![0],
        note: "Newer note",
        runIds: ["new-run", "missing-run"],
      },
    ],
  };
  s = change(s, { kind: "toggle", id: task.id });
  s = change(s, { kind: "toggle", id: task.id });
  expect(s.cases![0].actionPlan![0].done).toBe(false);
  expect(s.cases![0].note).toBe("Newer note");
  expect(s.cases![0].runIds[0]).toBe("new-run");
  s = change(s, { kind: "toggle", id: task.id });
  expect(() =>
    change(s, { kind: "edit", before, task: { ...before, title: "Stale" } }),
  ).toThrow(/changed/);
  expect(() => change(s, { kind: "remove", before })).toThrow(/changed/);
  const other = newTask("Review logs");
  s = change(s, { kind: "add", task: other });
  s = change(s, { kind: "move", id: other.id, direction: -1 });
  expect(s.cases![0].actionPlan![0].id).toBe(other.id);
  const edited = editCaseFields(s, stale, { ...stale, name: "Renamed case" });
  expect(edited.cases![0].note).toBe("Newer note");
  expect(edited.cases![0].actionPlan).toEqual(s.cases![0].actionPlan);
  expect(edited.cases![0].runIds[0]).toBe("new-run");
  expect(() =>
    editCaseFields(s, stale, { ...stale, note: "Stale replacement" }),
  ).toThrow(/changed/);
  expect(() =>
    updateActionPlan(s, "case", "different", { kind: "toggle", id: other.id }),
  ).toThrow(/no longer matches/);
  expect(() =>
    change(
      { ...s, cases: [{ ...s.cases![0], archived: true }] },
      { kind: "toggle", id: task.id },
    ),
  ).toThrow(/read-only/);
  s = change(s, { kind: "remove", before: s.cases![0].actionPlan![0] });
  expect(s.cases![0].actionPlan).toHaveLength(1);
});
test("backup fidelity and conflict planning retain the complete bounded action plan", async () => {
  const store = change(fixture(), {
    kind: "add",
    task: newTask("Private host camera.example", "Private comment", "Tech A"),
  });
  const parsed = await readBackup(await createBackup(store));
  expect(parsed.store).toEqual(store);
  const empty: Store = { version: 1, workflows: [], reports: [] };
  expect(planImport(empty, parsed.store).next.cases).toEqual(store.cases);
  const differing = structuredClone(store);
  differing.cases![0].actionPlan![0].done = true;
  const planned = planImport(store, differing);
  expect(planned.rows.find((r) => r.type === "cases")?.action).toBe("conflict");
  expect(planned.next.cases).toEqual(store.cases);
});
test("dossier and handover redact tasks/authors/timestamps and escaped HTML requires explicit opt-in", () => {
  const task = newTask(
    "SECRET camera.example <script>task()</script>",
    "SECRET comment",
    "SECRET author",
  );
  const store = change(fixture(), { kind: "add", task });
  const dossier = caseDossier(store.cases![0], store);
  const redacted = JSON.stringify(dossier) + caseDossierHTML(dossier);
  for (const secret of [
    "SECRET",
    "camera.example",
    "Private cabinet",
    "Private notes",
    task.id,
    task.created,
    "missing-workflow",
    "missing-run",
  ])
    expect(redacted).not.toContain(secret);
  expect(dossier.handover.pending).toBe(1);
  expect(dossier.actionPlan[0].done).toBe(false);
  const reviewed = caseDossier(store.cases![0], store, true);
  expect(JSON.stringify(reviewed)).toContain("SECRET comment");
  const html = caseDossierHTML(reviewed);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>task()");
  expect(html).toContain("Handover Summary");
});
test("timeline uses current saved timestamps without invented completion/removal events; kits and runs preserve manual tasks", () => {
  const kit = prepareKit("camera", "Kit case");
  let store = addKit({ version: 1, workflows: [], reports: [] }, kit);
  expect(kit.investigation.actionPlan).toHaveLength(3);
  expect(
    kit.investigation.actionPlan!.every((t) => !t.done && t.suggested),
  ).toBe(true);
  const timeline = caseTimeline(kit.investigation, store);
  expect(timeline.events.filter((e) => e.kind === "authored")).toHaveLength(3);
  expect(timeline.events.every((e) => e.kind !== "execution")).toBe(true);
  const result = {
    id: "run",
    workflow: kit.workflow.name,
    version: "1",
    date: "2026-11-07T12:00:00.000Z",
    demo: true,
    limitations: ["SIMULATED"],
    steps: [],
  };
  store = recordCaseRun(
    store,
    kit.workflow,
    result,
    beginCaseSession(store, kit.investigation.id, kit.workflow.id),
  );
  expect(store.cases![0].actionPlan).toEqual(kit.investigation.actionPlan);
  const evidence = caseTimeline(store.cases![0], store);
  expect(evidence.events.find((e) => e.kind === "execution")).toMatchObject({
    at: result.date,
    mode: "SIMULATED",
  });
  const missing = caseTimeline(fixture().cases![0], fixture());
  expect(missing.missingRuns).toEqual(["missing-run"]);
  expect(missing.events.some((e) => e.kind === "execution")).toBe(false);
});
test("serialized rapid toggles merge against latest state; native ACK failure never publishes optimistic state", async () => {
  const task = newTask("Inspect port");
  const start = change(fixture(), { kind: "add", task });
  const records = new Map<string, string>([
    [storageKeys.primary, JSON.stringify(start)],
    [storageKeys.draft, "keep-journal"],
    [storageKeys.quarantine, "keep-original"],
  ]);
  useStoragePort({
    getItem: (k) => records.get(k) ?? null,
    setItem: (k, v) => {
      records.set(k, v);
    },
    removeItem: (k) => {
      records.delete(k);
    },
  });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  const committed = vi.fn(),
    failed = vi.fn();
  const expected = { current: primaryRecord() };
  const writer = workspaceWriter({
    expected,
    committed,
    failed,
    pending: vi.fn(),
    flush: async () => {
      if (++calls === 2) await gate;
    },
  });
  const first = writer.update((s) =>
    change(s, { kind: "toggle", id: task.id }),
  );
  const note = writer.update((s) => ({
    ...s,
    cases: [{ ...s.cases![0], note: "Concurrent note" }],
  }));
  const second = writer.update((s) =>
    change(s, { kind: "toggle", id: task.id }),
  );
  await vi.waitFor(() => expect(calls).toBe(2));
  expect(committed).not.toHaveBeenCalled();
  release();
  await Promise.all([first, note, second]);
  expect(load().cases![0].actionPlan![0].done).toBe(false);
  expect(load().cases![0].note).toBe("Concurrent note");
  expect(records.get(storageKeys.draft)).toBe("keep-journal");
  expect(records.get(storageKeys.quarantine)).toBe("keep-original");
  let flushes = 0;
  const published = vi.fn();
  const broken = workspaceWriter({
    expected,
    committed: published,
    failed,
    pending: vi.fn(),
    flush: async () => {
      if (++flushes === 2) throw Error("Native ACK rejected");
    },
  });
  await expect(
    broken.update((s) => change(s, { kind: "toggle", id: task.id })),
  ).rejects.toThrow("Native ACK rejected");
  expect(published).not.toHaveBeenCalled();
  await expect(broken.idle()).rejects.toThrow("Native ACK rejected");
});
