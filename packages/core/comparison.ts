import type { Report, Step } from "../workflow-engine";
export type RunWorkflows = Record<string, string>;
export function comparisonScope(
  a: Report,
  b: Report,
  origins: RunWorkflows = {},
) {
  if (a.id === b.id) return "Choose two different runs.";
  if (a.demo !== b.demo)
    return "Simulated and native runs cannot be compared as equivalent evidence.";
  const left = Object.hasOwn(origins, a.id) ? origins[a.id] : undefined,
    right = Object.hasOwn(origins, b.id) ? origins[b.id] : undefined;
  if (left && right)
    return left === right
      ? "verified"
      : "These runs belong to different workflow identities.";
  return a.workflow === b.workflow
    ? "legacy"
    : "Workflow identity is unavailable and workflow names differ.";
}
export function compareSteps(a: Report, b: Report) {
  const before = new Map(a.steps.map((s) => [s.nodeId, s]));
  const after = new Map(b.steps.map((s) => [s.nodeId, s]));
  if (before.size !== a.steps.length || after.size !== b.steps.length)
    throw Error(
      "Duplicate node IDs in this report; steps cannot be matched reliably.",
    );
  return [...new Set([...before.keys(), ...after.keys()])].map((nodeId) => {
    const left = before.get(nodeId),
      right = after.get(nodeId);
    const target =
      !left?.tested || !right?.tested
        ? "unavailable"
        : left.tested === right.tested
          ? "same"
          : "changed";
    const statusChanged = !!left && !!right && left.status !== right.status;
    const classification = !left
      ? "Only in follow-up"
      : !right
        ? "Only in baseline"
        : target === "same" &&
            left.status === "failed" &&
            right.status === "passed"
          ? "Improvement"
          : target === "same" &&
              left.status === "passed" &&
              right.status === "failed"
            ? "Regression"
            : statusChanged
              ? "Status changed"
              : "Unchanged status";
    const measured = (s?: Step) =>
      !!s?.output &&
      !["pending", "running", "skipped"].includes(s.status) &&
      Number.isFinite(s.duration) &&
      s.duration >= 0;
    const durationDelta =
      measured(left) && measured(right)
        ? right!.duration - left!.duration
        : undefined;
    const evidenceChanged =
      !!left &&
      !!right &&
      ["detail", "ok", "status", "answer"].some(
        (key) =>
          left.output?.[key as keyof NonNullable<Step["output"]>] !==
          right.output?.[key as keyof NonNullable<Step["output"]>],
      );
    return {
      nodeId,
      left,
      right,
      target,
      classification,
      durationDelta,
      evidenceChanged,
    };
  });
}
