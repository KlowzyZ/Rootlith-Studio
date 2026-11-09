import { workflowSchema, nodeSchema, type Workflow } from "../schemas";
import type { Report } from "../workflow-engine";
import { z } from "zod";
import { caseSchema, type InvestigationCase } from "./cases";
import { profileSchema, type TargetProfile } from "./profiles";
const reportSchema = z.object({
  id: z.string(),
  workflow: z.string(),
  version: z.string(),
  date: z.string(),
  demo: z.boolean(),
  limitations: z.array(z.string()),
  steps: z.array(
    z.object({
      nodeId: z.string(),
      label: z.string(),
      status: z.enum([
        "pending",
        "running",
        "passed",
        "failed",
        "skipped",
        "cancelled",
        "inconclusive",
      ]),
      duration: z.number(),
      tested: z.string().optional(),
      output: z
        .object({
          ok: z.boolean().optional(),
          status: z.number().optional(),
          answer: z.union([z.string(), z.boolean()]).optional(),
          detail: z.string(),
        })
        .optional(),
    }),
  ),
});
export const storeSchema = z.object({
  version: z.literal(1),
  workflows: z.array(workflowSchema).max(100),
  reports: z.array(reportSchema).max(50),
  cases: z.array(caseSchema).max(80).optional(),
  targetProfiles: z.array(profileSchema).max(40).optional(),
  favoriteRuns: z.array(z.string().max(128)).max(50).optional(),
  runWorkflows: z
    .record(z.string(), z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/))
    .optional(),
});
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
let adapter: StoragePort | undefined;
export function useStoragePort(port: StoragePort) {
  adapter = port;
}
const storage = (): StoragePort => adapter || localStorage;
export type Store = {
  version: 1;
  workflows: Workflow[];
  reports: Report[];
  runWorkflows?: Record<string, string>;
  targetProfiles?: TargetProfile[];
  cases?: InvestigationCase[];
  favoriteRuns?: string[];
};
export const storageKeys = {
  primary: "fixflow-v1",
  backup: "fixflow-v1-backup",
  draft: "fixflow-draft-v1",
  quarantine: "fixflow-quarantine-v1",
} as const;
export const draftSchema = z
  .object({
    version: z.literal(1),
    date: z.string(),
    workflow: workflowSchema.extend({
      name: z.string().max(120),
      nodes: z
        .array(nodeSchema.extend({ label: z.string().max(120) }))
        .max(150),
    }),
  })
  .strict();
const empty = (): Store => ({ version: 1, workflows: [], reports: [] });
const decode = (raw: string): Store => storeSchema.parse(JSON.parse(raw));
export function primaryRecord() {
  return storage().getItem(storageKeys.primary);
}
export function load(): Store {
  const raw = primaryRecord();
  return raw === null ? empty() : decode(raw);
}
export function loadWorkspace(): {
  store: Store;
  draft?: Workflow;
  notice: string;
  blocked: boolean;
} {
  let store = empty(),
    notice = "",
    blocked = false;
  try {
    store = load();
  } catch {
    blocked = true;
    try {
      const backup = storage().getItem(storageKeys.backup);
      if (!backup) throw Error();
      store = decode(backup);
      notice =
        "The main storage record is damaged. Last good backup loaded read-only. Restore it in Settings; the damaged record will be preserved.";
    } catch {
      notice =
        "Saved data could not be read. Original records are preserved. Export recovery data from Settings before resetting storage.";
    }
  }
  try {
    const raw = storage().getItem(storageKeys.draft);
    if (raw) {
      if (raw.length > 600000) throw Error();
      const draft = draftSchema.parse(JSON.parse(raw)).workflow;
      return {
        store,
        draft,
        notice:
          notice ||
          "Recovered unsaved canvas changes from the local draft journal.",
        blocked,
      };
    }
  } catch {
    notice =
      notice ||
      "A draft could not be recovered. Saved workflows are intact; export recovery data before resetting the draft.";
  }
  return { store, notice, blocked };
}
export function save(store: Store, expected?: string | null) {
  const next = JSON.stringify(storeSchema.parse(store));
  const previous = primaryRecord();
  if (expected !== undefined && previous !== expected)
    throw Error(
      "Storage changed in another window. Export your canvas and reload before saving.",
    );
  if (previous !== null) {
    decode(previous);
    storage().setItem(storageKeys.backup, previous);
  }
  storage().setItem(storageKeys.primary, next);
}
export function stageDraft(workflow: Workflow, expected?: string | null) {
  if (expected !== undefined && primaryRecord() !== expected)
    throw Error(
      "Storage changed in another window. Export your canvas and reload.",
    );
  const raw = JSON.stringify(
    draftSchema.parse({ version: 1, date: new Date().toISOString(), workflow }),
  );
  if (raw.length > 600000)
    throw Error("Draft is too large to journal. Export your workflow.");
  storage().setItem(storageKeys.draft, raw);
}
export function draftRecord() {
  return storage().getItem(storageKeys.draft);
}
export function clearDraft(id: string, expectedRaw?: string | null) {
  const raw = storage().getItem(storageKeys.draft);
  if (!raw || (expectedRaw !== undefined && expectedRaw !== raw)) return;
  try {
    if (draftSchema.parse(JSON.parse(raw)).workflow.id === id)
      storage().removeItem(storageKeys.draft);
  } catch {
    /* Keep malformed drafts for explicit recovery export. */
  }
}
export function restoreBackup() {
  const backup = storage().getItem(storageKeys.backup);
  if (!backup) throw Error("No backup available.");
  decode(backup);
  const original = primaryRecord();
  if (original !== null) storage().setItem(storageKeys.quarantine, original);
  storage().setItem(storageKeys.primary, backup);
}
export function recoveryExport() {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(storageKeys).map(([name, key]) => [
        name,
        storage().getItem(key),
      ]),
    ),
    null,
    2,
  );
}
export function resetStorage() {
  for (const key of Object.values(storageKeys)) storage().removeItem(key);
}

export function putWorkflow(
  workflows: Workflow[],
  workflow: Workflow,
): Workflow[] {
  const next = [workflow, ...workflows.filter((w) => w.id !== workflow.id)];
  if (next.length > 100)
    throw Error(
      "Workflow storage limit reached (100). Export a backup and remove unused workflows before saving another. Existing workflows were preserved.",
    );
  return next;
}

export function clearRunHistory(store: Store, expected?: string | null): Store {
  const next = storeSchema.parse({
    ...store,
    reports: [],
    runWorkflows: {},
    favoriteRuns: [],
  });
  const current = primaryRecord();
  if (expected !== undefined && current !== expected)
    throw Error(
      "Storage changed in another window. Reload before clearing history.",
    );
  if (current !== null) decode(current);
  const backup = storage().getItem(storageKeys.backup);
  const sanitized = {
    ...(backup ? decode(backup) : next),
    reports: [],
    runWorkflows: {},
    favoriteRuns: [],
  };
  storage().setItem(storageKeys.backup, JSON.stringify(sanitized));
  storage().setItem(storageKeys.primary, JSON.stringify(next));
  return next;
}
