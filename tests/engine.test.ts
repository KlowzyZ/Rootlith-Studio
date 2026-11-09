import { describe, it, expect } from "vitest";
import { template } from "../packages/core/templates";
import { parseWorkflow, validate } from "../packages/schemas";
import { execute } from "../packages/workflow-engine";
import { reportHTML, redactedReport } from "../packages/core/reports";
describe("untrusted workflow boundary", () => {
  it("round trips and rejects unknown capabilities, versions and oversize imports", () => {
    const w = template();
    expect(parseWorkflow(JSON.stringify(w))).toEqual(w);
    expect(() =>
      parseWorkflow(JSON.stringify({ ...w, schemaVersion: 2 })),
    ).toThrow();
    expect(() =>
      parseWorkflow(JSON.stringify({ ...w, script: "process.exit()" })),
    ).toThrow();
    expect(() => parseWorkflow(" ".repeat(512001))).toThrow();
    expect(() =>
      parseWorkflow(
        JSON.stringify({ ...w, nodes: [{ ...w.nodes[0], kind: "shell" }] }),
      ),
    ).toThrow();
  });
  it("rejects cycles, duplicate IDs, incomplete branches and credential URLs", () => {
    const w = template();
    expect(validate(w)).toEqual([]);
    expect(
      validate({
        ...w,
        edges: [...w.edges, { id: "cycle", source: "end", target: "start" }],
      }),
    ).toContain("Cycles are not supported.");
    expect(validate({ ...w, nodes: [...w.nodes, w.nodes[0]] })).toContain(
      "Node identifiers must be unique.",
    );
    expect(
      validate({ ...w, edges: w.edges.filter((e) => e.branch !== "false") }),
    ).toContain("Are you connected?: connect each branch exactly once.");
    const http = w.nodes.find((n) => n.kind === "http")!;
    http.config.url = "https://user:password@example.com";
    expect(validate(w).join()).toContain("without credentials");
  });
});
describe("path execution", () => {
  it("branches on typed failed evidence and skips unvisited network checks", async () => {
    const visited: string[] = [];
    const r = await execute(
      template(),
      async (n) => {
        visited.push(n.kind);
        return { ok: false, detail: "failure" };
      },
      async () => true,
      new AbortController().signal,
      () => {},
    );
    expect(visited).toEqual(["interfaces", "dns"]);
    expect(r.steps.find((s) => s.nodeId === "tcp")?.status).toBe("skipped");
    expect(r.steps.find((s) => s.nodeId === "guidance")?.status).toBe("passed");
  });
  it("stops on unavailable condition evidence", async () => {
    const r = await execute(
      template(),
      async () => ({ detail: "Unavailable" }),
      async () => true,
      new AbortController().signal,
      () => {},
    );
    expect(r.steps.find((s) => s.nodeId === "condition")?.status).toBe(
      "inconclusive",
    );
    expect(r.steps.find((s) => s.nodeId === "tcp")?.status).toBe("skipped");
  });
  it("cancels a bounded run and produces a safe offline report", async () => {
    const c = new AbortController();
    const r = await execute(
      template(),
      async () => {
        c.abort();
        throw Error("Cancelled");
      },
      async () => true,
      c.signal,
      () => {},
    );
    expect(r.steps.some((s) => s.status === "cancelled")).toBe(true);
    r.workflow = "<script>alert(1)</script>";
    expect(reportHTML(r)).not.toContain("<script>");
    expect(redactedReport(r).workflow).toBe("[redacted workflow]");
  });
});

it("normalizes declared capabilities against actual nodes", () => {
  const w = template();
  const imported = parseWorkflow(
    JSON.stringify({ ...w, requiredCapabilities: [] }),
  );
  expect(imported.requiredCapabilities.sort()).toEqual([
    "dns",
    "http",
    "interfaces",
    "tcp",
  ]);
});

it("preserves workflows when storage reaches its explicit limit", async () => {
  const { putWorkflow } = await import("../packages/core/storage");
  const existing = Array.from({ length: 100 }, (_, i) => ({
    ...template(),
    id: `flow-${i}`,
  }));
  expect(() => putWorkflow(existing, template())).toThrow(
    "Existing workflows were preserved",
  );
  expect(existing).toHaveLength(100);
  expect(
    putWorkflow(existing, { ...existing[0], name: "Updated" }),
  ).toHaveLength(100);
});

it("does not select a branch when a question fails or returns an unsupported answer", async () => {
  for (const ask of [
    async () => {
      throw Error("UI unavailable");
    },
    async () => "invalid answer",
  ]) {
    const visited: string[] = [];
    const r = await execute(
      template(),
      async (n) => {
        visited.push(n.kind);
        return { ok: true, detail: "Evidence" };
      },
      ask,
      new AbortController().signal,
      () => {},
    );
    expect(visited).toEqual(["interfaces"]);
    expect(r.steps.find((s) => s.nodeId === "question")?.status).toBe(
      "inconclusive",
    );
    expect(r.steps.find((s) => s.nodeId === "dns")?.status).toBe("skipped");
  }
});

it("rejects occupied outputs and cycles while allowing reconnection of the existing edge", async () => {
  const { connectionError } = await import("../packages/schemas");
  const w = template();
  expect(
    connectionError(w, {
      source: "question",
      target: "guidance",
      sourceHandle: "true",
    }),
  ).toContain("already connected");
  expect(
    connectionError(
      w,
      { source: "question", target: "guidance", sourceHandle: "true" },
      "e2",
    ),
  ).toBeUndefined();
  expect(connectionError(w, { source: "tcp", target: "dns" }, "e7")).toContain(
    "Cycles",
  );
  expect(connectionError(w, { source: "end", target: "dns" })).toContain(
    "not supported",
  );
});
