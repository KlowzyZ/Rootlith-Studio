import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  MAX_RECORD_BYTES,
  recordsSchema,
  validateRecords,
  type Records,
  type NativeSnapshot,
} from "../../packages/core/native-contract";
import {
  storageKeys,
  storeSchema,
  draftSchema,
} from "../../packages/core/storage";
const envelope = z
  .object({
    format: z.literal(1),
    revision: z.number().int().nonnegative(),
    records: recordsSchema,
    digest: z.string().length(64),
  })
  .strict();
const hash = (revision: number, records: Records) =>
  createHash("sha256")
    .update(JSON.stringify({ revision, records }))
    .digest("hex");
const encode = (revision: number, records: Records) =>
  JSON.stringify({
    format: 1,
    revision,
    records,
    digest: hash(revision, records),
  });
export async function atomicWrite(file: string, data: string | Uint8Array) {
  const temp = file + "." + randomUUID() + ".tmp";
  let handle;
  try {
    handle = await fs.open(temp, "wx", 0o600);
    await handle.writeFile(data, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temp, file);
        break;
      } catch (error) {
        if (
          process.platform !== "win32" ||
          attempt >= 3 ||
          !["EPERM", "EBUSY", "EACCES"].includes(
            (error as NodeJS.ErrnoException).code || "",
          )
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    try {
      const dir = await fs.open(path.dirname(file), "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } catch (e) {
      if (process.platform !== "win32") throw e;
    }
  } finally {
    await handle?.close();
    await fs.unlink(temp).catch(() => {});
  }
}
export class NativeStorage {
  private current: NativeSnapshot | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    return next;
  }
  async drain() {
    await this.tail;
  }
  private async read(file: string) {
    const full = path.join(this.directory, file);
    const stat = await fs.stat(full);
    if (stat.size > MAX_RECORD_BYTES * 2)
      throw Error("Storage file exceeds recovery limit");
    const raw = await fs.readFile(full, "utf8");
    const value = envelope.parse(JSON.parse(raw));
    validateRecords(value.records);
    if (value.digest !== hash(value.revision, value.records))
      throw Error("Storage checksum mismatch");
    return { revision: value.revision, records: value.records };
  }
  private async commit(revision: number, records: Records) {
    const raw = encode(revision, records);
    // An fsynced pending generation is the write-ahead recovery point. Both durable copies converge before ACK.
    await atomicWrite(path.join(this.directory, "pending.json"), raw);
    await atomicWrite(path.join(this.directory, "state.json"), raw);
    await atomicWrite(path.join(this.directory, "last-good.json"), raw);
    await fs.unlink(path.join(this.directory, "pending.json"));
    this.current = { revision, records, notice: "", migrated: false };
  }
  initialize(legacy: unknown): Promise<NativeSnapshot> {
    return this.serial(async () => {
      if (this.current) return structuredClone(this.current);
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporaryPattern =
        /^(?:state|last-good|pending|alpha2-original|damaged-state|damaged-last-good|damaged-pending)\.json\.[a-f0-9-]{36}\.tmp$/;
      let cleaned = 0;
      for (const name of await fs.readdir(this.directory)) {
        if (temporaryPattern.test(name)) {
          if (++cleaned > 64)
            throw Error(
              "Too many interrupted temporary records. Existing committed data was preserved.",
            );
          await fs.unlink(path.join(this.directory, name));
        }
      }
      const candidates: { name: string; revision: number; records: Records }[] =
        [];
      const damaged: string[] = [];
      for (const name of ["state.json", "last-good.json", "pending.json"]) {
        try {
          candidates.push({ name, ...(await this.read(name)) });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT")
            damaged.push(name);
        }
      }
      if (candidates.length) {
        candidates.sort((a, b) => b.revision - a.revision);
        const chosen = candidates[0];
        if (damaged.length) {
          for (const name of damaged) {
            const stat = await fs.stat(path.join(this.directory, name));
            if (stat.size > MAX_RECORD_BYTES * 2)
              throw Error(
                "Oversized damaged storage requires manual recovery; no files were overwritten.",
              );
            const original = await fs.readFile(path.join(this.directory, name));
            const preserved = path.join(this.directory, "damaged-" + name);
            try {
              const prior = await fs.stat(preserved);
              if (
                prior.size !== original.length ||
                !(await fs.readFile(preserved)).equals(original)
              )
                throw Error(
                  "An earlier damaged recovery file already exists. Export/preserve both originals before manual recovery; no generations were overwritten.",
                );
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
              await atomicWrite(preserved, original);
            }
          }
        }
        await this.commit(chosen.revision, chosen.records);
        this.current!.notice =
          damaged.length || chosen.name !== "state.json"
            ? "Recovered native storage from a verified generation. Damaged originals were retained for recovery export."
            : "";
        return structuredClone(this.current!);
      }
      if (damaged.length)
        throw Error(
          "Native storage is damaged and no verified recovery generation exists. Existing files were preserved. Contact support or export the fixed recovery files before restoring a backup.",
        );
      const original = recordsSchema.parse(legacy);
      if (
        new TextEncoder().encode(JSON.stringify(original)).length >
        MAX_RECORD_BYTES
      )
        throw Error(
          "Legacy migration exceeds 8 MB. Original data was preserved.",
        );
      // A failed initial migration can be resumed from its untouched copy even if the renderer is later empty.
      let source = original;
      const migrationFile = path.join(this.directory, "alpha2-original.json");
      try {
        const stat = await fs.stat(migrationFile);
        if (stat.size > MAX_RECORD_BYTES)
          throw Error("Oversized migration recovery");
        source = recordsSchema.parse(
          JSON.parse(await fs.readFile(migrationFile, "utf8")),
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        await atomicWrite(migrationFile, JSON.stringify(original));
      }
      const records = { ...source };
      let notice = "";
      for (const key of [storageKeys.primary, storageKeys.backup])
        if (records[key] !== null) {
          try {
            storeSchema.parse(JSON.parse(records[key]!));
          } catch {
            records[storageKeys.quarantine] = records[key];
            records[key] = null;
            notice =
              "Alpha.2 had damaged records. An untouched migration copy was preserved; only validated records were migrated.";
          }
        }
      if (
        records[storageKeys.primary] === null &&
        records[storageKeys.backup] !== null
      )
        records[storageKeys.primary] = records[storageKeys.backup];
      if (records[storageKeys.draft] !== null) {
        try {
          draftSchema.parse(JSON.parse(records[storageKeys.draft]!));
        } catch {
          records[storageKeys.draft] = null;
          notice =
            "A damaged Alpha.2 draft was preserved in the migration recovery copy.";
        }
      }
      if (
        source[storageKeys.primary] !== null &&
        records[storageKeys.primary] === null
      )
        throw Error(
          "Alpha.2 migration has no valid primary or backup. Untouched recovery data was preserved; migration is blocked.",
        );
      validateRecords(records);
      await this.commit(1, records);
      this.current!.migrated = true;
      this.current!.notice =
        notice ||
        (Object.values(source).some((v) => v !== null)
          ? "Alpha.2 data migrated to verified native storage."
          : "Native storage is ready.");
      return structuredClone(this.current!);
    });
  }
  write(expected: number, input: unknown): Promise<NativeSnapshot> {
    return this.serial(async () => {
      if (!this.current) throw Error("Storage is not initialized");
      if (expected !== this.current.revision)
        throw Error(
          "Storage revision conflict. Reload before saving; newer data was preserved.",
        );
      const records = validateRecords(input);
      // Prune compatible backup records, but retain raw quarantine/recovery
      // evidence until the user explicitly resets. Retention eviction is not reset.
      if (records[storageKeys.backup]) {
        const after = records[storageKeys.primary]
          ? storeSchema.parse(JSON.parse(records[storageKeys.primary]!))
          : undefined;
        const keepWorkflows = new Set(after?.workflows.map((w) => w.id) || []),
          keepReports = new Set(after?.reports.map((r) => r.id) || []);
        const backup = storeSchema.parse(
          JSON.parse(records[storageKeys.backup]!),
        );
        records[storageKeys.backup] = JSON.stringify({
          ...backup,
          workflows: backup.workflows.filter((w) => keepWorkflows.has(w.id)),
          reports: backup.reports.filter((r) => keepReports.has(r.id)),
        });
      }
      try {
        await this.commit(expected + 1, records);
      } catch {
        this.current = undefined;
        throw Error(
          "Native write could not be confirmed. Reopen the workspace to recover the verified pending generation.",
        );
      }
      // Destructive reset cleanup follows durable replacement, never precedes it.
      if (Object.values(records).every((v) => v === null)) {
        // The original migration snapshot is recovery evidence too. Preserve
        // it during ordinary saves, retention eviction and case edits.
        for (const name of [
          "damaged-state.json",
          "damaged-last-good.json",
          "damaged-pending.json",
          "alpha2-original.json",
        ])
          await fs.unlink(path.join(this.directory, name)).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
      }
      return structuredClone(this.current!);
    });
  }
  recovery(): Promise<string> {
    return this.serial(async () => {
      const files: Record<string, { encoding: "base64"; data: string }> = {};
      for (const name of [
        "state.json",
        "last-good.json",
        "pending.json",
        "alpha2-original.json",
        "damaged-state.json",
        "damaged-last-good.json",
        "damaged-pending.json",
      ]) {
        try {
          const stat = await fs.stat(path.join(this.directory, name));
          if (stat.size <= MAX_RECORD_BYTES * 2)
            files[name] = {
              encoding: "base64",
              data: (
                await fs.readFile(path.join(this.directory, name))
              ).toString("base64"),
            };
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
      return JSON.stringify(files, null, 2);
    });
  }
}
