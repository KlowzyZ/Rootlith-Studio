import { z } from "zod";
import { quickTarget } from "./quick-target";
import { template } from "./templates";
export const profileSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    name: z.string().trim().min(1).max(80),
    host: z.string().trim().max(253),
    port: z.string().trim().max(5),
    url: z.string().trim().max(2048),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      quickTarget({ ...template(), nodes: [] }, value);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
    }
  });
export type TargetProfile = z.infer<typeof profileSchema>;
export function putProfile(profiles: TargetProfile[], input: TargetProfile) {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) throw Error(parsed.error.issues[0].message);
  const profile = parsed.data;
  const next = [...profiles.filter((p) => p.id !== profile.id), profile];
  if (next.length > 40)
    throw Error(
      "Target profile limit reached (40). Delete an unused profile first.",
    );
  return next;
}
