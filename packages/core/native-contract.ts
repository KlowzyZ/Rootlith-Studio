import { z } from "zod";
import { storageKeys, storeSchema, draftSchema } from "./storage";
export const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const raw = z.string().max(MAX_RECORD_BYTES).nullable();
export const recordsSchema = z
  .object({
    "fixflow-v1": raw,
    "fixflow-v1-backup": raw,
    "fixflow-draft-v1": raw,
    "fixflow-quarantine-v1": raw,
  })
  .strict();
export type Records = z.infer<typeof recordsSchema>;
export const emptyRecords = (): Records =>
  Object.fromEntries(
    Object.values(storageKeys).map((k) => [k, null]),
  ) as Records;
export function validateRecords(input: unknown): Records {
  const records = recordsSchema.parse(input);
  if (BufferSize(JSON.stringify(records)) > MAX_RECORD_BYTES)
    throw Error(
      "Storage exceeds the 8 MB limit. Export and remove unused data.",
    );
  for (const key of [storageKeys.primary, storageKeys.backup])
    if (records[key] !== null) storeSchema.parse(JSON.parse(records[key]!));
  if (records[storageKeys.draft] !== null)
    draftSchema.parse(JSON.parse(records[storageKeys.draft]!));
  return records;
}
function BufferSize(s: string) {
  return new TextEncoder().encode(s).length;
}
export type NativeSnapshot = {
  revision: number;
  records: Records;
  notice: string;
  migrated: boolean;
};
export const commitSchema = z
  .object({ revision: z.number().int().nonnegative(), records: recordsSchema })
  .strict();
export const exportSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9 _.-]{1,120}\.(json|html)$/),
    content: z.string().max(MAX_RECORD_BYTES),
    type: z.enum(["application/json", "text/html"]),
  })
  .strict();
