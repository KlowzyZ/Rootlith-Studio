import { expect, test, vi } from "vitest";
import {
  beginCaseSession,
  validateCaseSession,
  recordCaseRun,
  caseEvidence,
} from "../packages/core/case-session";
import { template } from "../packages/core/templates";
import {
  load,
  primaryRecord,
  storageKeys,
  useStoragePort,
  type Store,
} from "../packages/core/storage";
import { workspaceWriter } from "../packages/core/workspace-writer";
import { createBackup, readBackup } from "../packages/core/workspace-backup";
import type { Report } from "../packages/workflow-engine";
const workflow = () => ({ ...template(), id: "workflow" });
const report = (id = "new-run"): Report => ({
  id,
  workflow: "Internet Connection",
  version: "1",
  date: "2026-11-07T13:20:00.000Z",
  demo: true,
  limitations: ["SIMULATED fixture; no real diagnostics"],
  steps: [
    {
      nodeId: "tcp",
      label: "TCP check",
      status: "failed",
      duration: 1,
      tested: "TCP connection · example.org:443",
      output: { ok: false, detail: "SIMULATED refusal" },
    },
    {
      nodeId: "http",
      label: "HTTP check",
      status: "inconclusive",
      duration: 1,
      tested: "HTTP HEAD · https://example.org",
      output: { detail: "SIMULATED unavailable" },
    },
  ],
});
const fixture = (): Store => ({
  version: 1,
  workflows: [workflow()],
  reports: [],
  targetProfiles: [],
  cases: [
    {
      id: "case",
      name: "Lab investigation",
      note: "Author note, not evidence",
      workflowIds: ["workflow"],
      runIds: ["expired"],
      archived: false,
      created: "2026-11-07T12:00:00.000Z",
      updated: "2026-11-07T12:00:00.000Z",
    },
  ],
});
test("explicit session captures identity, rejects switches/archival/missing links and recreated case IDs", () => {
  const store = fixture();
  const context = beginCaseSession(store, "case", "workflow");
  expect(context).toEqual({
    caseId: "case",
    caseCreated: store.cases![0].created,
    workflowId: "workflow",
  });
  expect(() => validateCaseSession(store, context, "unlike")).toThrow(
    /no longer valid/,
  );
  for (const change of [
    { archived: true },
    { workflowIds: [] },
    { created: "2026-11-07T13:00:00.000Z" },
  ]) {
    expect(() =>
      validateCaseSession(
        { ...store, cases: [{ ...store.cases![0], ...change }] },
        context,
        "workflow",
      ),
    ).toThrow(/no longer valid/);
  }
  expect(() => beginCaseSession(store, "unknown", "workflow")).toThrow();
  expect(() =>
    beginCaseSession({ ...store, workflows: [] }, "case", "workflow"),
  ).toThrow();
});
test("one immutable reducer adds report, origin and correct case link; backup and evidence remain honest", async () => {
  const before = fixture();
  const session = beginCaseSession(before, "case", "workflow");
  const next = recordCaseRun(before, before.workflows[0], report(), session);
  expect(before.reports).toEqual([]);
  expect(before.cases![0].runIds).toEqual(["expired"]);
  expect(next.reports[0].id).toBe("new-run");
  expect(next.runWorkflows).toEqual({ "new-run": "workflow" });
  expect(next.cases![0].runIds).toEqual(["new-run", "expired"]);
  expect((await readBackup(await createBackup(next))).store).toEqual(next);
  expect(caseEvidence(next, "case")).toMatchObject({
    available: 1,
    missing: 1,
    failed: 1,
    inconclusive: 1,
  });
  expect(caseEvidence(next, "case").latest?.demo).toBe(true);
});
test("case/workflow deletion, changed workflow content, unlinks and capacity fail without partial writes", () => {
  const store = fixture();
  const session = beginCaseSession(store, "case", "workflow");
  const variants: Store[] = [
    { ...store, cases: [] },
    { ...store, workflows: [] },
    {
      ...store,
      workflows: [{ ...store.workflows[0], name: "Reused identity" }],
    },
    { ...store, cases: [{ ...store.cases![0], workflowIds: [] }] },
    {
      ...store,
      cases: [
        {
          ...store.cases![0],
          runIds: Array.from({ length: 50 }, (_, i) => `old${i}`),
        },
      ],
    },
  ];
  for (const current of variants) {
    const raw = JSON.stringify(current);
    expect(() =>
      recordCaseRun(current, store.workflows[0], report(), session),
    ).toThrow();
    expect(JSON.stringify(current)).toBe(raw);
  }
  expect(() => beginCaseSession(variants[4], "case", "workflow")).toThrow(
    /50 run references/,
  );
});
test("global retention evicts reports/favorites/origins, never silently evicts case reference IDs", () => {
  const store = fixture();
  store.reports = Array.from({ length: 50 }, (_, i) => report(`old${i}`));
  store.favoriteRuns = ["old49"];
  store.runWorkflows = Object.fromEntries(
    store.reports.map((r) => [r.id, "workflow"]),
  );
  store.cases![0].runIds = ["old49"];
  const next = recordCaseRun(
    store,
    store.workflows[0],
    report(),
    beginCaseSession(store, "case", "workflow"),
  );
  expect(next.reports).toHaveLength(50);
  expect(next.reports.some((r) => r.id === "old49")).toBe(false);
  expect(next.cases![0].runIds).toEqual(["new-run", "old49"]);
  expect(next.favoriteRuns).toEqual([]);
  expect(next.runWorkflows?.old49).toBeUndefined();
  expect(caseEvidence(next, "case").missing).toBe(1);
});
test("outside-case and aborted/cancelled runs stay unlinked; collisions including missing refs cannot be reused", () => {
  const store = fixture();
  const session = beginCaseSession(store, "case", "workflow");
  expect(recordCaseRun(store, store.workflows[0], report()).cases).toEqual(
    store.cases,
  );
  expect(
    recordCaseRun(store, store.workflows[0], report(), session, true).cases,
  ).toEqual(store.cases);
  const cancelled = report();
  cancelled.steps[0].status = "cancelled";
  expect(
    recordCaseRun(store, store.workflows[0], cancelled, session).cases,
  ).toEqual(store.cases);
  expect(() =>
    recordCaseRun(store, store.workflows[0], report("expired"), session),
  ).toThrow(/collides/);
  for (const current of [
    { ...store, reports: [report()] },
    { ...store, runWorkflows: { "new-run": "other" } },
    { ...store, favoriteRuns: ["new-run"] },
  ])
    expect(() =>
      recordCaseRun(current, store.workflows[0], report(), session),
    ).toThrow(/collides/);
});
test("writer ACK fences the whole evidence update; rejection and mid-run validation publish no attachment", async () => {
  const store = fixture();
  const records = new Map<string, string>([
    [storageKeys.primary, JSON.stringify(store)],
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
  const session = beginCaseSession(store, "case", "workflow");
  const pending = writer.update((s) =>
    recordCaseRun(s, store.workflows[0], report(), session),
  );
  await vi.waitFor(() => expect(calls).toBe(2));
  expect(committed).not.toHaveBeenCalled();
  expect(load().cases![0].runIds[0]).toBe("new-run");
  release();
  await pending;
  expect(committed).toHaveBeenCalledTimes(1);
  expect(records.get(storageKeys.draft)).toBe("keep-journal");
  expect(records.get(storageKeys.quarantine)).toBe("keep-original");
  await writer.update((s) => ({ ...s, cases: [] }));
  const before = primaryRecord();
  await expect(
    writer.update((s) =>
      recordCaseRun(s, store.workflows[0], report("retry"), session),
    ),
  ).rejects.toThrow(/no longer valid/);
  expect(primaryRecord()).toBe(before);
  await writer.update((s) => ({ ...s, cases: store.cases }));
  let flushes = 0;
  const brokenCommitted = vi.fn();
  const broken = workspaceWriter({
    expected,
    committed: brokenCommitted,
    failed,
    pending: vi.fn(),
    flush: async () => {
      if (++flushes === 2) throw Error("Native ACK failure");
    },
  });
  await expect(
    broken.update((s) =>
      recordCaseRun(s, store.workflows[0], report("retry-bound"), session),
    ),
  ).rejects.toThrow("Native ACK failure");
  expect(brokenCommitted).not.toHaveBeenCalled();
  await expect(broken.idle()).rejects.toThrow("Native ACK failure");
});
