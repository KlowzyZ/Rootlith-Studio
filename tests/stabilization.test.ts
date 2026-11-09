import { prepareWorkspaceClose } from "../packages/core/workspace-close";
import { expect, test, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NativeStorage } from "../apps/desktop/native-storage";
import { emptyRecords } from "../packages/core/native-contract";
import { storageKeys, type Store } from "../packages/core/storage";
import { prepareKit, addKit } from "../packages/core/investigation-kits";
import { beginCaseSession, recordCaseRun } from "../packages/core/case-session";
import { caseDossier, caseDossierHTML } from "../packages/core/case-export";
import { updateActionPlan } from "../packages/core/action-plan";
import {
  createBackup,
  readBackup,
  planImport,
  applyImport,
} from "../packages/core/workspace-backup";
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "rootlith-stabilization-"),
  );
  directories.push(directory);
  const kit = prepareKit("network", "SECRET investigation");
  const store = addKit({ version: 1, workflows: [], reports: [] }, kit);
  const report = (id: string) => ({
    id,
    workflow: kit.workflow.name,
    version: "1",
    date: "2026-11-07T10:00:00.000Z",
    demo: true,
    steps: [],
    limitations: ["SIMULATED fixture"],
  });
  store.reports = Array.from({ length: 50 }, (_, i) => report(`run${i}`));
  const records = {
    ...emptyRecords(),
    [storageKeys.primary]: JSON.stringify(store),
    [storageKeys.quarantine]: "quarantine-original",
  };
  const storage = new NativeStorage(directory);
  const snapshot = await storage.initialize(records);
  await fs.writeFile(
    path.join(directory, "damaged-state.json"),
    "retained-corrupt-original",
  );
  return { directory, kit, store, report, storage, snapshot };
}
test("automatic 50-report eviction retains quarantine and damaged originals through native ACK and restart", async () => {
  const f = await fixture();
  const migration = await fs.readFile(
    path.join(f.directory, "alpha2-original.json"),
    "utf8",
  );
  const next = recordCaseRun(
    f.store,
    f.kit.workflow,
    f.report("next-run"),
    beginCaseSession(f.store, f.kit.investigation.id, f.kit.workflow.id),
  );
  const state = await f.storage.write(f.snapshot.revision, {
    ...f.snapshot.records,
    [storageKeys.backup]: f.snapshot.records[storageKeys.primary],
    [storageKeys.primary]: JSON.stringify(next),
  });
  expect(state.records[storageKeys.quarantine]).toBe("quarantine-original");
  expect(
    await fs.readFile(path.join(f.directory, "damaged-state.json"), "utf8"),
  ).toBe("retained-corrupt-original");
  expect(
    await fs.readFile(path.join(f.directory, "alpha2-original.json"), "utf8"),
  ).toBe(migration);
  const restarted = await new NativeStorage(f.directory).initialize(
    emptyRecords(),
  );
  expect(restarted.records[storageKeys.quarantine]).toBe("quarantine-original");
  const saved = JSON.parse(restarted.records[storageKeys.primary]!);
  expect(saved.reports).toHaveLength(50);
  expect(saved.reports[0].id).toBe("next-run");
  expect(saved.cases[0].runIds).toContain("next-run");
  const backup = JSON.parse(restarted.records[storageKeys.backup]!);
  expect(backup.reports.some((r: { id: string }) => r.id === "run49")).toBe(
    false,
  );
});
test("failed explicit reset cannot erase damaged recovery originals before commit acknowledgment", async () => {
  const f = await fixture();
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, "rename").mockImplementation(async (a, b) => {
    if (String(b).endsWith("pending.json"))
      throw Error("injected disk failure");
    return rename(a, b);
  });
  await expect(
    f.storage.write(f.snapshot.revision, emptyRecords()),
  ).rejects.toThrow();
  expect(
    await fs.readFile(path.join(f.directory, "damaged-state.json"), "utf8"),
  ).toBe("retained-corrupt-original");
  expect(
    await fs.readFile(path.join(f.directory, "alpha2-original.json"), "utf8"),
  ).toContain("SECRET investigation");
  vi.restoreAllMocks();
  const restart = await new NativeStorage(f.directory).initialize(
    emptyRecords(),
  );
  expect(restart.records[storageKeys.primary]).toBe(
    f.snapshot.records[storageKeys.primary],
  );
  const reset = await new NativeStorage(f.directory).initialize(emptyRecords());
  const storage = new NativeStorage(f.directory);
  await storage.initialize(emptyRecords());
  await storage.write(reset.revision, emptyRecords());
  await expect(
    fs.stat(path.join(f.directory, "damaged-state.json")),
  ).rejects.toThrow();
  await expect(
    fs.stat(path.join(f.directory, "alpha2-original.json")),
  ).rejects.toThrow();
});
test("repeated corruption must not overwrite an earlier damaged generation during automatic recovery", async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.directory, "state.json"), "second-corruption");
  await expect(
    new NativeStorage(f.directory).initialize(emptyRecords()),
  ).rejects.toThrow(/already|preserv/i);
  expect(
    await fs.readFile(path.join(f.directory, "damaged-state.json"), "utf8"),
  ).toBe("retained-corrupt-original");
  expect(await fs.readFile(path.join(f.directory, "state.json"), "utf8")).toBe(
    "second-corruption",
  );
  expect(
    await fs.readFile(path.join(f.directory, "last-good.json"), "utf8"),
  ).toContain("SECRET investigation");
});
test("legacy records, action plan and actual HTML/JSON redaction survive transfer and stale import is rejected", async () => {
  const legacy = {
    id: "legacy",
    name: "SECRET legacy",
    note: "SECRET old note",
    workflowIds: [],
    runIds: ["missing"],
    archived: true,
    created: "2020-01-01T00:00:00.000Z",
    updated: "2020-01-01T00:00:00.000Z",
  };
  const kit = prepareKit("camera", "SECRET camera.example");
  kit.investigation.note = "SECRET author note";
  const s = addKit(
    { version: 1, workflows: [], reports: [], cases: [legacy] },
    kit,
  );
  const value = s.cases!.find((c) => c.id === kit.investigation.id)!;
  value.actionPlan![0].title = "SECRET task camera.example";
  value.actionPlan![0].comment = "SECRET raw detail";
  value.actionPlan![0].recordedBy = "SECRET author";
  const changed = updateActionPlan(s, value.id, value.created, {
    kind: "toggle",
    id: value.actionPlan![0].id,
  });
  // Exercise the actual persisted representation (including legacy absence of optional fields).
  const persisted: Store = JSON.parse(JSON.stringify(changed));
  const parsed = await readBackup(await createBackup(persisted));
  expect(parsed.store).toEqual(persisted);
  expect(parsed.store.cases!.find((c) => c.id === "legacy")).not.toHaveProperty(
    "actionPlan",
  );
  const empty: Store = { version: 1, workflows: [], reports: [] };
  const plan = planImport(empty, parsed.store);
  expect(plan.error).toBe("");
  const transferred = applyImport(empty, parsed.store, plan.baseline);
  expect(transferred.cases).toEqual(persisted.cases);
  const c = transferred.cases!.find((c) => c.id === value.id)!;
  const result = caseDossier(c, transferred);
  const payload = JSON.stringify(result) + caseDossierHTML(result);
  for (const secret of [
    "SECRET",
    "camera.example",
    c.id,
    c.created,
    c.actionPlan![0].id,
    c.actionPlan![0].created,
  ])
    expect(payload).not.toContain(secret);
  expect(() =>
    applyImport({ ...empty, cases: [legacy] }, parsed.store, plan.baseline),
  ).toThrow(/changed since preview/);
});

