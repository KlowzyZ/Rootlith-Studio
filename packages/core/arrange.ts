import type { Workflow } from "../schemas";
// Layer a DAG by longest path, then use branch order to keep sibling paths apart.
// Disconnected components are retained. Cycles are rejected without an edit.
export function arrangeWorkflow(workflow: Workflow): Workflow {
  const nodes = new Map(workflow.nodes.map((n) => [n.id, n]));
  if (nodes.size !== workflow.nodes.length)
    throw Error("Resolve duplicate node IDs before arranging.");
  const incoming = new Map(workflow.nodes.map((n) => [n.id, 0]));
  const outgoing = new Map(
    workflow.nodes.map((n) => [
      n.id,
      workflow.edges.filter((e) => e.source === n.id),
    ]),
  );
  for (const edge of workflow.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target))
      throw Error("Resolve missing edge endpoints before arranging.");
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
  }
  for (const [id, edges] of outgoing) {
    const node = nodes.get(id)!;
    const branches =
      node.kind === "choice" ? node.config.choices : ["true", "false"];
    edges.sort(
      (a, b) =>
        (branches?.indexOf(a.branch || "") ?? 0) -
        (branches?.indexOf(b.branch || "") ?? 0),
    );
  }
  const queue = workflow.nodes
    .filter((n) => incoming.get(n.id) === 0)
    .map((n) => n.id);
  const depths = new Map(queue.map((id) => [id, 0]));
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of outgoing.get(id)!) {
      depths.set(
        e.target,
        Math.max(depths.get(e.target) || 0, depths.get(id)! + 1),
      );
      incoming.set(e.target, incoming.get(e.target)! - 1);
      if (incoming.get(e.target) === 0) queue.push(e.target);
    }
  }
  if (order.length !== nodes.size)
    throw Error("Resolve graph cycles before arranging.");
  const layers = new Map<number, string[]>();
  for (const id of order) {
    const depth = depths.get(id)!;
    layers.set(depth, [...(layers.get(depth) || []), id]);
  }
  // Follow the first branch as the main lane; reserve a separate lane for
  // each other path. Shared downstream nodes stay in their first lane.
  const lanes = new Map<string, number>();
  let lastLane = 0;
  function assign(id: string, lane: number) {
    if (lanes.has(id)) return;
    lanes.set(id, lane);
    outgoing.get(id)!.forEach((edge, index) => {
      if (!lanes.has(edge.target))
        assign(edge.target, index === 0 ? lane : ++lastLane);
    });
  }
  for (const id of order)
    if (!lanes.has(id)) assign(id, lanes.size ? ++lastLane : 0);
  const positions = new Map<string, { x: number; y: number }>();
  // Wrap unusually wide layers and center long graphs inside schema bounds.
  const columns = 50;
  const totalRows = [...layers.values()].reduce(
    (sum, ids) => sum + Math.ceil(ids.length / columns),
    0,
  );
  const rowGap = Math.min(150, 19600 / Math.max(1, totalRows - 1));
  let row = 0;
  for (const [, ids] of [...layers].sort((a, b) => a[0] - b[0])) {
    for (let start = 0; start < ids.length; start += columns) {
      const group = ids.slice(start, start + columns);
      group.forEach((id, i) =>
        positions.set(id, {
          x:
            lastLane < 50
              ? (lanes.get(id)! - lastLane / 2) * 350
              : (i - (group.length - 1) / 2) * 350,
          y: (row - (totalRows - 1) / 2) * rowGap,
        }),
      );
      row++;
    }
  }
  return {
    ...workflow,
    nodes: workflow.nodes.map((n) => ({
      ...n,
      position: positions.get(n.id)!,
    })),
  };
}
