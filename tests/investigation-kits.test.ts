import { expect, test, vi } from "vitest";
import {
  addKit,
  investigationKits,
  prepareKit,
} from "../packages/core/investigation-kits";
import { quickTarget } from "../packages/core/quick-target";
import { validate, workflowSchema } from "../packages/schemas";
import {
  load,
  primaryRecord,
  storageKeys,
  useStoragePort,
  type Store,
} from "../packages/core/storage";
import { workspaceWriter } from "../packages/core/workspace-writer";
import { createBackup, readBackup } from "../packages/core/workspace-backup";
const empty = (): Store => ({ version: 1, workflows: [], reports: [] });
test.each(investigationKits)(
  "$name: original graph, blank targets, valid configured branches and fresh identities",
  (kit) => {
    const first = prepareKit(kit.key, "Site investigation");
    const second = prepareKit(kit.key, "Other investigation");
    expect(first.workflow.id).not.toBe(second.workflow.id);
    expect(first.investigation.id).not.toBe(second.investigation.id);
    workflowSchema.parse(first.workflow);
    expect(
      first.workflow.nodes.some((n) =>
        ["choice", "confirmation", "question"].includes(n.kind),
      ),
    ).toBe(true);
    for (const node of first.workflow.nodes) {
      expect(node.config.host).toBeUndefined();
      expect(node.config.port).toBeUndefined();
      expect(node.config.url).toBeUndefined();
    }
    const configured = quickTarget(first.workflow, {
      host: "example.org",
      port: "8443",
      url: "https://example.org:8443",
    });
    expect(validate(configured.workflow)).toEqual([]);
    expect(first.investigation.workflowIds).toEqual([first.workflow.id]);
    expect(first.investigation.note).toContain("Prerequisites:");
    expect(first.investigation.note).toContain("Next steps:");
    first.workflow.nodes[0].label = "Edited locally";
    expect(second.workflow.nodes[0].label).not.toBe("Edited locally");
  },
);
test("atomic linked additions preserve all workspace data, context-only profile, and portable format", async () => {
  const before: Store = {
    ...empty(),
    targetProfiles: [
      {
        id: "profile",
        name: "Lab",
        host: "example.org",
        port: "443",
        url: "https://example.org",
      },
    ],
    favoriteRuns: ["missing-run"],
    runWorkflows: { "missing-run": "missing-workflow" },
  };
  const draft = prepareKit("camera", "Camera cabinet A", "profile");
  const after = addKit(before, draft);
  expect(before.workflows).toEqual([]);
  expect(before.cases).toBeUndefined();
  expect(after.cases?.[0].profileId).toBe("profile");
  expect(
    after.workflows[0].nodes.find((n) => n.kind === "tcp")?.config.host,
  ).toBeUndefined();
  expect(after.reports).toEqual(before.reports);
  expect(after.favoriteRuns).toEqual(before.favoriteRuns);
  expect(after.runWorkflows).toEqual(before.runWorkflows);
  expect((await readBackup(await createBackup(after))).store).toEqual(after);
  expect(() => addKit(after, draft)).toThrow(/identifiers/);
  expect(() => addKit({ ...before, targetProfiles: [] }, draft)).toThrow(
    /no longer available/,
  );
});
test("case/workflow limits, invalid links, names and reserved IDs fail before mutation", () => {
  const draft = prepareKit("network", "LAN");
  const fullWorkflows: Store = {
    ...empty(),
    workflows: Array.from({ length: 100 }, (_, i) => ({
      ...draft.workflow,
      id: `w${i}`,
    })),
  };
  const fullCases: Store = {
    ...empty(),
    cases: Array.from({ length: 80 }, (_, i) => ({
      ...draft.investigation,
      id: `c${i}`,
      workflowIds: [],
    })),
  };
  expect(() => addKit(fullWorkflows, draft)).toThrow(/limit/);
  expect(() => addKit(fullCases, draft)).toThrow(/limit/);
  expect(fullCases.workflows).toEqual([]);
  expect(fullWorkflows.cases).toBeUndefined();
  expect(() => prepareKit("camera", " ")).toThrow();
  expect(() => prepareKit("unknown", "Case")).toThrow(/Unknown/);
  expect(() =>
    addKit(empty(), {
      ...draft,
      investigation: { ...draft.investigation, workflowIds: ["wrong"] },
    }),
  ).toThrow(/exactly one/);
  expect(() =>
    addKit({ ...empty(), runWorkflows: { expired: draft.workflow.id } }, draft),
  ).toThrow(/reserved/);
});
test("serialized creation waits for ACK; validation and failed native ACK never publish partial artifacts", async () => {
  const records = new Map<string, string>([
    [storageKeys.primary, JSON.stringify(empty())],
    [storageKeys.draft, "keep-journal"],
    [storageKeys.quarantine, "keep-original"],
  ]);
  useStoragePort({
    getItem: (k) => records.get(k) ?? null,
    setItem: (k, v) => {
      records.set(k, v);
    },
    removeItem: (k) => {
      records.delete(k);
    },
  });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let flushes = 0;
  const committed = vi.fn(),
    failed = vi.fn();
  const expected = { current: primaryRecord() };
  const writer = workspaceWriter({
    expected,
    flush: async () => {
      if (++flushes === 2) await gate;
    },
    committed,
    failed,
    pending: vi.fn(),
  });
  const first = prepareKit("camera", "Camera");
  const operation = writer.update((s) => addKit(s, first));
  await vi.waitFor(() => expect(flushes).toBe(2));
  expect(committed).not.toHaveBeenCalled();
  const staged = load();
  expect(staged.workflows).toHaveLength(1);
  expect(staged.cases).toHaveLength(1);
  release();
  await operation;
  expect(committed).toHaveBeenCalledTimes(1);
  const acknowledged = primaryRecord();
  await expect(writer.update((s) => addKit(s, first))).rejects.toThrow(
    /identifiers/,
  );
  expect(primaryRecord()).toBe(acknowledged);
  expect(records.get(storageKeys.draft)).toBe("keep-journal");
  expect(records.get(storageKeys.quarantine)).toBe("keep-original");
  const brokenCommitted = vi.fn();
  let calls = 0;
  const broken = workspaceWriter({
    expected,
    flush: async () => {
      if (++calls === 2) throw Error("Native disk write failed");
    },
    committed: brokenCommitted,
    failed,
    pending: vi.fn(),
  });
  await expect(
    broken.update((s) => addKit(s, prepareKit("service", "Service"))),
  ).rejects.toThrow("Native disk write failed");
  expect(brokenCommitted).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledTimes(1);
  await expect(broken.idle()).rejects.toThrow("Native disk write failed");
});
