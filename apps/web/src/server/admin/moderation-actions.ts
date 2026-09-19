"use server";

import { revalidatePath } from "next/cache";

import { systemDb } from "../db";
import { logger } from "../logger";
import {
  HOLD_REASON_MAX,
  HOLD_REASON_MIN,
  holdSeason,
  liftSeasonHold,
  type HoldOutcome,
} from "../moderation/season-hold";
import { inOrg } from "../tenant";
import { platformModerationGate } from "./authz";
import { platformSeasonBySlug } from "./season-lookup";

/**
 * THE MODERATION DESK, write — `platform:moderation` only.
 *
 * The write itself lives in server/moderation/season-hold.ts, outside this
 * folder, for the reason every desk's does: the runtime proof that
 * administration's projections cannot mutate keeps holding everything here.
 *
 * It runs on the APPLICATION role inside the season's own tenant boundary, not
 * on the system pool. `competitions` is under RLS and the system role has no
 * UPDATE on it; the boundary names the club, the moderation gate ran first. The
 * system pool is used for one read only — slug to club — which a platform
 * operator, a member of no club, cannot answer any other way.
 */

export type ModerationResult = { ok: true; message: string } | { ok: false; error: string };

const REFUSALS: Record<Extract<HoldOutcome, { ok: false }>["reason"], string> = {
  unknown_season: "That season no longer exists.",
  already_held: "That page is already taken down.",
  not_held: "That page is not taken down.",
  invalid_reason: `Give a reason between ${String(HOLD_REASON_MIN)} and ${String(HOLD_REASON_MAX)} characters — the organizer reads it.`,
};

/**
 * Everything a stranger could read about a season, dropped from every cache at
 * once. `layout` reaches the player pages and the share cards beneath /c/[slug].
 */
function revalidatePublicSurfaces(slug: string): void {
  revalidatePath(`/c/${slug}`, "layout");
  revalidatePath("/c");
  revalidatePath("/");
  revalidatePath("/sitemap.xml");
  revalidatePath("/admin/moderation");
}

export async function takeDownSeason(slug: string, reason: string): Promise<ModerationResult> {
  const operator = await platformModerationGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  const season = await platformSeasonBySlug(systemDb, slug);
  if (season === null) {
    return { ok: false, error: REFUSALS.unknown_season };
  }
  const outcome = await inOrg(operator.personId, season.orgId, (db) =>
    holdSeason(db, { competitionId: season.id, actorId: operator.personId, reason }),
  );
  if (!outcome.ok) {
    return { ok: false, error: REFUSALS[outcome.reason] };
  }
  logger().info({ slug, operator: operator.personId }, "moderation.season_held");
  revalidatePublicSurfaces(outcome.slug);
  return {
    ok: true,
    message: outcome.wasPublic
      ? `${season.name} is off the public web. The organizer sees why.`
      : `${season.name} is held — it was not public, and now it cannot be published.`,
  };
}

export async function liftSeasonHoldAction(slug: string, note: string): Promise<ModerationResult> {
  const operator = await platformModerationGate();
  if (operator === null) {
    return { ok: false, error: "Not available." };
  }
  const season = await platformSeasonBySlug(systemDb, slug);
  if (season === null) {
    return { ok: false, error: REFUSALS.unknown_season };
  }
  const outcome = await inOrg(operator.personId, season.orgId, (db) =>
    liftSeasonHold(db, {
      competitionId: season.id,
      actorId: operator.personId,
      note: note.trim() === "" ? null : note,
    }),
  );
  if (!outcome.ok) {
    return { ok: false, error: REFUSALS[outcome.reason] };
  }
  logger().info({ slug, operator: operator.personId }, "moderation.season_hold_lifted");
  revalidatePath("/admin/moderation");
  return {
    ok: true,
    message: `Hold lifted on ${season.name}. It stays unlisted until the organizer publishes it again.`,
  };
}
