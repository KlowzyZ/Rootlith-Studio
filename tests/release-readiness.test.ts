import { afterEach, expect, test, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { caseDossier, caseDossierHTML } from "../packages/core/case-export";
import {
  filterCases,
  caseOverview,
  localDate,
  type InvestigationCase,
} from "../packages/core/cases";
import {
  load,
  save,
  stageDraft,
  draftRecord,
  primaryRecord,
  useStoragePort,
  storageKeys,
  type Store,
} from "../packages/core/storage";
import { workspaceWriter } from "../packages/core/workspace-writer";
import { saveExport } from "../apps/desktop/export-file";
import { NativeStorage, atomicWrite } from "../apps/desktop/native-storage";
import { emptyRecords } from "../packages/core/native-contract";
import { template } from "../packages/core/templates";
const value: InvestigationCase = {
  id: "private-case",
  name: "Private name <script>alert(1)</script> $&",
  note: 'Private note </pre><img src="https://private.invalid/x" onerror="alert(1)">',
  profileId: "private-profile",
  workflowIds: ["private-workflow", "missing-workflow"],
  runIds: ["private-run", "missing-run"],
  created: "2026-11-07T10:00:00Z",
  updated: "2026-11-07T11:00:00Z",
  archived: false,
};
const workspace = (): Store => ({
  version: 1,
  workflows: [
    { ...template(), id: "private-workflow", name: "Private playbook" },
  ],
  cases: [value],
  targetProfiles: [
    {
      id: "private-profile",
      name: "Private profile",
      host: "192.168.9.7",
      port: "8001",
      url: "http://192.168.9.7:8001",
    },
  ],
  favoriteRuns: ["private-run"],
  reports: [
    {
      id: "private-run",
      workflow: "Private report",
      version: "1",
      date: "2026-11-07T11:00:00Z",
      demo: true,
      limitations: ["Private authored limitation"],
      steps: [
        {
          nodeId: "private-node",
          label: "Private node",
          tested: "http://192.168.9.7:8001",
          status: "failed",
          duration: 25,
          output: {
            detail: "Private detail <svg onload=alert(1)>",
            status: 503,
          },
        },
      ],
    },
  ],
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test("default dossier withholds authored identifiers, notes and evidence; preserves modes, real counts and missing references", () => {
  const store = workspace(),
    snapshot = structuredClone(store),
    dossier = caseDossier(value, store);
  for (const text of [JSON.stringify(dossier), caseDossierHTML(dossier)]) {
    for (const privateValue of [
      "Private",
      "private-case",
      "private-run",
      "private-workflow",
      "private-node",
      "private-profile",
      "192.168.9.7",
      "2026-11-07",
      "missing-run",
      "missing-workflow",
      "alert(1)",
    ])
      expect(text).not.toContain(privateValue);
    expect(text).toContain("SIMULATED DEMO");
    expect(text).toContain("unavailable");
  }
  expect(dossier.runs[0]).toMatchObject({
    counts: { failed: 1 },
    observations: [{ duration: 25 }],
  });
  expect(dossier.runs[1].mode).toBeUndefined();
  expect(store).toEqual(snapshot);
  store.reports[0].demo = false;
  expect(caseDossier(value, store).runs[0].mode).toBe("NATIVE");
});
test("reviewed HTML escapes authored content and replacement metacharacters without executable or remote elements", () => {
  const dossier = caseDossier(value, workspace(), true),
    html = caseDossierHTML(dossier);
  expect(dossier.case.note).toBe(value.note);
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; $&");
  expect(html).toContain("&lt;img src=&quot;https://private.invalid/x&quot;");
  expect(html).not.toMatch(/<(script|img|svg|iframe|form|a|link)\b/i);
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("Private playbook");
});
test("case search/filter/order is deterministic and invalid report dates are honest", () => {
  const store = workspace(),
    archived = {
      ...value,
      id: "archived",
      name: "Archived",
      archived: true,
      updated: "2026-11-07T12:00:00Z",
    };
  expect(
    filterCases(
      [value, archived],
      store,
      "private playbook",
      "active",
      "newest",
    ).map((c) => c.id),
  ).toEqual([value.id]);
  expect(filterCases([value, archived], store, "", "all", "newest")[0].id).toBe(
    "archived",
  );
  expect(
    filterCases([value, archived], store, "", "archived", "oldest"),
  ).toEqual([archived]);
  expect(filterCases([value], store, "no match", "all", "newest")).toEqual([]);
  expect(localDate("[withheld]")).toBe("Date unavailable");
  store.reports = [
    { ...store.reports[0], id: "older", date: "2025-01-01T00:00:00Z" },
    { ...store.reports[0], id: "invalid", date: "[withheld]" },
    ...store.reports,
  ];
  expect(
    caseOverview(
      { ...value, runIds: ["older", "invalid", "private-run"] },
      store,
    ).latest?.id,
  ).toBe("private-run");
  expect(
    caseOverview({ ...value, runIds: ["invalid"] }, store).latest,
  ).toBeUndefined();
});
test("writer retains journal until primary ACK, preserves edits during save, and freezes pending reducers on failed ACK", async () => {
  const records = new Map<string, string>();
  useStoragePort({
    getItem: (k) => records.get(k) ?? null,
    setItem: (k, v) => {
      records.set(k, v);
    },
    removeItem: (k) => {
      records.delete(k);
    },
  });
  save(workspace());
  const expected = { current: primaryRecord() },
    workflow = load().workflows[0];
  stageDraft(workflow, expected.current);
  const raw = draftRecord();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const committed = vi.fn(),
    failed = vi.fn();
  const flush = vi
    .fn()
    .mockResolvedValue(undefined)
    .mockImplementationOnce(async () => {})
    .mockImplementationOnce(() => held);
  const writer = workspaceWriter({
    expected,
    flush,
    committed,
    failed,
    pending: () => {},
  });
  const first = writer.update((s) => ({ ...s, favoriteRuns: [] }), {
    id: workflow.id,
    raw,
  });
  const second = writer.update((s) => ({
    ...s,
    cases: [{ ...s.cases![0], archived: true }],
  }));
  await vi.waitFor(() => expect(flush).toHaveBeenCalledTimes(2));
  expect(draftRecord()).toBe(raw);
  expect(committed).not.toHaveBeenCalled();
  stageDraft({ ...workflow, name: "Newer canvas" }, expected.current);
  release();
  await Promise.all([first, second]);
  await writer.idle();
  expect(JSON.parse(draftRecord()!).workflow.name).toBe("Newer canvas");
  expect(load().favoriteRuns).toEqual([]);
  expect(load().cases![0].archived).toBe(true);
  const broken = workspaceWriter({
    expected,
    flush: vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(Error("disk full")),
    committed,
    failed,
    pending: () => {},
  });
  const journal = draftRecord();
  committed.mockClear();
  await expect(
    broken.update((s) => ({ ...s, favoriteRuns: ["private-run"] }), {
      id: workflow.id,
      raw: journal,
    }),
  ).rejects.toThrow("disk full");
  await expect(broken.update((s) => ({ ...s, cases: [] }))).rejects.toThrow(
    "disk full",
  );
  expect(draftRecord()).toBe(journal);
  expect(committed).not.toHaveBeenCalled();
  await expect(broken.idle()).rejects.toThrow("disk full");
});
test("native Save boundary preserves exact dossier bytes, cancel makes no write, and file failures never acknowledge success", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "rootlith-dossier-"),
  );
  try {
    const content = caseDossierHTML(caseDossier(value, workspace()));
    const destination = path.join(directory, "case.html"),
      write = vi.fn(atomicWrite);
    expect(
      await saveExport(
        { name: "case.html", content, type: "text/html" },
        async () => ({ canceled: true, filePath: destination }),
        write,
      ),
    ).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(
      await saveExport(
        { name: "case.html", content, type: "text/html" },
        async () => ({ canceled: false, filePath: destination }),
        write,
      ),
    ).toBe(true);
    expect(await fs.readFile(destination, "utf8")).toBe(content);
    await expect(
      saveExport(
        { name: "case.html", content, type: "text/html" },
        async () => ({ canceled: false, filePath: destination + ".json" }),
        write,
      ),
    ).rejects.toThrow(/matching export extension/);
    await expect(
      saveExport(
        { name: "case.html", content, type: "text/html" },
        async () => ({ canceled: false, filePath: destination }),
        async () => {
          throw Error("ENOSPC");
        },
      ),
    ).rejects.toThrow("ENOSPC");
    await expect(
      saveExport(
        { name: "../escape.html", content, type: "text/html" },
        async () => ({ canceled: false, filePath: destination }),
        write,
      ),
    ).rejects.toThrow();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("v1 native profile/case/favorite data survives rejected writes and restart recovery without migration changes", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "rootlith-v06-storage-"),
  );
  try {
    const records = {
      ...emptyRecords(),
      [storageKeys.primary]: JSON.stringify(workspace()),
    };
    const storage = new NativeStorage(directory),
      initial = await storage.initialize(records);
    const next = structuredClone(initial.records);
    next[storageKeys.primary] = JSON.stringify({
      ...workspace(),
      cases: [{ ...value, note: "Recovered note" }],
    });
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith("state.json"))
        throw Error("Injected disk failure");
      return rename(from, to);
    });
    await expect(storage.write(initial.revision, next)).rejects.toThrow(
      /could not be confirmed/,
    );
    vi.restoreAllMocks();
    const restarted = new NativeStorage(directory);
    const recovered = await restarted.initialize(emptyRecords());
    const store = JSON.parse(recovered.records[storageKeys.primary]!);
    expect(store.cases[0].note).toBe("Recovered note");
    expect(store.workflows[0].id).toBe("private-workflow");
    expect(store.favoriteRuns).toEqual(["private-run"]);
    expect(store.targetProfiles).toEqual(workspace().targetProfiles);
    expect(store.version).toBe(1);
    await expect(restarted.write(initial.revision, records)).rejects.toThrow();
  } finally {
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