test("close cannot acknowledge a run paused at a guided question or approval, or an edit during drain", async () => {
  const stage = vi.fn(),
    drain = vi.fn(async () => {}),
    flush = vi.fn(async () => {});
  const options = {
    activeRun: () => true,
    blocked: () => false,
    unsavedForm: () => false,
    version: () => 1,
    stage,
    drain,
    flush,
  };
  // A guided question/native approval has a live renderer run but no active probe IPC.
  expect(await prepareWorkspaceClose(options)).toBe(false);
  expect(stage).not.toHaveBeenCalled();
  expect(
    await prepareWorkspaceClose({ ...options, activeRun: () => false }),
  ).toBe(true);
  let version = 1;
  expect(
    await prepareWorkspaceClose({
      ...options,
      activeRun: () => false,
      version: () => version,
      drain: async () => {
        version++;
      },
    }),
  ).toBe(false);
  let form = false;
  expect(
    await prepareWorkspaceClose({
      ...options,
      activeRun: () => false,
      unsavedForm: () => form,
      drain: async () => {
        form = true;
      },
    }),
  ).toBe(false);
  expect(
    await prepareWorkspaceClose({
      ...options,
      activeRun: () => false,
      flush: async () => {
        throw Error("ACK rejected");
      },
    }),
  ).toBe(false);
});
