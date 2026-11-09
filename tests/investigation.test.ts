import { expect, test } from "vitest";
import { quickTarget, duplicateWorkflow } from "../packages/core/quick-target";
import { template } from "../packages/core/templates";
import { execute } from "../packages/workflow-engine";
import { redactedReport, reportHTML } from "../packages/core/reports";
import { storeSchema } from "../packages/core/storage";
test("target preview preserves paths, settings and source; copies have separate identity", () => {
  const source = template();
  source.nodes.find((n) => n.kind === "http")!.config.url =
    "https://example.com/health%20check";
  const original = structuredClone(source);
  const result = quickTarget(source, {
    host: "internal.example",
    port: "8443",
    url: "https://internal.example:8443",
  });
  expect(result.changes).toHaveLength(3);
  expect(result.workflow.nodes.find((n) => n.kind === "http")!.config).toEqual({
    timeout: 3000,
    url: "https://internal.example:8443/health%20check",
  });
  expect(source).toEqual(original);
  expect(quickTarget(source, { host: "", port: "", url: "" }).changes).toEqual(
    [],
  );
  const copy = duplicateWorkflow(source);
  expect(copy.id).not.toBe(source.id);
  expect(copy.nodes).toEqual(source.nodes);
  copy.nodes[0].label = "Changed";
  expect(source).toEqual(original);
});
test("rejects unsafe or invalid target input without partial edits", () => {
  for (const input of [
    { host: "https://bad/", port: "", url: "" },
    { host: "", port: "1e3", url: "" },
    { host: "", port: "65536", url: "" },
    ...[
      "file:///a",
      "https://u:p@example.com",
      "https://example.com/path",
      "https://example.com/?secret=1",
      "https://example.com/#x",
    ].map((url) => ({ host: "", port: "", url })),
  ]) {
    expect(() => quickTarget(template(), input)).toThrow();
  }
});
test("chronological native evidence survives storage and is withheld on export", async () => {
  const workflow = template("local");
  const report = await execute(
    workflow,
    async (n) =>
      n.kind === "tcp"
        ? { ok: true, detail: "TCP accepted" }
        : { ok: false, status: 503, detail: "HTTP 503" },
    async () => true,
    new AbortController().signal,
    () => {},
  );
  expect(report.steps.map((s) => s.nodeId)).toEqual([
    "start",
    "tcp",
    "condition",
    "http",
    "end",
    "guidance",
  ]);
  expect(report.steps.find((s) => s.nodeId === "http")).toMatchObject({
    status: "failed",
    tested: "HTTP HEAD · http://localhost:3000 · redirects not followed",
  });
  expect(
    storeSchema.parse({ version: 1, workflows: [workflow], reports: [report] })
      .reports[0],
  ).toEqual(report);
  expect(JSON.stringify(redactedReport(report))).not.toContain("localhost");
  expect(reportHTML(redactedReport(report))).not.toContain("localhost");
});
test("unavailable evidence and cancellation remain distinct from failure", async () => {
  const controller = new AbortController();
  const report = await execute(
    template("local"),
    async () => {
      throw Error("Unavailable");
    },
    async () => true,
    controller.signal,
    () => {},
  );
  expect(report.steps.find((s) => s.nodeId === "tcp")!.status).toBe(
    "inconclusive",
  );
  const cancelled = await execute(
    template("local"),
    async () => {
      controller.abort();
      throw Error("Cancelled");
    },
    async () => true,
    controller.signal,
    () => {},
  );
  expect(cancelled.steps.find((s) => s.nodeId === "tcp")!.status).toBe(
    "cancelled",
  );
  expect(cancelled.steps.find((s) => s.nodeId === "http")).toMatchObject({
    status: "cancelled",
    duration: 0,
  });
});
