import { localKits, MAX_LOCAL_KITS } from "./local-kits";
import { z } from "zod";
import { storeSchema, type Store } from "./storage";

export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
export const backupWarning =
  "Not encrypted or redacted. Reports, case notes, local kit guidance/choices, hosts, URLs and addresses may contain sensitive information. Store and transfer only to trusted destinations.";
export const bytes = (text: string) => new TextEncoder().encode(text).length;
// Canonical JSON: recursively sorted object keys, original array order, UTF-8.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
function bounded(value: unknown, depth = 0): void {
  if (depth > 24) throw Error("Backup nesting exceeds limit.");
  if (typeof value === "string" && value.length > 16000)
    throw Error("Backup text exceeds content limit.");
  if (Array.isArray(value) && value.length > 500)
    throw Error("Backup collection exceeds content limit.");
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (
      keys.length > 500 ||
      keys.some((k) => ["__proto__", "constructor", "prototype"].includes(k))
    )
      throw Error("Unsupported backup keys.");
    Object.values(value).forEach((item) => bounded(item, depth + 1));
  }
}
function workspace(input: unknown): Store {
  bounded(input);
  const parsed = storeSchema.strict().parse(input);
  if (localKits(parsed).length > MAX_LOCAL_KITS)
    throw Error(
      "Portable workspace exceeds the 20 local-kit limit. Originals retained.",
    );
  if (canonical(parsed) !== canonical(input))
    throw Error("Unsupported or incomplete workspace fields.");
  for (const list of [
    parsed.workflows,
    parsed.reports,
    parsed.targetProfiles || [],
    parsed.cases || [],
  ]) {
    if (new Set(list.map((x) => x.id)).size !== list.length)
      throw Error(
        "Duplicate record IDs within backup are ambiguous; repair the source workspace first.",
      );
    if (list.some((x) => !/^[a-zA-Z0-9_-]{1,128}$/.test(x.id)))
      throw Error("Unsupported record ID.");
  }
  if (bytes(canonical(parsed)) > MAX_BACKUP_BYTES - 1024)
    throw Error(
      "Workspace exceeds the 2 MiB portable limit. Export individual reports and remove unused records, then retry.",
    );
  return parsed;
}
const envelope = z
  .object({
    format: z.literal("rootlith-workspace-backup"),
    version: z.literal(1),
    payload: z
      .object({ savedAt: z.string().datetime(), workspace: z.unknown() })
      .strict(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
async function digest(value: unknown) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return Array.from(new Uint8Array(hash), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function createBackup(
  store: Store,
  savedAt = new Date().toISOString(),
) {
  const payload = {
    savedAt: z.string().datetime().parse(savedAt),
    workspace: workspace(storeSchema.parse(store)),
  };
  const text = JSON.stringify({
    format: "rootlith-workspace-backup",
    version: 1,
    payload,
    sha256: await digest(payload),
  });
  if (bytes(text) > MAX_BACKUP_BYTES) throw Error("Backup exceeds 2 MiB.");
  return text;
}
export async function readBackup(text: string) {
  if (bytes(text) > MAX_BACKUP_BYTES)
    throw Error("Backup exceeds 2 MiB. Select a smaller backup.");
  const raw: unknown = JSON.parse(text);
  bounded(raw);
  const value = envelope.parse(raw);
  if ((await digest(value.payload)) !== value.sha256)
    throw Error(
      "SHA-256 integrity mismatch. Obtain an intact copy from the source; nothing was imported.",
    );
  return {
    savedAt: value.payload.savedAt,
    store: workspace(value.payload.workspace),
  };
}
export type PlanRow = {
  type: string;
  id: string;
  action: "add" | "skip" | "conflict";
  reason: string;
};
export function planImport(current: Store, incoming: Store) {
  workspace(incoming);
  const rows: PlanRow[] = [];
  const safe = (
    type: "workflows" | "reports" | "targetProfiles",
    id: string,
  ): boolean => {
    const source = incoming[type]?.find((x) => x.id === id);
    const local = current[type]?.find((x) => x.id === id);
    if (local && (!source || canonical(source) !== canonical(local)))
      return false;
    if (type === "reports" && source) {
      const origin = incoming.runWorkflows?.[id];
      // Even a NEW report cannot safely link a case when its declared
      // workflow origin collides with a different local workflow identity.
      if (local && origin !== current.runWorkflows?.[id]) return false;
      if (origin && !safe("workflows", origin)) return false;
    }
    return true;
  };
  const next: Store = structuredClone(current);
  for (const type of [
    "workflows",
    "reports",
    "targetProfiles",
    "cases",
  ] as const) {
    const target = [...(current[type] || [])];
    for (const item of incoming[type] || []) {
      const local = target.find((x) => x.id === item.id);
      let reason = "New record",
        action: PlanRow["action"] = "add";
      if (local) {
        action = canonical(local) === canonical(item) ? "skip" : "conflict";
        reason =
          action === "skip"
            ? "Identical record; local retained"
            : "Different content with same ID; local retained";
      } else if (type === "cases") {
        const c = item as NonNullable<Store["cases"]>[number];
        if (
          c.workflowIds.some((id) => !safe("workflows", id)) ||
          c.runIds.some((id) => !safe("reports", id)) ||
          (c.profileId && !safe("targetProfiles", c.profileId))
        ) {
          action = "conflict";
          reason =
            "Case skipped to prevent links to unlike or unverified local identities";
        }
      }
      rows.push({ type, id: item.id, action, reason });
      if (action === "add") target.push(item);
    }
    Object.assign(next, { [type]: target });
  }
  const addedRun = (id: string) =>
    rows.some((r) => r.type === "reports" && r.id === id && r.action === "add");
  next.favoriteRuns = [
    ...new Set([
      ...(current.favoriteRuns || []),
      ...(incoming.favoriteRuns || []).filter(addedRun),
    ]),
  ];
  next.runWorkflows = { ...current.runWorkflows };
  for (const [id, workflowId] of Object.entries(incoming.runWorkflows || {})) {
    const accepted =
      addedRun(id) &&
      !Object.hasOwn(next.runWorkflows, id) &&
      safe("workflows", workflowId);
    rows.push({
      type: "runWorkflows",
      id,
      action: accepted ? "add" : "skip",
      reason: accepted
        ? "Origin retained for new run"
        : "Local metadata retained; ambiguous origins not relinked",
    });
    if (accepted) next.runWorkflows[id] = workflowId;
  }
  for (const id of incoming.favoriteRuns || [])
    rows.push({
      type: "favoriteRuns",
      id,
      action: addedRun(id) ? "add" : "skip",
      reason: addedRun(id)
        ? "Favorite for new run"
        : "Local favorite state retained",
    });
  let error = "";
  try {
    workspace(next);
  } catch {
    error =
      "Merged workspace exceeds capacity or portable content limits (100 workflows, 50 reports, 40 profiles, 80 cases, 50 favorites, 20 local kits within 100 workflows, 2 MiB). Export both originals and remove unused records at the source before retrying; no partial import is allowed.";
  }
  // A previously missing local link must never silently acquire an imported identity.
  const reserved = {
    workflows: [
      ...(current.cases || []).flatMap((c) => c.workflowIds),
      ...Object.values(current.runWorkflows || {}),
    ],
    reports: [
      ...(current.cases || []).flatMap((c) => c.runIds),
      ...(current.favoriteRuns || []),
      ...Object.keys(current.runWorkflows || {}),
    ],
    targetProfiles: (current.cases || []).flatMap((c) =>
      c.profileId ? [c.profileId] : [],
    ),
  };
  for (const type of ["workflows", "reports", "targetProfiles"] as const) {
    if (
      rows.some(
        (r) =>
          r.type === type &&
          r.action === "add" &&
          reserved[type].includes(r.id),
      )
    )
      error =
        "Import would fill a missing local reference with an unverified identity. Originals retained. Resolve the missing references explicitly in the local workspace before previewing again.";
  }
  const missing: string[] = [];
  for (const c of next.cases || []) {
    for (const [type, ids] of [
      ["workflows", c.workflowIds],
      ["reports", c.runIds],
      ["targetProfiles", c.profileId ? [c.profileId] : []],
    ] as const)
      for (const id of ids)
        if (!next[type]?.some((x) => x.id === id))
          missing.push(`Case ${c.id}: missing ${type} ${id}`);
  }
  return { next, rows, error, missing, baseline: canonical(current) };
}
export function applyImport(
  current: Store,
  incoming: Store,
  baseline: string,
): Store {
  if (canonical(current) !== baseline)
    throw Error(
      "Workspace changed since preview. Cancel and preview the backup again.",
    );
  const plan = planImport(current, incoming);
  if (plan.error) throw Error(plan.error);
  return plan.next;
}
