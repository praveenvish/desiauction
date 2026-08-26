import { isTier, tierLabel, type Tier } from "@desiauction/core";
import { auditLog, competitions, newId, passUpgradeRequests, type Db } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * ANSWERING A PASS REQUEST — the operator side of 0028.
 *
 * WHY THIS IS NOT A SCREEN IN /admin, and what would have to change if it were.
 *
 * `server/admin/capabilities.ts` says, in as many words: "Administration is an
 * observation surface, so the vocabulary stays one word wide — there is no
 * write to tier." The console's read-only guarantee is PROVED at runtime
 * (PX-9), the releases page sells it to customers, and the platform grant
 * itself deliberately ships no UI: it is installable only out-of-band on the
 * RLS-exempt system pool. Answering a request is a platform-level commercial
 * act of exactly that shape, so it is performed exactly that way.
 *
 * The logic lives HERE rather than in the script, so it is testable against a
 * real database and so a future UI — which would need a SECOND platform
 * capability, distinct from `platform:admin`, because seeing everything and
 * changing a commercial term are different acts of trust — has something to
 * call rather than something to reimplement.
 *
 * Takes a `Db` and an actor. No session, no request, no environment: the caller
 * decides who is allowed, because in this repository that decision is made by
 * who can reach the system pool at all.
 */

export type GrantOutcome = "granted" | "declined";

/**
 * Thrown inside the resolution transaction when another operator claimed the
 * request first. It exists to roll the transaction back — a lost race must not
 * move the tier — and is converted to a refusal by the caller below, never
 * escaping this module.
 */
class RaceLost extends Error {
  constructor() {
    super("pass_request_already_resolved");
    this.name = "RaceLost";
  }
}

export type GrantPassResult =
  | { ok: true; slug: string; fromTier: Tier; toTier: Tier; outcome: GrantOutcome }
  | {
      ok: false;
      reason: "no_open_request" | "unknown_season" | "invalid_tier";
      detail: string;
    };

/**
 * Resolve a season's open pass request.
 *
 * ONE TRANSACTION, because a granted request that did not move the tier — or a
 * moved tier with the request still open — are both worse than either half
 * failing. Both audit rows are inside it for the same reason: the record of a
 * commercial change and the change itself are one event or they are nothing.
 *
 * Declining leaves the tier alone. It is not a failure — it is an answer, and
 * the organizer's card stops saying "we're on it" either way.
 */
export async function resolvePassRequest(
  db: Db,
  input: {
    slug: string;
    outcome: GrantOutcome;
    /** Required when granting; ignored when declining. */
    tier?: string;
    actorId: string;
    note?: string;
  },
): Promise<GrantPassResult> {
  const [season] = await db
    .select({ id: competitions.id, orgId: competitions.orgId, tier: competitions.tier })
    .from(competitions)
    .where(eq(competitions.slug, input.slug))
    .limit(1);
  if (season === undefined) {
    return { ok: false, reason: "unknown_season", detail: `No season with slug ${input.slug}.` };
  }
  const [request] = await db
    .select({
      id: passUpgradeRequests.id,
      requestedTier: passUpgradeRequests.requestedTier,
    })
    .from(passUpgradeRequests)
    .where(
      and(eq(passUpgradeRequests.competitionId, season.id), isNull(passUpgradeRequests.resolvedAt)),
    )
    .limit(1);
  if (request === undefined) {
    return {
      ok: false,
      reason: "no_open_request",
      detail: `${input.slug} has no open pass request. Nothing to answer.`,
    };
  }
  // Granting defaults to what they actually asked for — the common case, and
  // the one where a typed tier is a chance to give somebody the wrong pass.
  const target = input.tier ?? request.requestedTier;
  if (!isTier(target)) {
    return { ok: false, reason: "invalid_tier", detail: `${target} is not a tier.` };
  }
  const fromTier: Tier = isTier(season.tier) ? season.tier : "free";
  const toTier: Tier = input.outcome === "granted" ? target : fromTier;

  // Two operators (script + console, or two consoles) can both read the same
  // open request and both answer it. The resolution claims the request with a
  // `resolved_at IS NULL` guard and rolls the whole transaction back if it lost
  // the race, so a grant-then-decline can never leave the tier moved with the
  // request recorded as declined.
  try {
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(passUpgradeRequests)
        .set({ resolvedAt: new Date(), resolvedBy: input.actorId, outcome: input.outcome })
        .where(and(eq(passUpgradeRequests.id, request.id), isNull(passUpgradeRequests.resolvedAt)))
        .returning({ id: passUpgradeRequests.id });
      if (claimed.length === 0) {
        throw new RaceLost();
      }
      if (input.outcome === "granted" && toTier !== fromTier) {
        await tx.update(competitions).set({ tier: toTier }).where(eq(competitions.id, season.id));
      }
      await tx.insert(auditLog).values({
        id: newId(),
        actor: input.actorId,
        action: `competition.pass_upgrade_${input.outcome}`,
        scopeType: "org",
        scopeId: season.orgId,
        subject: season.id,
        meta: {
          fromTier,
          toTier,
          requestedTier: request.requestedTier,
          ...(input.note !== undefined && input.note !== "" ? { note: input.note } : {}),
        },
      });
    });
  } catch (error) {
    if (error instanceof RaceLost) {
      return {
        ok: false,
        reason: "no_open_request",
        detail: `${input.slug}'s pass request was already answered by someone else. Nothing to do.`,
      };
    }
    throw error;
  }

  return { ok: true, slug: input.slug, fromTier, toTier, outcome: input.outcome };
}

/** One line an operator can paste into a reply to the organizer. */
export function grantSummary(result: Extract<GrantPassResult, { ok: true }>): string {
  return result.outcome === "granted"
    ? `${result.slug}: ${tierLabel(result.fromTier)} → ${tierLabel(result.toTier)}.`
    : `${result.slug}: request declined; stays on ${tierLabel(result.fromTier)}.`;
}
