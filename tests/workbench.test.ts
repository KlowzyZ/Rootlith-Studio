import { expect, test } from "vitest";
import { profileSchema, putProfile } from "../packages/core/profiles";
import { quickTarget } from "../packages/core/quick-target";
import { starter } from "../packages/core/starters";
import {
  save,
  load,
  primaryRecord,
  clearRunHistory,
  useStoragePort,
  storageKeys,
  storeSchema,
} from "../packages/core/storage";
import {
  validateRecords,
  emptyRecords,
} from "../packages/core/native-contract";
import {
  comparisonExport,
  comparisonHTML,
} from "../packages/core/comparison-export";
import { filterHistory, retainedFavorites } from "../packages/core/history";
import type { Report } from "../packages/workflow-engine";
const report = (id: string): Report => ({
  id,
  workflow: "Private camera",
  version: "1",
  date: "2026-11-07T12:00:00Z",
  demo: true,
  limitations: ["private-host"],
  steps: [
    {
      nodeId: "http",
      label: "Camera health",
      tested: "http://private-host/health",
      status: "failed",
      duration: 20,
      output: { detail: "secret evidence", status: 503 },
    },
  ],
});
test("profiles round-trip through workspace/native validation and preserve concrete workflow isolation and revision protection", () => {
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
  const w = starter("service"),
    before = structuredClone(w);
  const p = {
    id: "camera",
    name: "Workshop camera",
    host: "192.168.1.108",
    port: "80",
    url: "http://192.168.1.108",
  };
  w.nodes
    .filter((n) => n.kind === "http")
    .forEach((n) => {
      n.config.url = "http://localhost/health";
    });
  const profiles = putProfile([], p);
  save({ version: 1, workflows: [w], reports: [], targetProfiles: profiles });
  expect(load().targetProfiles).toEqual(profiles);
  const native = emptyRecords();
  native[storageKeys.primary] = primaryRecord();
  expect(validateRecords(native)[storageKeys.primary]).toContain(
    "Workshop camera",
  );
  const changed = quickTarget(w, p);
  expect(changed.changes.length).toBeGreaterThan(0);
  expect(
    changed.workflow.nodes.find((n) => n.kind === "http")?.config.url,
  ).toBe("http://192.168.1.108/health");
  expect(load().workflows[0]).toEqual(w);
  putProfile(profiles, { ...p, host: "different.example" });
  expect(load().workflows[0]).toEqual(w);
  expect(before.id).toBe(w.id);
  expect(() => save(load(), "stale")).toThrow(/another window/);
  for (const invalid of [
    { url: "http://user:password@localhost" },
    { url: "https://host/?key=secret" },
    { host: "bad/host" },
    { port: "65536" },
    { name: "x".repeat(81) },
  ])
    expect(profileSchema.safeParse({ ...p, ...invalid }).success).toBe(false);
  expect(() =>
    putProfile(
      Array.from({ length: 40 }, (_, i) => ({ ...p, id: `p${i}` })),
      p,
    ),
  ).toThrow(/40/);
  expect(
    storeSchema.parse({ version: 1, workflows: [], reports: [] })
      .targetProfiles,
  ).toBeUndefined();
});
test("comparison exports preserve matching before redaction, reject missing acknowledgment, escape offline HTML and leave originals intact", () => {
  const a = report("a"),
    b = report("b"),
    original = structuredClone(a);
  b.steps[0] = {
    ...b.steps[0],
    status: "passed",
    duration: 10,
    output: { detail: '<img src=x onerror="alert(1)">', status: 200 },
  };
  const origins = { a: "workflow", b: "workflow" };
  const value = comparisonExport(a, b, origins);
  expect(value.summary).toEqual({
    improvements: 1,
    regressions: 0,
    unchanged: 0,
  });
  expect(value.nodes[0]).toMatchObject({
    target: "same",
    durationDelta: -10,
    evidenceChanged: true,
  });
  expect(JSON.stringify(value)).not.toMatch(
    /private-host|Camera health|secret evidence|<img/,
  );
  const html = comparisonHTML(comparisonExport(a, b, origins, true));
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img");
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("Correlation does not establish root cause");
  expect(html).toContain("Baseline");
  expect(html).toContain("Follow-up");
  expect(html).toContain("SIMULATED DEMO");
  expect(() => comparisonExport(a, b, {})).toThrow(/acknowledgment/);
  expect(comparisonExport(a, b, {}, false, true).workflowIdentity).toContain(
    "Unverified",
  );
  b.steps[0].tested = "different";
  expect(comparisonExport(a, b, origins).summary.improvements).toBe(0);
  delete b.steps[0].tested;
  expect(comparisonExport(a, b, origins).nodes[0].target).toBe("unavailable");
  b.demo = false;
  expect(() => comparisonExport(a, b, origins)).toThrow();
  expect(a).toEqual(original);
});
test("history searches labels, filters step status/mode/favorites and sorts without mutating reports; clearing sanitizes backup metadata", () => {
  const a = report("a"),
    b = { ...report("b"), demo: false, date: "2026-11-08T12:00:00Z" };
  const filter = {
    search: "health",
    mode: "all",
    status: "failed",
    order: "oldest",
    favoritesOnly: false,
  };
  expect(filterHistory([b, a], [], filter).map((r) => r.id)).toEqual([
    "a",
    "b",
  ]);
  expect(
    filterHistory([a, b], ["b"], {
      ...filter,
      mode: "native",
      favoritesOnly: true,
    }),
  ).toEqual([b]);
  expect(filterHistory([a, b], [], { ...filter, status: "passed" })).toEqual(
    [],
  );
  expect(retainedFavorites([a], ["a", "a", "obsolete"])).toEqual(["a"]);
  const data = new Map<string, string>();
  useStoragePort({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  });
  const store = {
    version: 1 as const,
    workflows: [],
    reports: [a, b],
    favoriteRuns: ["a"],
    runWorkflows: { a: "w", b: "w" },
  };
  save(store);
  save(store);
  const cleared = clearRunHistory(store, primaryRecord());
  expect(cleared.favoriteRuns).toEqual([]);
  expect(JSON.parse(data.get(storageKeys.backup)!)).toMatchObject({
    reports: [],
    favoriteRuns: [],
    runWorkflows: {},
  });
});
