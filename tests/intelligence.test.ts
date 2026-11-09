import { expect, test } from "vitest";
import { compareSteps, comparisonScope } from "../packages/core/comparison";
import { arrangeWorkflow } from "../packages/core/arrange";
import { starter, starters } from "../packages/core/starters";
import { template } from "../packages/core/templates";
import { quickTarget } from "../packages/core/quick-target";
import {
  storeSchema,
  clearRunHistory,
  useStoragePort,
  storageKeys,
} from "../packages/core/storage";
import { validate, workflowSchema } from "../packages/schemas";
import type { Report } from "../packages/workflow-engine";
const run = (id: string): Report => ({
  id,
  workflow: "Service",
  version: "1",
  date: "2026-11-06T10:00:00Z",
  demo: false,
  limitations: [],
  steps: [
    {
      nodeId: "http",
      label: "HTTP",
      tested: "HTTP HEAD · http://localhost:8080/health",
      status: "failed",
      duration: 25,
      output: { ok: false, status: 503, detail: "HTTP 503" },
    },
  ],
});
test("comparison matches stable IDs, retains both sides and handles target and identity gaps", () => {
  const a = run("a"),
    b = run("b");
  b.steps[0] = {
    ...b.steps[0],
    label: "Renamed check",
    status: "passed",
    duration: 10,
    output: { ok: true, status: 200, detail: "HTTP 200" },
  };
  expect(compareSteps(a, b)[0]).toMatchObject({
    nodeId: "http",
    classification: "Improvement",
    evidenceChanged: true,
    durationDelta: -15,
  });
  expect(compareSteps(b, a)[0].classification).toBe("Regression");
  delete b.steps[0].tested;
  expect(compareSteps(a, b)[0]).toMatchObject({
    classification: "Status changed",
    target: "unavailable",
  });
  b.steps[0].tested = "HTTP HEAD · http://other/";
  expect(compareSteps(a, b)[0].target).toBe("changed");
  b.steps[0].nodeId = "replacement";
  expect(compareSteps(a, b).map((row) => row.classification)).toEqual([
    "Only in baseline",
    "Only in follow-up",
  ]);
  expect(compareSteps(a, b)[0].durationDelta).toBeUndefined();
  expect(comparisonScope(a, b)).toBe("legacy");
  expect(comparisonScope(a, b, { a: "original", b: "copy" })).toContain(
    "different workflow identities",
  );
  b.workflow = "Renamed workflow";
  expect(comparisonScope(a, b, { a: "original", b: "original" })).toBe(
    "verified",
  );
  b.demo = true;
  expect(comparisonScope(a, b, { a: "original", b: "original" })).toContain(
    "Simulated and native",
  );
});
test("arrangement keeps graph semantics, handles boolean/choice branches and rejects cycles", () => {
  const w = starter("camera"),
    original = structuredClone(w);
  const arranged = arrangeWorkflow({
    ...w,
    nodes: w.nodes.map((n) => ({ ...n, position: { x: 10, y: 10 } })),
  });
  expect(arranged.nodes.map(({ position: _position, ...n }) => n)).toEqual(
    w.nodes.map(({ position: _position, ...n }) => n),
  );
  expect(arranged.edges).toEqual(w.edges);
  expect(w).toEqual(original);
  expect(
    new Set(arranged.nodes.map((n) => JSON.stringify(n.position))).size,
  ).toBe(w.nodes.length);
  for (const edge of w.edges)
    expect(
      arranged.nodes.find((n) => n.id === edge.source)!.position.y,
    ).toBeLessThan(
      arranged.nodes.find((n) => n.id === edge.target)!.position.y,
    );
  expect(arrangeWorkflow(arranged)).toEqual(arranged);
  expect(() =>
    arrangeWorkflow({
      ...w,
      edges: [...w.edges, { id: "cycle", source: "end", target: "start" }],
    }),
  ).toThrow(/cycles/);
});
test("original starters require user targets and become valid through Quick Target Setup", () => {
  for (const entry of starters) {
    const raw = starter(entry.key);
    workflowSchema.parse(raw);
    expect(validate(raw).length).toBeGreaterThan(0);
    expect(
      raw.nodes
        .filter((n) => ["dns", "tcp", "http"].includes(n.kind))
        .every((n) => !n.config.host && !n.config.port && !n.config.url),
    ).toBe(true);
    const configured = quickTarget(raw, {
      host: "127.0.0.1",
      port: "8080",
      url: "http://127.0.0.1:8080",
    }).workflow;
    expect(validate(configured)).toEqual([]);
    expect(configured.nodes.find((n) => n.kind === "http")!.config.url).toBe(
      "http://127.0.0.1:8080/",
    );
  }
});
test("workspace origins are optional, report schema/history are retained, clearing also clears backup origins", () => {
  const legacy = {
    version: 1 as const,
    workflows: [template()],
    reports: [run("a")],
  };
  expect(storeSchema.parse(legacy)).toEqual(legacy);
  const current = { ...legacy, runWorkflows: { a: legacy.workflows[0].id } };
  expect(storeSchema.parse(current).reports).toEqual(legacy.reports);
  const records = new Map([
    [storageKeys.primary, JSON.stringify(current)],
    [storageKeys.backup, JSON.stringify(current)],
  ]);
  useStoragePort({
    getItem: (key) => records.get(key as typeof storageKeys.primary) ?? null,
    setItem: (key, value) => {
      records.set(key as typeof storageKeys.primary, value);
    },
    removeItem: (key) => {
      records.delete(key as typeof storageKeys.primary);
    },
  });
  clearRunHistory(current);
  for (const key of [storageKeys.primary, storageKeys.backup])
    expect(JSON.parse(records.get(key)!).runWorkflows).toEqual({});
});
