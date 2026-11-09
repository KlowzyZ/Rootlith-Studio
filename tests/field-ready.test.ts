import { expect, test, vi } from "vitest";
import {
  caseSchema,
  putCase,
  caseOverview,
  type InvestigationCase,
} from "../packages/core/cases";
import { workspaceWriter } from "../packages/core/workspace-writer";
import {
  load,
  loadWorkspace,
  save,
  stageDraft,
  draftRecord,
  primaryRecord,
  storageKeys,
  useStoragePort,
  type Store,
} from "../packages/core/storage";
import { template } from "../packages/core/templates";
import {
  comparisonExport,
  comparisonHTML,
} from "../packages/core/comparison-export";
import { saveExport } from "../apps/desktop/export-file";
import type { Report } from "../packages/workflow-engine";
const investigation = (): InvestigationCase => ({
  id: "case",
  name: "Workshop camera",
  note: "Intermittent connection",
  workflowIds: ["w"],
  runIds: ["a", "expired"],
  archived: false,
  created: "2026-11-07T12:00:00Z",
  updated: "2026-11-07T12:00:00Z",
  profileId: "camera",
});
const report = (id: string): Report => ({
  id,
  workflow: "Camera",
  version: "1",
  date: "2026-11-07T12:00:00Z",
  demo: false,
  limitations: [],
  steps: [
    {
      nodeId: "tcp",
      label: "Private camera",
      status: "failed",
      tested: "192.168.1.108:80",
      duration: 10,
      output: { detail: "Private device refused connection" },
    },
  ],
});
function fixture(
  initial: Store = {
    version: 1,
    workflows: [{ ...template(), id: "w" }],
    reports: [report("a")],
  },
) {
  const records = new Map<string, string>();
  useStoragePort({
    getItem: (k) => records.get(k) ?? null,
    setItem: (k, v) => {
      records.set(k, v);
    },
    removeItem: (k) => {
      records.delete(k);
    },
  });
  save(initial);
  const expected = { current: primaryRecord() },
    committed = vi.fn(),
    failed = vi.fn(),
    pending = vi.fn();
  return { records, expected, committed, failed, pending };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test("case metadata preserves stable IDs across history retention, clearing and workflow/profile deletion; old workspaces and recovery remain readable", async () => {
  const f = fixture(),
    c = investigation(),
    w = load().workflows[0];
  const writer = workspaceWriter({ ...f, flush: async () => {} });
  await writer.update((s) => ({ ...s, cases: putCase(s.cases || [], c) }));
  expect(load().workflows[0]).toEqual(w);
  expect(caseOverview(load().cases![0], load()).runs[1]).toEqual({
    id: "expired",
    report: undefined,
  });
  await writer.update((s) => ({
    ...s,
    reports: Array.from({ length: 50 }, (_, i) => report(`new${i}`)),
    workflows: [],
    targetProfiles: [],
  }));
  const overview = caseOverview(load().cases![0], load());
  expect(overview.latest).toBeUndefined();
  expect(overview.workflows[0].workflow).toBeUndefined();
  expect(overview.profile).toBeUndefined();
  expect(load().cases![0].runIds).toEqual(["a", "expired"]);
  await writer.update((s) => s, undefined, true);
  expect(load().reports).toEqual([]);
  expect(load().cases![0]).toEqual(c);
  expect(JSON.parse(f.records.get(storageKeys.backup)!).reports).toEqual([]);
  expect(caseSchema.safeParse({ ...c, note: "x".repeat(4001) }).success).toBe(
    false,
  );
  expect(() =>
    putCase(
      Array.from({ length: 80 }, (_, i) => ({ ...c, id: `c${i}` })),
      c,
    ),
  ).toThrow(/80/);
  expect(loadWorkspace().blocked).toBe(false);
  f.records.set(storageKeys.primary, "damaged");
  expect(loadWorkspace()).toMatchObject({
    blocked: true,
    store: { cases: [c] },
  });
});
test("durable acknowledgments serialize concurrent profile/favorite/case reducers and keep a newer draft; validation errors remain editable", async () => {
  const f = fixture(),
    first = gate(),
    seen: Store[] = [];
  const flush = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue(undefined);
  const writer = workspaceWriter({
    ...f,
    committed: (s) => {
      seen.push(s);
    },
    flush,
  });
  const w = load().workflows[0];
  stageDraft(w, f.expected.current);
  const raw = draftRecord();
  const profile = {
    id: "camera",
    name: "Camera",
    host: "192.168.1.108",
    port: "80",
    url: "http://192.168.1.108",
  };
  const a = writer.update((s) => ({ ...s, targetProfiles: [profile] }), {
    id: w.id,
    raw,
  });
  const b = writer.update((s) => ({ ...s, favoriteRuns: ["a"] }));
  const c = writer.update((s) => ({ ...s, cases: [investigation()] }));
  await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
  expect(seen).toEqual([]);
  const newer = { ...w, name: "Newer unsaved canvas" };
  stageDraft(newer, f.expected.current);
  first.resolve();
  await Promise.all([a, b, c]);
  await writer.idle();
  expect(seen.at(-1)).toMatchObject({
    targetProfiles: [profile],
    favoriteRuns: ["a"],
    cases: [investigation()],
  });
  expect(JSON.parse(draftRecord()!).workflow.name).toBe(newer.name);
  await expect(
    writer.update(() => {
      throw Error("Fix case name");
    }),
  ).rejects.toThrow("Fix case name");
  await writer.update((s) => ({
    ...s,
    cases: putCase(s.cases!, { ...s.cases![0], archived: true }),
  }));
  expect(load().cases![0].archived).toBe(true);
  expect(f.failed).not.toHaveBeenCalled();
});
test("failed native acknowledgment never publishes success or applies queued stale data; revision conflicts freeze writes and preserve journal", async () => {
  const f = fixture(),
    first = gate(),
    committed = vi.fn();
  const writer = workspaceWriter({
    ...f,
    committed,
    flush: async () => {
      await first.promise;
      throw Error("disk write failed");
    },
  });
  const a = writer.update((s) => ({ ...s, favoriteRuns: ["a"] }));
  const rejected = expect(a).rejects.toThrow("disk write failed");
  const b = writer.update((s) => ({ ...s, cases: [investigation()] }));
  const rejectedB = expect(b).rejects.toThrow("disk write failed");
  first.resolve();
  await Promise.all([rejected, rejectedB]);
  expect(committed).not.toHaveBeenCalled();
  expect(load().cases).toBeUndefined();
  await expect(writer.idle()).rejects.toThrow();
  const g = fixture(),
    writer2 = workspaceWriter({ ...g, flush: async () => {} });
  const w = load().workflows[0];
  stageDraft(w, g.expected.current);
  save({ ...load(), favoriteRuns: ["a"] }); // another writer, no React state involved
  await expect(
    writer2.update((s) => ({ ...s, cases: [investigation()] })),
  ).rejects.toThrow(/another window/);
  expect(load().cases).toBeUndefined();
  expect(draftRecord()).not.toBeNull();
  expect(g.committed).not.toHaveBeenCalled();
});
test("native Save boundary writes exact reviewed/redacted comparison bytes, honors cancel and rejects mismatched extensions and invalid payloads", async () => {
  const a = report("a"),
    b = report("b");
  b.steps[0].status = "passed";
  const redacted = comparisonExport(a, b, { a: "w", b: "w" }),
    sensitive = comparisonExport(a, b, { a: "w", b: "w" }, true);
  const write = vi.fn().mockResolvedValue(undefined),
    choose = vi
      .fn()
      .mockResolvedValue({ canceled: true, filePath: "/tmp/ignored.json" });
  const json = JSON.stringify(redacted);
  expect(
    await saveExport(
      { name: "comparison.json", content: json, type: "application/json" },
      choose,
      write,
    ),
  ).toBe(false);
  expect(write).not.toHaveBeenCalled();
  choose.mockResolvedValue({
    canceled: false,
    filePath: "/tmp/comparison.json",
  });
  expect(
    await saveExport(
      { name: "comparison.json", content: json, type: "application/json" },
      choose,
      write,
    ),
  ).toBe(true);
  expect(write).toHaveBeenLastCalledWith("/tmp/comparison.json", json);
  expect(json).not.toContain("192.168.1.108");
  choose.mockResolvedValue({
    canceled: false,
    filePath: "/tmp/comparison.html",
  });
  const html = comparisonHTML(sensitive);
  await saveExport(
    { name: "comparison.html", content: html, type: "text/html" },
    choose,
    write,
  );
  expect(write).toHaveBeenLastCalledWith("/tmp/comparison.html", html);
  expect(html).toContain("192.168.1.108");
  await expect(
    saveExport(
      { name: "comparison.json", content: json, type: "application/json" },
      choose,
      write,
    ),
  ).rejects.toThrow(/matching export extension/);
  await expect(
    saveExport(
      { name: "../escape.json", content: json, type: "application/json" },
      choose,
      write,
    ),
  ).rejects.toThrow();
});
