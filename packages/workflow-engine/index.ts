import {
  type Workflow,
  type FlowNode,
  validate,
  diagnosticKinds,
  target,
} from "../schemas";
export type Status =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "inconclusive";
export type Output = {
  ok?: boolean;
  status?: number;
  answer?: string | boolean;
  detail: string;
};
export type Step = {
  nodeId: string;
  label: string;
  status: Status;
  duration: number;
  tested?: string;
  output?: Output;
};
export type Report = {
  id: string;
  workflow: string;
  version: string;
  date: string;
  demo: boolean;
  steps: Step[];
  limitations: string[];
};
export type Provider = (node: FlowNode, signal: AbortSignal) => Promise<Output>;
export async function execute(
  w: Workflow,
  provider: Provider,
  ask: (n: FlowNode) => Promise<string | boolean>,
  signal: AbortSignal,
  onStep: (s: Step) => void,
  demo = false,
): Promise<Report> {
  const errors = validate(w);
  if (errors.length) throw Error(errors.join("\n"));
  const report: Report = {
    id: crypto.randomUUID(),
    workflow: w.name,
    version: w.version,
    date: new Date().toISOString(),
    demo,
    steps: [],
    limitations: [
      demo
        ? "SIMULATED DEMO DATA. No native checks were performed."
        : "Read-only point-in-time checks; a failed check does not establish a root cause.",
      "No response bodies collected. Unvisited branches are skipped.",
    ],
  };
  for (const n of w.nodes)
    onStep({ nodeId: n.id, label: n.label, status: "pending", duration: 0 });
  let current = w.nodes.find((n) => n.kind === "start");
  const outputs = new Map<string, Output>();
  while (current && !signal.aborted) {
    const n = current;
    const tested =
      n.kind === "dns"
        ? `DNS IPv4 lookup · ${target(n)}`
        : n.kind === "tcp"
          ? `TCP connection · ${target(n)}`
          : n.kind === "http"
            ? `HTTP HEAD · ${target(n)} · redirects not followed`
            : n.kind === "interfaces"
              ? "Local adapter addresses · MAC addresses withheld"
              : undefined;
    const started = Date.now();
    onStep({
      nodeId: n.id,
      label: n.label,
      status: "running",
      duration: 0,
      tested,
    });
    let output: Output = { detail: n.description || n.label };
    let status: Status = "passed";
    let branch: string | undefined;
    try {
      if (diagnosticKinds.includes(n.kind)) {
        output = await provider(n, signal);
        status =
          output.ok === undefined
            ? "inconclusive"
            : output.ok
              ? "passed"
              : "failed";
      } else if (["question", "confirmation", "choice"].includes(n.kind)) {
        const answer = await ask(n);
        if (
          n.kind === "choice"
            ? !n.config.choices?.includes(String(answer))
            : typeof answer !== "boolean"
        )
          throw Error("No valid answer received. Execution stopped.");
        output = { detail: `Answer: ${answer}`, answer };
        branch = String(answer);
      } else if (n.kind === "condition") {
        const source = outputs.get(n.config.source!);
        const field = n.config.field!;
        if (!source || source[field] === undefined) {
          status = "inconclusive";
          output = {
            detail:
              "Condition source has no compatible evidence. Execution stopped.",
          };
        } else {
          const equal = source[field] === n.config.value;
          branch = String(n.config.operator === "equals" ? equal : !equal);
          output = {
            detail: `Condition evaluated to ${branch}`,
            answer: branch === "true",
          };
        }
      }
    } catch (e) {
      status = signal.aborted ? "cancelled" : "inconclusive";
      output = {
        detail: e instanceof Error ? e.message : "Diagnostic unavailable",
      };
    }
    if (signal.aborted) status = "cancelled";
    const step = {
      nodeId: n.id,
      label: n.label,
      status,
      duration: Date.now() - started,
      tested,
      output,
    };
    report.steps.push(step);
    outputs.set(n.id, output);
    onStep(step);
    if (
      status === "cancelled" ||
      (["condition", "question", "choice", "confirmation"].includes(n.kind) &&
        status === "inconclusive")
    )
      break;
    const edge = w.edges.find(
      (e) => e.source === n.id && (branch === undefined || e.branch === branch),
    );
    current = edge ? w.nodes.find((x) => x.id === edge.target) : undefined;
  }
  for (const n of w.nodes.filter(
    (n) => !report.steps.some((s) => s.nodeId === n.id),
  )) {
    const s: Step = {
      nodeId: n.id,
      label: n.label,
      status: signal.aborted ? "cancelled" : "skipped",
      duration: 0,
    };
    report.steps.push(s);
    onStep(s);
  }
  return report;
}
export const demoProvider: Provider = async (n, signal) => {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(Error("Cancelled"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(Error("Cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 650);
    signal.addEventListener("abort", abort, { once: true });
  });
  return {
    ok: true,
    ...(n.kind === "http" ? { status: 200 } : {}),
    detail: `SIMULATED: ${n.kind === "interfaces" ? "Example adapter: Ethernet · 192.0.2.10" : n.kind === "dns" ? "Example DNS answer: 192.0.2.1" : n.kind === "tcp" ? "Example TCP connection accepted" : "Example HTTP response: 200"}. No real check performed.`,
  };
};
