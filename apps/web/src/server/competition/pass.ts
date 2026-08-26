"use server";

import { TIER_LIMITS, checkTierLimit, isTier, tierLabel, type Tier } from "@desiauction/core";
import {
  auditLog,
  competitions,
  newId,
  passUpgradeRequests,
  registrations,
  teams,
  withTenantDb,
} from "@desiauction/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { canCompetition } from "./authz";
import { resolveCompetition } from "./competitions";

/**
 * THE SEASON'S PASS — WHAT IT COVERS, AND HOW CLOSE YOU ARE.
 *
 * 0027 began refusing the fifth team on Free, and an organizer had no way to
 * see a limit before meeting it. A ceiling nobody can see is an ambush: you
 * discover it at the moment you are stopped, which is the worst moment to learn
 * a commercial fact. This read is what makes the ceiling humane — it is on the
 * season's own page, and it is there at 2 of 4 teams as much as at 4 of 4.
 *
 * The upgrade is a REQUEST, not a purchase. Pro and Association both read
 * "Published at GA" on the pricing page: there is no price for either anywhere
 * in this repository, and a checkout here would have to invent the number a
 * customer is charged.
 */

export interface PassUsage {
  readonly used: number;
  /** null = uncounted (Association, and every beta season). */
  readonly limit: number | null;
  /** True once the next one would be refused. */
  readonly full: boolean;
}

export interface SeasonPassView {
  readonly tier: Tier;
  readonly tierName: string;
  readonly teams: PassUsage;
  readonly players: PassUsage;
  /** An open request, if this season has already asked. */
  readonly pending: { readonly requestedTier: Tier; readonly requestedAt: string } | null;
  readonly viewer: { readonly canRequest: boolean };
}

function usage(tier: Tier, subject: "teams" | "players", used: number): PassUsage {
  return {
    used,
    limit: TIER_LIMITS[tier][subject],
    full: !checkTierLimit(tier, subject, used).ok,
  };
}

export async function seasonPass(slug: string): Promise<SeasonPassView | null> {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  // Membership is proven inside resolveCompetition's join; it must run on the
  // system pool like every sibling caller, because under the production app
  // role RLS closes `competitions` when no tenant context is set — which made
  // the whole pass surface answer "not found" in production while passing
  // locally as the DB owner.
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  return withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    async (db) => {
      const [tierRow] = await db
        .select({ tier: competitions.tier })
        .from(competitions)
        .where(eq(competitions.id, competition.id))
        .limit(1);
      const tier: Tier = isTier(tierRow?.tier ?? "") ? (tierRow?.tier as Tier) : "free";
      const [teamCount, playerCount, open, canManage] = await Promise.all([
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(teams)
          .where(eq(teams.competitionId, competition.id)),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(registrations)
          .where(
            and(
              eq(registrations.competitionId, competition.id),
              eq(registrations.status, "approved"),
            ),
          ),
        db
          .select({
            requestedTier: passUpgradeRequests.requestedTier,
            createdAt: passUpgradeRequests.createdAt,
          })
          .from(passUpgradeRequests)
          .where(
            and(
              eq(passUpgradeRequests.competitionId, competition.id),
              isNull(passUpgradeRequests.resolvedAt),
            ),
          )
          .limit(1),
        canCompetition(
          db,
          session.personId,
          { orgId: competition.orgId, competitionId: competition.id },
          "competition.manage",
        ),
      ]);
      const pendingRow = open[0];
      return {
        tier,
        tierName: tierLabel(tier),
        teams: usage(tier, "teams", teamCount[0]?.n ?? 0),
        players: usage(tier, "players", playerCount[0]?.n ?? 0),
        pending:
          pendingRow === undefined
            ? null
            : {
                requestedTier: pendingRow.requestedTier,
                requestedAt: pendingRow.createdAt.toISOString(),
              },
        viewer: { canRequest: canManage },
      };
    },
  );
}

export type RequestPassResult = { ok: true } | { ok: false; error: string };

/** The partial unique index behind "one open request per season" (migration 0028). */
const OPEN_REQUEST_CONSTRAINT = "pass_upgrade_requests_open_uq";

/**
 * Postgres 23505 on that one constraint — the loud half of a lost race.
 *
 * Kept local on purpose. The same shape exists in the certified auction
 * aggregate, but the web tier does not reach across that boundary for a
 * utility; copying nine lines is cheaper than a dependency that dependency-
 * cruiser would have to be taught to allow.
 *
 * `constraint_name` is the field postgres.js exposes; the message check is the
 * fallback for anything that carries only the text.
 */
function isOpenRequestConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as { code?: unknown; constraint_name?: unknown; message?: unknown };
  if (record.code !== "23505") {
    return false;
  }
  return (
    record.constraint_name === OPEN_REQUEST_CONSTRAINT ||
    (typeof record.message === "string" && record.message.includes(OPEN_REQUEST_CONSTRAINT))
  );
}

/**
 * Ask for a bigger pass.
 *
 * Gated on `competition.manage` — the capability that already means "this
 * season is yours to run". Asking for a commercial change is not a money power
 * (nothing is charged), so it deliberately does NOT reach for the settlement
 * partition; it is the same authority that renames the season.
 */
export async function requestPassUpgrade(
  slug: string,
  requestedTier: string,
  note: string,
): Promise<RequestPassResult> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "Please sign in." };
  }
  if (!isTier(requestedTier) || requestedTier === "free") {
    return { ok: false, error: "Choose the pass you need." };
  }
  // Membership is proven inside resolveCompetition's join; it must run on the
  // system pool like every sibling caller, because under the production app
  // role RLS closes `competitions` when no tenant context is set — which made
  // the whole pass surface answer "not found" in production while passing
  // locally as the DB owner.
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Season not found." };
  }
  return withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    async (db) => {
      const scope = { orgId: competition.orgId, competitionId: competition.id };
      if (!(await canCompetition(db, session.personId, scope, "competition.manage"))) {
        return { ok: false, error: "You can't change this season's pass." };
      }
      const [tierRow] = await db
        .select({ tier: competitions.tier })
        .from(competitions)
        .where(eq(competitions.id, competition.id))
        .limit(1);
      const fromTier: Tier = isTier(tierRow?.tier ?? "") ? (tierRow?.tier as Tier) : "free";
      if (fromTier === requestedTier) {
        return { ok: false, error: `This season is already on ${tierLabel(fromTier)}.` };
      }
      const id = newId();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(passUpgradeRequests).values({
            id,
            orgId: competition.orgId,
            competitionId: competition.id,
            fromTier,
            requestedTier,
            ...(note.trim() === "" ? {} : { note: note.trim().slice(0, 1000) }),
            requestedBy: session.personId,
          });
          // On the same append-only record as every other decision, so the
          // operator who answers it finds it where they find everything else.
          await tx.insert(auditLog).values({
            id: newId(),
            actor: session.personId,
            action: "competition.pass_upgrade_requested",
            scopeType: "org",
            scopeId: competition.orgId,
            subject: competition.id,
            meta: { fromTier, requestedTier },
          });
        });
      } catch (error) {
        // ONLY the partial unique index means "already asked". A bare catch here
        // told an organizer their season had a request open whenever the
        // database so much as hiccuped — a lie about state, and one that sends
        // them to support for the wrong thing while the real fault goes
        // unreported. Everything else is a genuine failure and is allowed to be
        // one.
        if (isOpenRequestConflict(error)) {
          return { ok: false, error: "This season already has a request open — we're on it." };
        }
        throw error;
      }
      revalidatePath(`/seasons/${slug}`);
      return { ok: true };
    },
  );
}
