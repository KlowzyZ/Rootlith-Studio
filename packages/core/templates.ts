import { type Workflow, type FlowNode, withCapabilities } from "../schemas";
const node = (
  id: string,
  kind: FlowNode["kind"],
  label: string,
  x: number,
  y: number,
  config: Partial<FlowNode["config"]> = {},
  description = "",
): FlowNode => ({
  id,
  kind,
  label,
  position: { x, y },
  description,
  config: { timeout: 3000, ...config },
});
export function template(mode = "internet"): Workflow {
  const local = mode === "local",
    web = mode === "website";
  const host = local ? "localhost" : "example.com";
  const workflow: Workflow = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: local
      ? "Local Development Server"
      : web
        ? "Website Reachability"
        : "Internet Connection",
    version: "1.0.0",
    description: local
      ? "Follow the evidence from your local port to the HTTP service."
      : web
        ? "Check name resolution, the connection, and the server response."
        : "A guided playbook for investigating your network connection.",
    author: "KLOWZY",
    category: "Networking",
    tags: ["network", "starter"],
    requiredCapabilities: [],
    nodes: [
      node(
        "start",
        "start",
        "Begin diagnosis",
        300,
        0,
        {},
        "Read-only checks. You approve every network target before starting.",
      ),
      node("interfaces", "interfaces", "Inspect network adapters", 300, 115),
      node(
        "question",
        "question",
        "Are you connected?",
        300,
        245,
        {},
        "Check your Wi-Fi or Ethernet connection before continuing.",
      ),
      node(
        "dns",
        "dns",
        "Resolve hostname",
        300,
        395,
        { host },
        "Resolve the configured hostname into network addresses.",
      ),
      node("condition", "condition", "Did DNS resolve?", 300, 535, {
        source: "dns",
        field: "ok",
        operator: "equals",
        value: true,
      }),
      node("tcp", "tcp", "Test connection", 300, 685, {
        host,
        port: local ? 3000 : 443,
      }),
      node("http", "http", "Check HTTP response", 300, 825, {
        url: local ? "http://localhost:3000" : "https://example.com",
      }),
      node(
        "guidance",
        "result",
        "Review your connection",
        660,
        395,
        {},
        "A disconnected adapter or failed name resolution may explain this result. Check your connection and DNS settings, then rerun. No settings were changed.",
      ),
      node(
        "end",
        "end",
        "Diagnostic complete",
        300,
        970,
        {},
        "Review the individual findings. Reachability alone does not confirm the service is healthy.",
      ),
    ],
    edges: [
      ["start", "interfaces"],
      ["interfaces", "question"],
      ["question", "dns", "true"],
      ["question", "guidance", "false"],
      ["dns", "condition"],
      ["condition", "tcp", "true"],
      ["condition", "guidance", "false"],
      ["tcp", "http"],
      ["http", "end"],
      ["guidance", "end"],
    ].map(([source, target, branch], i) => ({
      id: `e${i}`,
      source,
      target,
      ...(branch ? { branch } : {}),
    })),
  };
  if (local) {
    workflow.nodes = workflow.nodes.filter(
      (n) => !["interfaces", "question", "dns"].includes(n.id),
    );
    workflow.nodes = workflow.nodes.map((n) =>
      n.id === "condition"
        ? {
            ...n,
            label: "Did the port accept a connection?",
            config: {
              timeout: 3000,
              source: "tcp",
              field: "ok",
              operator: "equals",
              value: true,
            },
          }
        : n.id === "guidance"
          ? {
              ...n,
              label: "Check the local service",
              description:
                "The service may not be listening on this host and port. Check your development server output and configured port. No process inspection or firewall changes were performed.",
            }
          : n,
    );
    workflow.edges = [
      ["start", "tcp"],
      ["tcp", "condition"],
      ["condition", "http", "true"],
      ["condition", "guidance", "false"],
      ["http", "end"],
      ["guidance", "end"],
    ].map(([source, target, branch], i) => ({
      id: `e${i}`,
      source,
      target,
      ...(branch ? { branch } : {}),
    }));
  }
  const rows: Record<string, number> = {
    start: 0,
    interfaces: 100,
    question: 205,
    dns: 320,
    condition: 430,
    tcp: 540,
    http: 650,
    end: 765,
    guidance: 320,
  };
  workflow.nodes = workflow.nodes.map((n) => ({
    ...n,
    position: {
      ...n.position,
      y: local
        ? ({
            start: 0,
            tcp: 120,
            condition: 245,
            http: 380,
            guidance: 380,
            end: 520,
          }[n.id] ?? 0)
        : rows[n.id],
    },
  }));
  return withCapabilities(workflow);
}
