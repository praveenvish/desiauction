import { auditLog, newId, type Db } from "@desiauction/db";
import { and, eq, gt, sql } from "drizzle-orm";

/**
 * HOW MANY UPLOAD URLS ONE PERSON MAY MINT IN AN HOUR (go-live gate P0-6 c).
 *
 * A presigned URL is a five-minute licence to write 5 MB into the public
 * bucket, and nothing counted them: one signed-in account could loop the
 * action and fill the bucket (and the bill) at wire speed. The self-photo path
 * needs nothing but a login and a season with registration open.
 *
 * Same mechanism as the other throttles here (problem reports, newsletter,
 * OTP): count this person's own rows in the last hour. There is no table of
 * presigns, so each one is written to `audit_log` — scoped to the PERSON, so
 * the RLS write check holds on the self path where the caller is no member of
 * the org — and counted back on `audit_log_actor_at_idx`.
 *
 * Two budgets, by path. An organizer's bulk photo import presigns one URL per
 * player, sequentially, and a big season has a couple of hundred; a player
 * setting their own face needs a handful of retries at most.
 */

const HOUR_MS = 60 * 60 * 1000;

export const PRESIGN_QUOTAS = {
  /** `requestMediaUpload` — organizer desks, bulk photo import included. */
  "media.upload_requested": 300,
  /** `requestOwnPhotoUpload` — a player's own face at registration. */
  "media.own_upload_requested": 20,
} as const;

export type PresignAction = keyof typeof PRESIGN_QUOTAS;

/**
 * Record one presign against `personId`, or refuse (false) when the hour's
 * budget is already spent. Run it inside the caller's tenant transaction.
 */
export async function takePresignQuota(
  db: Db,
  personId: string,
  action: PresignAction,
  meta: Record<string, string>,
  now: Date = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - HOUR_MS);
  const [row] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(
      and(eq(auditLog.actor, personId), eq(auditLog.action, action), gt(auditLog.at, since)),
    )) as [{ count: number }];
  if (row.count >= PRESIGN_QUOTAS[action]) {
    return false;
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action,
    scopeType: "person",
    scopeId: personId,
    meta,
    at: now,
  });
  return true;
}
