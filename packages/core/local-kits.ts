import {
  workflowSchema,
  validate,
  withCapabilities,
  type Workflow,
} from "../schemas";
import type { Store } from "./storage";
export const LOCAL_KIT_TAG = "rootlith:local-kit:v1";
export const MAX_LOCAL_KITS = 20;
export const localKits = (store: Store) =>
  store.workflows.filter((w) => w.tags.includes(LOCAL_KIT_TAG));
export const workflowFingerprint = (w: Workflow) =>
  JSON.stringify(workflowSchema.parse(w));
export function validateKitGraph(w: Workflow) {
  // Validation only. Reserved dummy targets are never saved, resolved or executed.
  const probe = {
    ...w,
    nodes: w.nodes.map((n) => ({
      ...n,
      config: {
        ...n.config,
        ...(["dns", "tcp"].includes(n.kind) ? { host: "example.invalid" } : {}),
        ...(n.kind === "tcp" ? { port: 1 } : {}),
        ...(n.kind === "http" ? { url: "https://example.invalid/" } : {}),
      },
    })),
  };
  const errors = validate(probe);
  if (errors.length)
    throw Error(`Repair the source workflow before reuse: ${errors.join(" ")}`);
}
export function assertLocalKit(w: Workflow) {
  workflowSchema.parse(w);
  if (!w.tags.includes(LOCAL_KIT_TAG))
    throw Error("This is not a saved local kit.");
  if (
    w.nodes.some(
      (n) =>
        n.config.host !== undefined ||
        n.config.port !== undefined ||
        n.config.url !== undefined,
    )
  )
    throw Error(
      "Saved kit contains concrete targets. Make a clean copy before reuse; no targets were applied.",
    );
  validateKitGraph(w);
}
function rekey(source: Workflow) {
  const ids = new Map(source.nodes.map((n) => [n.id, crypto.randomUUID()]));
  if (ids.size !== source.nodes.length)
    throw Error("Source node IDs must be unique.");
  return {
    ...structuredClone(source),
    id: crypto.randomUUID(),
    nodes: source.nodes.map((n) => {
      const { source: sourceId, ...config } = structuredClone(n.config);
      return {
        ...structuredClone(n),
        id: ids.get(n.id)!,
        config: {
          ...config,
          ...(sourceId && ids.has(sourceId)
            ? { source: ids.get(sourceId)! }
            : {}),
        },
      };
    }),
    edges: source.edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      source: ids.get(e.source)!,
      target: ids.get(e.target)!,
    })),
  };
}
export function prepareLocalTemplate(
  source: Workflow,
  name: string,
  guidance: string,
  includeWording = false,
): Workflow {
  const parsed = workflowSchema.parse(source);
  validateKitGraph(parsed);
  const copy = rekey(parsed);
  return withCapabilities(
    workflowSchema.parse({
      ...copy,
      name: name.trim(),
      description: guidance,
      version: "1.0.0",
      author: "",
      category: "Technician kits",
      tags: [LOCAL_KIT_TAG],
      nodes: copy.nodes.map((n, i) => {
        const { host: _host, port: _port, url: _url, ...config } = n.config;
        return {
          ...n,
          label: includeWording
            ? n.label
            : `${n.kind.toUpperCase()} · ${i + 1}`,
          description: includeWording ? n.description : "",
          config,
        };
      }),
    }),
  );
}
export function saveLocalTemplate(
  store: Store,
  sourceId: string,
  expected: string,
  template: Workflow,
): Store {
  const source = store.workflows.find((w) => w.id === sourceId);
  if (!source || workflowFingerprint(source) !== expected)
    throw Error(
      "Source workflow changed or disappeared since preview. Reopen the preview; nothing was saved.",
    );
  assertLocalKit(template);
  if (localKits(store).length >= MAX_LOCAL_KITS)
    throw Error(
      "Local kit limit reached (20). Export a backup and remove an unused local template first.",
    );
  if (store.workflows.length >= 100)
    throw Error("Workflow capacity reached (100, including local kits).");
  if (
    store.workflows.some((w) => w.id === template.id) ||
    store.cases?.some((c) => c.workflowIds.includes(template.id)) ||
    Object.values(store.runWorkflows || {}).includes(template.id)
  )
    throw Error("New kit identity is already reserved. Reopen the preview.");
  return { ...store, workflows: [...store.workflows, template] };
}
export function instantiateLocalTemplate(source: Workflow): Workflow {
  assertLocalKit(source);
  const copy = workflowSchema.parse({
    ...rekey(source),
    tags: source.tags.filter((t) => t !== LOCAL_KIT_TAG),
    category: "Investigation",
  });
  validateKitGraph(copy);
  return copy;
}
export function removeLocalTemplate(
  store: Store,
  id: string,
  expected: string,
): Store {
  const source = store.workflows.find((w) => w.id === id);
  if (
    !source ||
    !source.tags.includes(LOCAL_KIT_TAG) ||
    workflowFingerprint(source) !== expected
  )
    throw Error("Local kit changed since confirmation. Reopen the library.");
  if (
    store.cases?.some((c) => c.workflowIds.includes(id)) ||
    Object.values(store.runWorkflows || {}).includes(id)
  )
    throw Error(
      "This template is directly referenced by cases or report origins. Unlink those references explicitly before deleting it. Instantiated copies remain independent.",
    );
  return { ...store, workflows: store.workflows.filter((w) => w.id !== id) };
}
