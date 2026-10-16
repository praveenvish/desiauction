import { z } from "zod";
const proof = z
  .object({ s: z.string().min(1).max(128).optional(), t: z.string().min(1).max(128).optional() })
  .strict();
const subscription = z
  .object({
    t: z.literal("sub"),
    fixtureId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    gate: proof,
  })
  .strict();
export function parseSubscription(raw: string) {
  try {
    const value = subscription.safeParse(JSON.parse(raw));
    return value.success ? value.data : null;
  } catch {
    return null;
  }
}
