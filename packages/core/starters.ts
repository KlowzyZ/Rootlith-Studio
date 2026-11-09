import { withCapabilities, type FlowNode, type Workflow } from "../schemas";
import { arrangeWorkflow } from "./arrange";
export const starters = [
  {
    key: "network",
    name: "Network Connectivity",
    description:
      "Review adapters, resolve one host, and check one configured service.",
  },
  {
    key: "service",
    name: "Local Service Troubleshooting",
    description:
      "Separate a listening port from an HTTP response on your own service.",
  },
  {
    key: "camera",
    name: "IP Camera / NVR Connectivity",
    description:
      "Check one known device and its documented management endpoint. No scanning.",
  },
] as const;
export function starter(key: string): Workflow {
  const entry = starters.find((s) => s.key === key);
  if (!entry) throw Error("Unknown starter playbook");
  const network = key === "network",
    camera = key === "camera";
  const nodes: FlowNode[] = [];
  const edges: Workflow["edges"] = [];
  const add = (
    id: string,
    kind: FlowNode["kind"],
    label: string,
    description = "",
    config: Partial<FlowNode["config"]> = {},
  ) =>
    nodes.push({
      id,
      kind,
      label,
      description,
      config: { timeout: 3000, ...config },
      position: { x: 0, y: 0 },
    });
  const link = (source: string, target: string, branch?: string) =>
    edges.push({
      id: `e${edges.length}`,
      source,
      target,
      ...(branch ? { branch } : {}),
    });
  add(
    "start",
    "start",
    "Configure your investigation",
    "Use Quick Target Setup or the inspector before running. Enter only targets you own or are authorized to inspect.",
  );
  add(
    "scope",
    "confirmation",
    "Have you configured your own target?",
    camera
      ? "Enter one known camera/NVR host and a service port from its documentation or your administrator. Set its HTTP(S) management base URL separately. Do not assume a vendor port. No discovery, streaming, credentials or video are tested."
      : "Set the DNS/TCP host, TCP port and HTTP(S) base URL using Quick Target Setup. Confirm the endpoint path in the inspector. No settings will be changed.",
  );
  add(
    "configure",
    "result",
    "Configure targets before rerunning",
    "Cancel, configure your own target, then review the exact native execution scope. No targets are supplied by this playbook.",
  );
  if (network)
    add(
      "interfaces",
      "interfaces",
      "Review local adapters",
      "Addresses are local context, not proof of internet access. MAC addresses are withheld.",
    );
  if (camera)
    add(
      "address-kind",
      "choice",
      "Is your target a hostname or an IP?",
      "A literal device IP does not need a DNS lookup. This choice does not discover addresses.",
      { choices: ["Hostname: include DNS", "IP address: skip DNS"] },
    );
  if (network || camera)
    add(
      "dns",
      "dns",
      "Resolve the configured host",
      "IPv4 DNS lookup only. A literal IP or IPv6-only name may not produce a useful DNS result; this does not establish device failure.",
    );
  add(
    "tcp",
    "tcp",
    camera
      ? "Connect to the documented device port"
      : "Connect to the configured service port",
    "A TCP connection tests reachability of one configured endpoint. It does not test application health.",
  );
  add(
    "port-result",
    "condition",
    "Did the port accept a connection?",
    "Use the TCP evidence to choose the next path.",
    { source: "tcp", field: "ok", operator: "equals", value: true },
  );
  add(
    "port-guidance",
    "result",
    "Review the host and service configuration",
    camera
      ? "Compare the configured device address, documented service port, cabling/PoE and network segment with your administrator's records. A failed connection alone cannot identify a device, VLAN or firewall fault. No changes were made."
      : "Check the configured host and port against your service settings and application logs. A failed connection alone cannot distinguish a stopped service, access rule or routing issue. No changes were made.",
  );
  add(
    "http-choice",
    "choice",
    "Does this service provide HTTP(S)?",
    "Choose HTTP(S) only if you configured an authorized web endpoint. Other protocols cannot be tested with HTTP HEAD.",
    { choices: ["Check configured HTTP(S)", "Finish with TCP evidence"] },
  );
  add(
    "http",
    "http",
    "Check the configured web endpoint",
    "HEAD request only. No credentials, query strings, response bodies or redirects. A 405 response may mean HEAD is unsupported; it does not establish service failure.",
  );
  add(
    "review",
    "result",
    "Review evidence against your service expectations",
    camera
      ? "Reachable management HTTP does not establish recording, stream, storage or authentication health. Review the recorded HTTP status and device logs through your normal authorized tools."
      : "Compare DNS, TCP and HTTP evidence with your service expectations. A response status is evidence, not a root cause. No automatic repairs were performed.",
  );
  add(
    "end",
    "end",
    "Investigation complete",
    "Save this run as a baseline, then compare a later run after an intentional configuration change. Review targets before each execution.",
  );
  link("start", "scope");
  link(
    "scope",
    network ? "interfaces" : camera ? "address-kind" : "tcp",
    "true",
  );
  link("scope", "configure", "false");
  link("configure", "end");
  if (network) {
    link("interfaces", "dns");
    link("dns", "tcp");
  } else if (camera) {
    link("address-kind", "dns", "Hostname: include DNS");
    link("address-kind", "tcp", "IP address: skip DNS");
    link("dns", "tcp");
  }
  link("tcp", "port-result");
  link("port-result", "http-choice", "true");
  link("port-result", "port-guidance", "false");
  link("port-guidance", "end");
  link("http-choice", "http", "Check configured HTTP(S)");
  link("http-choice", "review", "Finish with TCP evidence");
  link("http", "review");
  link("review", "end");
  return arrangeWorkflow(
    withCapabilities({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      name: entry.name,
      description: entry.description,
      version: "1.0.0",
      author: "KLOWZY",
      category: camera ? "Devices" : "Networking",
      tags: ["starter", key],
      requiredCapabilities: [],
      nodes,
      edges,
    }),
  );
}
