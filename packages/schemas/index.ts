import { z } from "zod";
export const kinds = [
  "start",
  "end",
  "instruction",
  "question",
  "condition",
  "result",
  "interfaces",
  "dns",
  "tcp",
  "http",
  "choice",
  "confirmation",
] as const;
export const diagnosticKinds = ["interfaces", "dns", "tcp", "http"];
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const nodeSchema = z
  .object({
    id,
    kind: z.enum(kinds),
    label: z.string().min(1).max(120),
    description: z.string().max(2000).default(""),
    position: z.object({
      x: z.number().finite().min(-10000).max(10000),
      y: z.number().finite().min(-10000).max(10000),
    }),
    config: z
      .object({
        host: z.string().max(253).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        url: z.string().max(2048).optional(),
        timeout: z.number().int().min(100).max(10000).default(3000),
        choices: z.array(z.string().min(1).max(80)).min(2).max(8).optional(),
        source: id.optional(),
        field: z.enum(["ok", "status", "answer"]).optional(),
        operator: z.enum(["equals", "notEquals"]).optional(),
        value: z
          .union([z.string().max(80), z.boolean(), z.number().finite()])
          .optional(),
      })
      .strict(),
  })
  .strict();
export const workflowSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name: z.string().min(1).max(120),
    version: z.string().max(30),
    description: z.string().max(2000),
    author: z.string().max(120),
    category: z.string().max(80),
    tags: z.array(z.string().max(40)).max(12),
    requiredCapabilities: z
      .array(z.enum(["interfaces", "dns", "tcp", "http"]))
      .max(4)
      .default([]),
    nodes: z.array(nodeSchema).min(2).max(150),
    edges: z
      .array(
        z
          .object({
            id,
            source: id,
            target: id,
            branch: z.string().max(80).optional(),
          })
          .strict(),
      )
      .max(300),
  })
  .strict();
export type Workflow = z.infer<typeof workflowSchema>;
export type FlowNode = Workflow["nodes"][number];
export function parseWorkflow(text: string): Workflow {
  if (new TextEncoder().encode(text).length > 512000)
    throw Error("Workflow exceeds 500 KB");
  return withCapabilities(workflowSchema.parse(JSON.parse(text)));
}
export function target(n: FlowNode): string {
  return n.kind === "http"
    ? n.config.url || ""
    : n.kind === "tcp"
      ? `${n.config.host || ""}:${n.config.port || 443}`
      : n.config.host || "";
}
export function validate(w: Workflow): string[] {
  const errors: string[] = [];
  const ids = new Set(w.nodes.map((n) => n.id));
  if (ids.size !== w.nodes.length)
    errors.push("Node identifiers must be unique.");
  if (new Set(w.edges.map((e) => e.id)).size !== w.edges.length)
    errors.push("Edge identifiers must be unique.");
  if (w.nodes.filter((n) => n.kind === "start").length !== 1)
    errors.push("Use exactly one Start node.");
  if (!w.nodes.some((n) => n.kind === "end")) errors.push("Add an End node.");
  for (const e of w.edges)
    if (!ids.has(e.source) || !ids.has(e.target))
      errors.push("An edge references a missing node.");
  const visited = new Set<string>(),
    active = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) {
      errors.push("Cycles are not supported.");
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    for (const e of w.edges.filter((e) => e.source === id)) visit(e.target);
    active.delete(id);
  }
  for (const n of w.nodes) visit(n.id);
  const reachable = new Set<string>();
  function reach(id: string) {
    if (reachable.has(id)) return;
    reachable.add(id);
    w.edges.filter((e) => e.source === id).forEach((e) => reach(e.target));
  }
  const start = w.nodes.find((n) => n.kind === "start");
  if (start) reach(start.id);
  for (const n of w.nodes) {
    const outgoing = w.edges.filter((e) => e.source === n.id);
    if (!reachable.has(n.id))
      errors.push(`${n.label}: not reachable from Start.`);
    if (n.kind === "start" && w.edges.some((e) => e.target === n.id))
      errors.push("Start cannot have incoming edges.");
    const branches =
      n.kind === "condition" ||
      n.kind === "question" ||
      n.kind === "confirmation"
        ? ["true", "false"]
        : n.kind === "choice"
          ? n.config.choices
          : undefined;
    if (n.kind === "choice" && !branches)
      errors.push(`${n.label}: provide choices.`);
    if (branches) {
      if (
        outgoing.length !== branches.length ||
        branches.some(
          (b) => outgoing.filter((e) => e.branch === b).length !== 1,
        )
      )
        errors.push(`${n.label}: connect each branch exactly once.`);
    } else if (n.kind === "end" ? outgoing.length !== 0 : outgoing.length !== 1)
      errors.push(
        `${n.label}: ${n.kind === "end" ? "End must have no exits" : "connect exactly one exit"}.`,
      );
    if (["dns", "tcp"].includes(n.kind) && !validHost(n.config.host || ""))
      errors.push(`${n.label}: enter a valid hostname or IP.`);
    if (n.kind === "tcp" && !n.config.port)
      errors.push(`${n.label}: enter a port.`);
    if (n.kind === "http") {
      try {
        const u = new URL(n.config.url || "");
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password ||
          u.hash ||
          u.search
        )
          throw Error();
      } catch {
        errors.push(
          `${n.label}: use an HTTP(S) URL without credentials, query, or fragment.`,
        );
      }
    }
    if (
      n.kind === "condition" &&
      (!n.config.source ||
        !ids.has(n.config.source) ||
        !n.config.field ||
        !n.config.operator ||
        n.config.value === undefined)
    )
      errors.push(`${n.label}: configure a source, field, operator and value.`);
  }
  return [...new Set(errors)];
}
export function validHost(host: string) {
  return (
    host.length > 0 &&
    host.length <= 253 &&
    (/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/.test(host) ||
      /^[a-fA-F0-9:]+$/.test(host))
  );
}

export function withCapabilities(w: Workflow): Workflow {
  return {
    ...w,
    requiredCapabilities: [
      ...new Set(
        w.nodes
          .map((n) => n.kind)
          .filter((k): k is "interfaces" | "dns" | "tcp" | "http" =>
            diagnosticKinds.includes(k),
          ),
      ),
    ],
  };
}

export function connectionError(
  w: Workflow,
  c: { source: string; target: string; sourceHandle?: string | null },
  replacing?: string,
): string | undefined {
  const source = w.nodes.find((n) => n.id === c.source),
    target = w.nodes.find((n) => n.id === c.target);
  if (!source || !target) return "Connect existing nodes.";
  if (
    source.id === target.id ||
    source.kind === "end" ||
    target.kind === "start"
  )
    return "This connection is not supported.";
  const branches =
    source.kind === "choice"
      ? source.config.choices
      : ["condition", "question", "confirmation"].includes(source.kind)
        ? ["true", "false"]
        : undefined;
  if (branches ? !branches.includes(c.sourceHandle || "") : !!c.sourceHandle)
    return "Choose a supported output handle.";
  const edges = w.edges.filter((e) => e.id !== replacing);
  if (
    edges.some(
      (e) =>
        e.source === c.source &&
        (e.branch || null) === (c.sourceHandle || null),
    )
  )
    return "This output is already connected. Drag the existing edge endpoint to reconnect it.";
  const seen = new Set<string>();
  function reaches(id: string): boolean {
    if (id === c.source) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return edges.filter((e) => e.source === id).some((e) => reaches(e.target));
  }
  if (reaches(c.target)) return "Cycles are not supported.";
  return undefined;
}
