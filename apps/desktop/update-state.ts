import { promises as fs } from "node:fs";
import { z } from "zod";
import { atomicWrite } from "./native-storage";
import {
  defaultUpdateState,
  type SavedUpdateState,
} from "../../packages/core/update-controller";
import { isOfficialReleaseUrl } from "../../packages/core/project";
import { parseVersion } from "../../packages/core/updates";
const stateSchema = z
  .object({
    format: z.literal(1),
    automatic: z.boolean(),
    includePreviews: z.boolean(),
    lastSuccess: z.string().datetime().optional(),
    lastNotified: z
      .string()
      .max(96)
      .refine((v) => {
        try {
          parseVersion(v);
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
    publication: z
      .object({
        version: z.string().max(96),
        name: z.string().max(160),
        url: z.string().max(256).refine(isOfficialReleaseUrl),
        publishedAt: z.string().datetime(),
        notes: z.string().max(12000),
      })
      .strict()
      .optional(),
    retryAt: z.number().finite().nonnegative().max(8640000000000000).optional(),
    nextCheck: z
      .number()
      .finite()
      .nonnegative()
      .max(8640000000000000)
      .optional(),
  })
  .strict();
// Fixed main-owned record, separate from legacy investigation storage/migration/reset.
export async function loadUpdateState(
  file: string,
  version: string,
): Promise<SavedUpdateState> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 65536)
      throw Error("Oversized update preferences");
    const state = stateSchema.parse(
      JSON.parse(await fs.readFile(file, "utf8")),
    );
    // Do not trust arbitrary future times in a damaged local file to suppress checks.
    if (state.nextCheck && state.nextCheck > Date.now() + 86400000)
      state.nextCheck = undefined;
    return state;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return defaultUpdateState(version);
    // Preserve damaged files and keep networking off until an explicit preference save.
    return { ...defaultUpdateState(version), automatic: false };
  }
}
export async function saveUpdateState(file: string, state: SavedUpdateState) {
  await atomicWrite(file, JSON.stringify(stateSchema.parse(state)));
}
