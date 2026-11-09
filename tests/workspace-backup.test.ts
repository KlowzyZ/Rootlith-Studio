import { expect, test, vi } from "vitest";
import {
  applyImport,
  backupWarning,
  canonical,
  createBackup,
  MAX_BACKUP_BYTES,
  planImport,
  readBackup,
} from "../packages/core/workspace-backup";
import { template } from "../packages/core/templates";
import {
  load,
  primaryRecord,
  storageKeys,
  useStoragePort,
  type Store,
} from "../packages/core/storage";
import { workspaceWriter } from "../packages/core/workspace-writer";
const empty = (): Store => ({ version: 1, workflows: [], reports: [] });
const source = (): Store => ({
  ...empty(),
  workflows: [{ ...template(), id: "workflow" }],
});
test("deterministic SHA-256 roundtrip, UTC metadata and privacy warning", async () => {
  const text = await createBackup(source(), "2026-11-07T12:00:00.000Z");
  expect((await readBackup(text)).store).toEqual(source());
  expect(await createBackup(source(), "2026-11-07T12:00:00.000Z")).toBe(text);
  expect(canonical({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  expect(backupWarning).toMatch(/Not encrypted or redacted/);
});
test("rejects damage, versions, unknown fields, oversized and duplicate records", async () => {
  const text = await createBackup(source());
  await expect(
    readBackup(text.replace("Internet Connection", "Changed name")),
  ).rejects.toThrow(/integrity/);
  await expect(
    readBackup(text.replace('"version":1', '"version":99')),
  ).rejects.toThrow();
  await expect(readBackup("{malformed")).rejects.toThrow();
  await expect(readBackup(" ".repeat(MAX_BACKUP_BYTES + 1))).rejects.toThrow(
    /2 MiB/,
  );
  await expect(
    createBackup({
      ...source(),
      workflows: [
        { ...template(), id: "same" },
        { ...template(), id: "same" },
      ],
    }),
  ).rejects.toThrow(/Duplicate/);
  const raw = JSON.parse(text);
  raw.extra = true;
  await expect(readBackup(JSON.stringify(raw))).rejects.toThrow();
  const bad = source();
  Object.assign(bad.workflows[0], { script: "no" });
  // Import parsing rejects unknown fields before any mutation.
  raw.payload.workspace = bad;
  await expect(readBackup(JSON.stringify(raw))).rejects.toThrow();
});
test("conflicts retain locals, safe cases keep missing refs, ambiguous cases skipped", () => {
  const local = source();
  const incoming = source();
  incoming.workflows[0].name = "Other";
  incoming.cases = [
    {
      id: "case",
      name: "Investigation",
      note: "",
      workflowIds: ["workflow"],
      runIds: [],
      archived: false,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
  ];
  const plan = planImport(local, incoming);
  expect(plan.next.workflows).toEqual(local.workflows);
  expect(plan.rows.filter((r) => r.action === "conflict")).toHaveLength(2);
  incoming.cases[0].workflowIds = ["absent"];
  const missing = planImport(local, incoming);
  expect(missing.next.cases).toHaveLength(1);
  expect(missing.missing[0]).toContain("absent");
  expect(() =>
    applyImport({ ...local, favoriteRuns: [] }, incoming, plan.baseline),
  ).toThrow(/changed since preview/);
});
test("capacity rejects whole plan; duplicate runs cannot change favorites or origins", () => {
  const local = {
    ...empty(),
    workflows: Array.from({ length: 100 }, (_, i) => ({
      ...template(),
      id: `w${i}`,
    })),
  };
  expect(planImport(local, source()).error).toMatch(/capacity/);
  const run = {
    id: "r",
    workflow: "name",
    version: "1",
    date: new Date().toISOString(),
    demo: true,
    limitations: [],
    steps: [],
  };
  const current: Store = {
    ...source(),
    reports: [run],
    favoriteRuns: [],
    runWorkflows: { r: "local" },
  };
  const incoming: Store = {
    ...source(),
    reports: [run],
    favoriteRuns: ["r"],
    runWorkflows: { r: template().id },
  };
  const next = planImport(current, incoming).next;
  expect(next.favoriteRuns).toEqual([]);
  expect(next.runWorkflows).toEqual({ r: "local" });
});
test("writer validates before mutation, retains journals, waits for ACK and freezes on failed ACK", async () => {
  const records = new Map<string, string>([
    [storageKeys.primary, JSON.stringify(empty())],
    [storageKeys.draft, "journal"],
    [storageKeys.quarantine, "original"],
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
  const expected = { current: primaryRecord() };
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const committed = vi.fn(),
    failed = vi.fn();
  let calls = 0;
  const writer = workspaceWriter({
    expected,
    flush: async () => {
      if (++calls === 2) await gate;
    },
    committed,
    pending: vi.fn(),
    failed,
  });
  const plan = planImport(load(), source());
  const pending = writer.update((s) => applyImport(s, source(), plan.baseline));
  await vi.waitFor(() => expect(calls).toBe(2));
  expect(committed).not.toHaveBeenCalled();
  release();
  await pending;
  expect(committed).toHaveBeenCalledTimes(1);
  expect(records.get(storageKeys.draft)).toBe("journal");
  expect(records.get(storageKeys.quarantine)).toBe("original");
  const before = primaryRecord();
  await expect(
    writer.update((s) => applyImport(s, source(), "stale")),
  ).rejects.toThrow(/changed/);
  expect(primaryRecord()).toBe(before);
  const broken = workspaceWriter({
    expected,
    flush: async () => {
      throw Error("disk failure");
    },
    committed,
    pending: vi.fn(),
    failed,
  });
  await expect(broken.update((s) => s)).rejects.toThrow("disk failure");
  await expect(broken.update((s) => s)).rejects.toThrow("disk failure");
  expect(primaryRecord()).toBe(before);
});

test("all portable record types roundtrip and retain linked new-run metadata", async () => {
  const store = source();
  store.targetProfiles = [
    {
      id: "device",
      name: "Lab device",
      host: "example.org",
      port: "443",
      url: "https://example.org",
    },
  ];
  store.reports = [
    {
      id: "run",
      workflow: "Internet Connection",
      version: "1",
      date: new Date().toISOString(),
      demo: true,
      limitations: ["SIMULATED: no real checks"],
      steps: [],
    },
  ];
  store.favoriteRuns = ["run"];
  store.runWorkflows = { run: "workflow" };
  store.cases = [
    {
      id: "case",
      name: "Lab investigation",
      note: "Sensitive notes",
      profileId: "device",
      workflowIds: ["workflow"],
      runIds: ["run", "expired"],
      archived: false,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
  ];
  const parsed = await readBackup(await createBackup(store));
  expect(parsed.store).toEqual(store);
  const plan = planImport(empty(), parsed.store);
  expect(plan.error).toBe("");
  expect(plan.next).toEqual(store);
  expect(plan.missing).toEqual(["Case case: missing reports expired"]);
  const local = { ...empty(), cases: store.cases };
  expect(planImport(local, store).error).toMatch(/missing local reference/);
});

test("failed native acknowledgment never commits import to visible state", async () => {
  const records = new Map<string, string>([
    [storageKeys.primary, JSON.stringify(empty())],
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
  let calls = 0;
  const committed = vi.fn();
  const failed = vi.fn();
  const writer = workspaceWriter({
    expected: { current: primaryRecord() },
    flush: async () => {
      if (++calls > 1) throw Error("Native ACK rejected");
    },
    committed,
    failed,
    pending: vi.fn(),
  });
  const plan = planImport(load(), source());
  await expect(
    writer.update((s) => applyImport(s, source(), plan.baseline)),
  ).rejects.toThrow("Native ACK rejected");
  expect(committed).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledTimes(1);
  await expect(writer.idle()).rejects.toThrow("Native ACK rejected");
});

test("equal report bodies with unlike origins cannot relink an incoming case", () => {
  const incoming = source();
  incoming.reports = [
    {
      id: "same-run",
      workflow: "name",
      version: "1",
      date: new Date().toISOString(),
      demo: true,
      limitations: [],
      steps: [],
    },
  ];
  incoming.runWorkflows = { "same-run": "workflow" };
  incoming.cases = [
    {
      id: "new-case",
      name: "Case",
      note: "",
      workflowIds: [],
      runIds: ["same-run"],
      archived: false,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
  ];
  const local: Store = {
    ...source(),
    reports: incoming.reports,
    runWorkflows: { "same-run": "different-workflow" },
  };
  const plan = planImport(local, incoming);
  expect(plan.next.cases).toEqual([]);
  expect(plan.rows.find((r) => r.type === "cases")?.action).toBe("conflict");
});


test("new report does not import a case when its workflow origin conflicts with local identity", () => {
  const current = source();
  const incoming = source();
  incoming.workflows[0].name = "Unlike workflow with reused ID";
  incoming.reports = [{
    id: "new-run",
    workflow: "Unlike workflow with reused ID",
    version: "1",
    date: "2026-11-07T13:00:00.000Z",
    demo: true,
    limitations: [],
    steps: [],
  }];
  incoming.runWorkflows = { "new-run": "workflow" };
  incoming.cases = [{
    id: "case-from-other-device",
    name: "Imported case",
    note: "",
    workflowIds: [],
    runIds: ["new-run"],
    archived: false,
    created: "2026-11-07T13:00:00.000Z",
    updated: "2026-11-07T13:00:00.000Z",
  }];
  const plan = planImport(current, incoming);
  expect(plan.next.reports.map((r) => r.id)).toEqual(["new-run"]);
  expect(plan.next.runWorkflows).toEqual({});
  expect(plan.next.cases || []).toEqual([]);
  expect(plan.rows.find((r) => r.type === "cases")?.action).toBe("conflict");
});
