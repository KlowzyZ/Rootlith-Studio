import { expect, test, vi } from "vitest";
// Exercises the actual native bridge adapter, with controllable IPC ACK timing.
test("flush fences a draft staged in the drain/finally gap and poisons all callers after a failed ACK", async () => {
  vi.resetModules();
  const { emptyRecords } = await import("../packages/core/native-contract");
  const { storageKeys, stageDraft, load, save } =
    await import("../packages/core/storage");
  const { template } = await import("../packages/core/templates");
  const records = {
    ...emptyRecords(),
    [storageKeys.primary]: JSON.stringify({
      version: 1,
      workflows: [template()],
      reports: [],
    }),
  };
  let resolve!: (value: unknown) => void;
  const gate = new Promise((r) => {
    resolve = r;
  });
  const writes: { revision: number; records: typeof records }[] = [];
  const storageWrite = vi.fn(
    async (input: { revision: number; records: typeof records }) => {
      writes.push(structuredClone(input));
      if (writes.length === 1) await gate;
      return { ...input, revision: input.revision + 1 };
    },
  );
  vi.stubGlobal("localStorage", { getItem: () => null, removeItem: () => {} });
  vi.stubGlobal("window", {
    fixflow: {
      storageInitialize: async () => ({
        records,
        revision: 0,
        notice: "",
        migrated: false,
      }),
      storageWrite,
    },
  });
  try {
    const client = await import("../packages/core/desktop-client");
    await client.initializeDesktop();
    stageDraft(load().workflows[0]);
    const first = client.flushDesktop();
    const second = gate.then(() => {
      stageDraft({ ...load().workflows[0], name: "Gap edit" });
      return client.flushDesktop();
    });
    resolve(undefined);
    await Promise.all([first, second]);
    expect(writes).toHaveLength(2);
    expect(
      JSON.parse(writes[1].records[storageKeys.draft]!).workflow.name,
    ).toBe("Gap edit");
    storageWrite.mockRejectedValueOnce(Error("Native disk failure"));
    save({ ...load(), favoriteRuns: [] });
    await expect(client.flushDesktop()).rejects.toThrow("Native disk failure");
    await expect(client.flushDesktop()).rejects.toThrow("Native disk failure");
    expect(storageWrite).toHaveBeenCalledTimes(3);
  } finally {
    vi.unstubAllGlobals();
  }
});
