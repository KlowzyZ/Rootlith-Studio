import { nodeSchema, validHost, type Workflow } from "../schemas";

export type TargetInput = { host: string; port: string; url: string };
// Concrete values only: the saved workflow and native approval see the same nodes.
export function quickTarget(workflow: Workflow, input: TargetInput) {
  const host = input.host.trim(),
    port = input.port.trim(),
    url = input.url.trim();
  const hostname = host.endsWith(".") ? host.slice(0, -1) : host;
  let hostValid =
    !host ||
    (validHost(host) &&
      hostname
        .split(".")
        .every((label) =>
          /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label),
        ));
  if (host.includes(":")) {
    try {
      hostValid = new URL(`http://[${host}]/`).hostname.length > 0;
    } catch {
      hostValid = false;
    }
  }
  if (/^[0-9.]+$/.test(host))
    hostValid =
      hostname.split(".").length === 4 &&
      hostname
        .split(".")
        .every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (!hostValid)
    throw Error("Enter a hostname or IP without a scheme, path, or spaces.");
  if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535))
    throw Error("TCP port must be a whole number from 1 to 65535.");
  let origin: URL | undefined;
  if (url) {
    try {
      origin = new URL(url);
      if (
        !["http:", "https:"].includes(origin.protocol) ||
        origin.username ||
        origin.password ||
        origin.search ||
        origin.hash ||
        origin.pathname !== "/"
      )
        throw Error();
    } catch {
      throw Error(
        "Use an HTTP(S) base URL without credentials, path, query, or fragment. Existing step paths are kept.",
      );
    }
  }
  const changes: {
    before: Workflow["nodes"][number];
    after: Workflow["nodes"][number];
  }[] = [];
  const nodes = workflow.nodes.map((before) => {
    const config = { ...before.config };
    if (["dns", "tcp"].includes(before.kind) && host) config.host = host;
    if (before.kind === "tcp" && port) config.port = Number(port);
    if (before.kind === "http" && origin) {
      let path = "/";
      try {
        const existing = config.url ? new URL(config.url) : undefined;
        if (
          existing &&
          (existing.username ||
            existing.password ||
            existing.search ||
            existing.hash ||
            !["http:", "https:"].includes(existing.protocol))
        )
          throw Error();
        path = existing?.pathname || "/";
      } catch {
        throw Error(
          `${before.label}: correct the existing URL in the inspector first so its path can be preserved.`,
        );
      }
      config.url = origin.origin + path;
    }
    if (JSON.stringify(config) === JSON.stringify(before.config)) return before;
    const after = nodeSchema.parse({ ...before, config });
    changes.push({ before, after });
    return after;
  });
  return { workflow: { ...workflow, nodes }, changes };
}
export function duplicateWorkflow(source: Workflow): Workflow {
  return {
    ...structuredClone(source),
    id: crypto.randomUUID(),
    name: `${source.name.slice(0, 115)} copy`,
  };
}
