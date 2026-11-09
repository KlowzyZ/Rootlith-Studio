import { expect, test } from "vitest";
import {
  prepareKit,
  prepareFromLocalKit,
  addKit,
  investigationKits,
} from "../packages/core/investigation-kits";
import {
  prepareLocalTemplate,
  instantiateLocalTemplate,
  saveLocalTemplate,
  removeLocalTemplate,
  assertLocalKit,
  localKits,
  workflowFingerprint,
  LOCAL_KIT_TAG,
} from "../packages/core/local-kits";
import {
  attachCaseEvidence,
  unlinkCaseEvidence,
  commandOverview,
} from "../packages/core/case-command";
import { quickTarget } from "../packages/core/quick-target";
import { validate } from "../packages/schemas";
import { storeSchema, type Store } from "../packages/core/storage";
import {
  createBackup,
  readBackup,
  planImport,
  applyImport,
} from "../packages/core/workspace-backup";
import { caseDossier, caseDossierHTML } from "../packages/core/case-export";
const empty = (): Store => ({ version: 1, workflows: [], reports: [] });
function fixture() {
  const draft = prepareKit("camera", "SECRET site");
  const source = quickTarget(draft.workflow, {
    host: "secret.camera.example",
    port: "8443",
    url: "https://secret.camera.example:8443",
  }).workflow;
  return { source, store: { ...empty(), workflows: [source] } };
}
const template = () => {
  const f = fixture();
  return {
    ...f,
    kit: prepareLocalTemplate(
      f.source,
      "Camera follow-up kit",
      "Review authorization and documented service expectations.",
    ),
  };
};
test("local kit removes site targets, source identifiers/metadata and default wording; graph references survive rekeying", () => {
  const { source } = fixture();
  source.author = "SECRET author";
  source.version = "SECRET version";
  source.description = "SECRET site note";
  source.nodes = source.nodes.map((n) => ({
    ...n,
    label: `SECRET ${n.kind}`,
    description: "SECRET step note",
  }));
  source.nodes[0].config.source = "SECRET-unused-source";
  const original = structuredClone(source),
    kit = prepareLocalTemplate(source, "Reusable camera", "Human guidance");
  expect(source).toEqual(original);
  expect(JSON.stringify(kit)).not.toContain("SECRET");
  expect(JSON.stringify(kit)).not.toContain("secret.camera.example");
  expect(JSON.stringify(kit)).not.toContain(source.id);
  expect(kit.version).toBe("1.0.0");
  for (const n of kit.nodes) {
    expect(n.config.host).toBeUndefined();
    expect(n.config.port).toBeUndefined();
    expect(n.config.url).toBeUndefined();
    if (n.config.source)
      expect(kit.nodes.some((p) => p.id === n.config.source)).toBe(true);
  }
  for (const e of kit.edges) {
    expect(kit.nodes.some((n) => n.id === e.source)).toBe(true);
    expect(kit.nodes.some((n) => n.id === e.target)).toBe(true);
  }
  assertLocalKit(kit);
  expect(
    validate(
      quickTarget(kit, {
        host: "camera.example",
        port: "9000",
        url: "https://camera.example:9000",
      }).workflow,
    ),
  ).toEqual([]);
  const a = instantiateLocalTemplate(kit),
    b = instantiateLocalTemplate(kit);
  expect(a.id).not.toBe(b.id);
  expect(a.nodes.some((n) => b.nodes.some((p) => p.id === n.id))).toBe(false);
  expect(a.tags).not.toContain(LOCAL_KIT_TAG);
});
test("kit persistence rejects stale sources, collisions and collection/workflow capacity without modifying source", () => {
  const { source, store, kit } = template(),
    original = structuredClone(store),
    hash = workflowFingerprint(source);
  const saved = saveLocalTemplate(store, source.id, hash, kit);
  expect(store).toEqual(original);
  expect(localKits(saved)).toEqual([kit]);
  expect(() =>
    saveLocalTemplate(
      { ...store, workflows: [{ ...source, name: "Newer" }] },
      source.id,
      hash,
      kit,
    ),
  ).toThrow(/changed/);
  expect(() =>
    saveLocalTemplate(
      {
        ...store,
        cases: [
          {
            ...prepareKit("service", "Missing reference").investigation,
            workflowIds: [kit.id],
          },
        ],
      },
      source.id,
      hash,
      kit,
    ),
  ).toThrow(/reserved/);
  const full = {
    ...store,
    workflows: [
      source,
      ...Array.from({ length: 20 }, (_, i) => ({ ...kit, id: `kit-${i}` })),
    ],
  };
  expect(() => saveLocalTemplate(full, source.id, hash, kit)).toThrow(/20/);
  expect(() =>
    saveLocalTemplate(
      {
        ...store,
        workflows: [
          source,
          ...Array.from({ length: 99 }, (_, i) => ({
            ...source,
            id: `wf-${i}`,
          })),
        ],
      },
      source.id,
      hash,
      kit,
    ),
  ).toThrow(/100/);
  const damaged = {
    ...kit,
    nodes: kit.nodes.map((n, i) =>
      i === 0 ? { ...n, config: { ...n.config, host: "site.invalid" } } : n,
    ),
  };
  expect(() => assertLocalKit(damaged)).toThrow(/concrete targets/);
  expect(
    storeSchema.parse({ ...empty(), workflows: [damaged] }).workflows[0],
  ).toEqual(damaged); // compatibility: never silently discard old edited records
});
test("local kit instances create case and playbook atomically with manual unchecked tasks; delete never damages independent instances", () => {
  const { source, store, kit } = template(),
    saved = saveLocalTemplate(
      store,
      source.id,
      workflowFingerprint(source),
      kit,
    );
  const builtins = JSON.stringify(investigationKits),
    draft = prepareFromLocalKit(kit, "Visit 2");
  const result = addKit(saved, draft);
  expect(draft.workflow.id).not.toBe(kit.id);
  expect(draft.investigation.runIds).toEqual([]);
  expect(draft.investigation.actionPlan?.every((t) => !t.done)).toBe(true);
  expect(JSON.stringify(draft.workflow)).not.toContain("secret.camera.example");
  expect(JSON.stringify(investigationKits)).toBe(builtins);
  const removed = removeLocalTemplate(result, kit.id, workflowFingerprint(kit));
  expect(removed.cases).toEqual(result.cases);
  expect(removed.workflows.some((w) => w.id === draft.workflow.id)).toBe(true);
  expect(() =>
    removeLocalTemplate(
      {
        ...result,
        cases: result.cases!.map((c) => ({ ...c, workflowIds: [kit.id] })),
      },
      kit.id,
      workflowFingerprint(kit),
    ),
  ).toThrow(/referenced/);
  expect(() =>
    removeLocalTemplate(
      {
        ...result,
        workflows: result.workflows.map((w) =>
          w.id === kit.id ? { ...w, name: "Edited" } : w,
        ),
      },
      kit.id,
      workflowFingerprint(kit),
    ),
  ).toThrow(/changed/);
  const capped = {
    ...saved,
    cases: Array.from({ length: 80 }, (_, i) => ({
      ...draft.investigation,
      workflowIds: [],
      id: `case-${i}`,
    })),
  };
  const before = JSON.stringify(capped);
  expect(() => addKit(capped, draft)).toThrow(/80/);
  expect(JSON.stringify(capped)).toBe(before);
});
function evidenceFixture() {
  const { store, kit } = template();
  const c = prepareFromLocalKit(kit, "SECRET case").investigation;
  const report = {
    id: "manual-report",
    workflow: "SECRET other workflow",
    version: "1",
    date: "2026-11-07T10:00:00.000Z",
    demo: true,
    limitations: ["SECRET limitation"],
    steps: [
      {
        nodeId: "check",
        label: "SECRET device",
        tested: "https://secret.camera.example",
        status: "failed" as const,
        duration: 22,
        output: { detail: "SECRET failure", status: 503 },
      },
    ],
  };
  return {
    c,
    report,
    store: {
      ...store,
      cases: [c],
      reports: [report],
      runWorkflows: { [report.id]: "outside-workflow" },
    },
  };
}
test("manual report attachment rechecks case/report identity and caps, retaining original mode and provenance", () => {
  const { c, report, store } = evidenceFixture(),
    before = structuredClone(store),
    next = attachCaseEvidence(store, c.id, c.created, report);
  expect(next.cases![0].runIds).toEqual([report.id]);
  expect(next.reports).toEqual(store.reports);
  expect(next.runWorkflows).toEqual(store.runWorkflows);
  expect(store).toEqual(before);
  expect(() =>
    attachCaseEvidence({ ...store, reports: [] }, c.id, c.created, report),
  ).toThrow(/expired/);
  expect(() =>
    attachCaseEvidence(
      { ...store, reports: [{ ...report, steps: [] }] },
      c.id,
      c.created,
      report,
    ),
  ).toThrow(/changed/);
  expect(() =>
    attachCaseEvidence(store, c.id, "2020-01-01T00:00:00.000Z", report),
  ).toThrow(/context/);
  expect(() => attachCaseEvidence(next, c.id, c.created, report)).toThrow(
    /already/,
  );
  expect(() =>
    attachCaseEvidence(
      { ...store, cases: [{ ...c, archived: true }] },
      c.id,
      c.created,
      report,
    ),
  ).toThrow(/archived/);
  expect(() =>
    attachCaseEvidence(
      {
        ...store,
        cases: [
          {
            ...c,
            runIds: Array.from({ length: 50 }, (_, i) => `missing-${i}`),
          },
        ],
      },
      c.id,
      c.created,
      report,
    ),
  ).toThrow(/50/);
  const unlinked = unlinkCaseEvidence(next, c.id, c.created, report.id);
  expect(unlinked.cases![0].runIds).toEqual([]);
  expect(unlinked.reports).toEqual(store.reports);
});
test("command summary distinguishes missing references, human actions and recorded evidence without inventing completion", () => {
  const { c, report, store } = evidenceFixture();
  const initial = commandOverview(c, store);
  expect(initial.evidence.available).toBe(0);
  expect(initial.checked).toBe(0);
  expect(initial.next?.done).toBe(false);
  const linked = attachCaseEvidence(store, c.id, c.created, report);
  const value = {
    ...linked.cases![0],
    runIds: [report.id, "expired"],
    profileId: "removed-profile",
  };
  const withMissing = { ...linked, cases: [value] };
  const model = commandOverview(value, withMissing);
  expect(model.status).toBe("References need review");
  expect(model.evidence.missing).toBe(1);
  expect(model.missingProfile).toBe(true);
  expect(model.evidence.failed).toBe(1);
  expect(model.checked).toBe(0);
  expect(model.evidence.latest?.demo).toBe(true);
  expect(
    commandOverview({ ...value, archived: true }, withMissing).status,
  ).toContain("Archived");
});
test("local kits round-trip through v1 backup/import, obey capacity and conflicting workflow identity, and do not leak into redacted handover", async () => {
  const { source, store, kit } = template();
  let saved = saveLocalTemplate(
    store,
    source.id,
    workflowFingerprint(source),
    kit,
  );
  const instance = prepareFromLocalKit(kit, "SECRET handover");
  saved = addKit(saved, instance);
  const evidence = evidenceFixture().report;
  saved = {
    ...saved,
    reports: [evidence],
    runWorkflows: { [evidence.id]: instance.workflow.id },
  };
  saved = attachCaseEvidence(
    saved,
    instance.investigation.id,
    instance.investigation.created,
    evidence,
  );
  const text = await createBackup(saved),
    read = await readBackup(text);
  expect(read.store).toEqual(saved);
  expect(JSON.parse(text).version).toBe(1);
  expect(localKits(read.store)).toEqual([kit]);
  const plan = planImport(empty(), read.store);
  expect(plan.error).toBe("");
  const imported = applyImport(empty(), read.store, plan.baseline);
  expect(imported.cases).toEqual(saved.cases);
  expect(imported.runWorkflows).toEqual(saved.runWorkflows);
  const conflicting = {
    ...empty(),
    workflows: [{ ...kit, name: "Local copy differs" }],
  };
  expect(
    planImport(conflicting, read.store).rows.find(
      (r) => r.type === "workflows" && r.id === kit.id,
    )?.action,
  ).toBe("conflict");
  const dossier = caseDossier(imported.cases![0], imported),
    out = JSON.stringify(dossier) + caseDossierHTML(dossier);
  for (const secret of [
    "SECRET",
    "secret.camera.example",
    kit.id,
    instance.workflow.id,
    instance.investigation.id,
    evidence.id,
  ])
    expect(out).not.toContain(secret);
  expect(out).toContain("SIMULATED");
  await expect(
    createBackup({
      ...empty(),
      workflows: Array.from({ length: 21 }, (_, i) => ({
        ...kit,
        id: `kit-${i}`,
      })),
    }),
  ).rejects.toThrow(/20/);
  expect(() =>
    applyImport(
      { ...empty(), favoriteRuns: ["changed"] },
      read.store,
      plan.baseline,
    ),
  ).toThrow(/changed since preview/);
});
