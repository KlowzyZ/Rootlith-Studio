import { beforeEach, it, expect, vi } from "vitest";
import {
  loadWorkspace,
  clearRunHistory,
  load,
  save,
  stageDraft,
  restoreBackup,
  recoveryExport,
  storageKeys,
} from "../packages/core/storage";
import { template } from "../packages/core/templates";
let data: Map<string, string>;
let denyKey: string | undefined;
beforeEach(() => {
  data = new Map();
  denyKey = undefined;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k === denyKey) throw Error("Quota exceeded");
      data.set(k, v);
    },
    removeItem: (k: string) => data.delete(k),
  });
});
const store = () => ({
  version: 1 as const,
  workflows: [template()],
  reports: [],
});
it("recovers last-good storage without overwriting damaged data", () => {
  const first = store();
  save(first);
  save(store());
  data.set(storageKeys.primary, "{broken");
  const recovered = loadWorkspace();
  expect(recovered.blocked).toBe(true);
  expect(recovered.store).toEqual(first);
  expect(data.get(storageKeys.primary)).toBe("{broken");
  restoreBackup();
  expect(load()).toEqual(first);
  expect(JSON.parse(recoveryExport()).quarantine).toBe("{broken");
});
it("recovers unfinished canvas edits, including an incomplete graph", () => {
  save(store());
  const draft = { ...template(), name: "", nodes: [] };
  stageDraft(draft);
  expect(loadWorkspace().draft).toEqual(draft);
  expect(load().workflows[0].name).not.toBe("");
});
it("preserves primary on quota errors and refuses stale writes or corrupt backups", () => {
  const first = store();
  save(first);
  const expected = data.get(storageKeys.primary)!;
  denyKey = storageKeys.backup;
  expect(() => save(store(), expected)).toThrow("Quota");
  expect(load()).toEqual(first);
  denyKey = undefined;
  save(store());
  expect(() => save(first, expected)).toThrow("another window");
  data.set(storageKeys.backup, "not json");
  const before = data.get(storageKeys.primary);
  expect(() => restoreBackup()).toThrow();
  expect(data.get(storageKeys.primary)).toBe(before);
});

it("clears report evidence from both primary and last-good backup", () => {
  const first = store();
  const report = {
    id: "test",
    workflow: "private-host",
    version: "1",
    date: new Date().toISOString(),
    demo: false,
    steps: [],
    limitations: [],
  };
  const withReport = { ...first, reports: [report] };
  save(withReport);
  save(withReport);
  clearRunHistory(withReport, data.get(storageKeys.primary));
  expect(load().reports).toEqual([]);
  expect(data.get(storageKeys.primary)).not.toContain("private-host");
  expect(data.get(storageKeys.backup)).not.toContain("private-host");
});
