import { it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NativeStorage } from "../apps/desktop/native-storage";
import { emptyRecords } from "../packages/core/native-contract";
import { storageKeys } from "../packages/core/storage";
import { template } from "../packages/core/templates";
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
    path.join(os.tmpdir(), "fixflow-storage-"),
  );
  directories.push(directory);
  const legacy = emptyRecords();
  const workflow = template();
  legacy[storageKeys.primary] = JSON.stringify({
    version: 1,
    workflows: [workflow],
    reports: [],
  });
  return { directory, legacy, workflow, storage: new NativeStorage(directory) };
}
it("migrates exact identities, retains untouched source across ordinary saves, and rejects stale concurrent writers", async () => {
  const { directory, storage, legacy, workflow } = await fixture();
  const first = await storage.initialize(legacy);
  expect(first.migrated).toBe(true);
  expect(
    JSON.parse(
      await fs.readFile(path.join(directory, "alpha2-original.json"), "utf8"),
    ),
  ).toEqual(legacy);
  expect(JSON.parse(first.records[storageKeys.primary]!).workflows[0].id).toBe(
    workflow.id,
  );
  const [a, b] = await Promise.allSettled([
    storage.write(first.revision, first.records),
    storage.write(first.revision, first.records),
  ]);
  expect(a.status).toBe("fulfilled");
  expect(b.status).toBe("rejected");
  const reopened = await new NativeStorage(directory).initialize(
    emptyRecords(),
  );
  expect(reopened.revision).toBe(first.revision + 1);
  expect(JSON.parse(await fs.readFile(path.join(directory, "alpha2-original.json"), "utf8"))).toEqual(legacy);
});
it("recovers an fsynced pending generation after interrupted replacement and preserves corrupt active data", async () => {
  const { directory, storage, legacy } = await fixture();
  const first = await storage.initialize(legacy);
  const next = structuredClone(first.records);
  const value = JSON.parse(next[storageKeys.primary]!);
  value.workflows[0].name = "Recovered pending write";
  next[storageKeys.primary] = JSON.stringify(value);
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, "rename").mockImplementation(async (a, b) => {
    if (String(b).endsWith("state.json"))
      throw Error("injected replacement failure");
    return rename(a, b);
  });
  await expect(storage.write(first.revision, next)).rejects.toThrow();
  vi.restoreAllMocks();
  const damaged = Buffer.from([255, 0, 123]);
  await fs.writeFile(path.join(directory, "state.json"), damaged);
  const recovered = await new NativeStorage(directory).initialize(
    emptyRecords(),
  );
  expect(
    JSON.parse(recovered.records[storageKeys.primary]!).workflows[0].name,
  ).toBe("Recovered pending write");
  expect(await fs.readFile(path.join(directory, "damaged-state.json"))).toEqual(
    damaged,
  );
  const raw = JSON.parse(await new NativeStorage(directory).recovery());
  expect(Buffer.from(raw["damaged-state.json"].data, "base64")).toEqual(
    damaged,
  );
});
it("purges deleted workflows from all recoverable committed generations and preserves files when every generation is corrupt", async () => {
  const { directory, storage, legacy } = await fixture();
  const first = await storage.initialize(legacy);
  const records = structuredClone(first.records);
  records[storageKeys.backup] = records[storageKeys.primary];
  records[storageKeys.primary] = JSON.stringify({
    version: 1,
    workflows: [],
    reports: [],
  });
  await storage.write(first.revision, records);
  for (const name of ["state.json", "last-good.json"]) {
    const raw = await fs.readFile(path.join(directory, name), "utf8");
    expect(
      JSON.parse(JSON.parse(raw).records[storageKeys.primary]).workflows,
    ).toEqual([]);
    expect(
      JSON.parse(JSON.parse(raw).records[storageKeys.backup]).workflows,
    ).toEqual([]);
    await fs.writeFile(path.join(directory, name), "broken");
  }
  await expect(
    new NativeStorage(directory).initialize(emptyRecords()),
  ).rejects.toThrow("no verified recovery");
  expect(await fs.readFile(path.join(directory, "state.json"), "utf8")).toBe(
    "broken",
  );
});
it("does not replace invalid Alpha.2 data with an empty workspace and rejects unrecognized storage keys", async () => {
  const { directory, storage } = await fixture();
  const bad = { ...emptyRecords(), [storageKeys.primary]: "not json" };
  await expect(storage.initialize(bad)).rejects.toThrow("migration is blocked");
  expect(
    JSON.parse(
      await fs.readFile(path.join(directory, "alpha2-original.json"), "utf8"),
    ),
  ).toEqual(bad);
  await expect(
    new NativeStorage(directory).initialize({
      ...emptyRecords(),
      "/arbitrary/path": "bad",
    }),
  ).rejects.toThrow();
});

it("explicit reset erases damaged raw recovery files even when the active record is empty", async () => {
  const { directory } = await fixture();
  const storage = new NativeStorage(directory);
  await storage.initialize(emptyRecords());
  await fs.writeFile(
    path.join(directory, "state.json"),
    "private damaged bytes",
  );
  const recovered = new NativeStorage(directory);
  const snapshot = await recovered.initialize(emptyRecords());
  await fs.stat(path.join(directory, "damaged-state.json"));
  await recovered.write(snapshot.revision, emptyRecords());
  await expect(
    fs.stat(path.join(directory, "damaged-state.json")),
  ).rejects.toThrow();
});

it("removes only owned interrupted temporary files before opening the committed generation", async () => {
  const { directory, storage, legacy } = await fixture();
  await fs.writeFile(
    path.join(
      directory,
      "pending.json.00000000-0000-0000-0000-000000000000.tmp",
    ),
    "unconfirmed private bytes",
  );
  await fs.writeFile(path.join(directory, "unrelated.txt"), "keep");
  await storage.initialize(legacy);
  await expect(
    fs.stat(
      path.join(
        directory,
        "pending.json.00000000-0000-0000-0000-000000000000.tmp",
      ),
    ),
  ).rejects.toThrow();
  expect(await fs.readFile(path.join(directory, "unrelated.txt"), "utf8")).toBe(
    "keep",
  );
});
