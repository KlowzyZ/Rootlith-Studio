import { expect, test } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadUpdateState, saveUpdateState } from "../apps/desktop/update-state";
import { defaultUpdateState } from "../packages/core/update-controller";
test("update preference writes preserve exact workspace and migration/recovery bytes", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "rootlith-updates-"),
  );
  try {
    const sentinels = [
      "state.json",
      "last-good.json",
      "alpha2-original.json",
      "damaged-state.json",
    ];
    for (const name of sentinels)
      await fs.writeFile(
        path.join(directory, name),
        "private evidence sentinel",
      );
    const file = path.join(directory, "update-preferences.json");
    expect((await loadUpdateState(file, "1.0.0")).includePreviews).toBe(false);
    const prefs = { ...defaultUpdateState("0.13.0-alpha.1"), automatic: false };
    await saveUpdateState(file, prefs);
    expect(await loadUpdateState(file, "0.13.0-alpha.1")).toEqual(prefs);
    for (const name of sentinels)
      expect(await fs.readFile(path.join(directory, name), "utf8")).toBe(
        "private evidence sentinel",
      );
    await fs.writeFile(file, '{"automatic":true}');
    expect((await loadUpdateState(file, "1.0.0")).automatic).toBe(false);
    expect(await fs.readFile(file, "utf8")).toBe('{"automatic":true}');
    await fs.writeFile(file, "x".repeat(65537));
    expect((await loadUpdateState(file, "1.0.0")).automatic).toBe(false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
