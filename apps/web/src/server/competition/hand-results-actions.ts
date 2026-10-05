"use server";

import { publishResultsByHand } from "@desiauction/auction";
import { defaultAuctionConfigFor, formatAmount, paise, pointsSlabs } from "@desiauction/core";
import {
  auctions,
  auditLog,
  newId,
  registrations,
  teams,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { parseAmount } from "../auction/auction-setup";
import { dbHandle } from "../db";
import { ForbiddenError } from "../orgs/authz";
import { requireCompetitionCapability } from "./authz";
import type { CompetitionSummary } from "./competitions";
import { preSignedSql } from "./pre-signed";
import { assignTeam } from "./registration-aggregate";
import { resolveMemberCompetition } from "./resolve";

/**
 * AUCTION RESULTS ENTERED BY HAND (0105).
 *
 * For a season whose auction happened outside the app: the organiser puts each
 * bought player on a team from the Teams tab, types the price if there was one,
 * and publishes. Publishing writes a completed auction (`publishResultsByHand`)
 * and from then on everything — posters, team cards, the roster lock — behaves
 * as it does after a night in the app. Nothing here edits a published result.
 *
 * Organisers only (`competition.manage`): creating the season's auction is
 * theirs, and this is that, written afterwards.
 */

type Gate = { personId: string; competition: CompetitionSummary };

async function manageGate(slug: string): Promise<Gate | null> {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  const competition = await resolveMemberCompetition(session.personId, slug);
  return competition === null ? null : { personId: session.personId, competition };
}

async function asManager<T>(gate: Gate, fn: (db: Db) => Promise<T>): Promise<T | "forbidden"> {
  try {
    return await withTenantDb(
      dbHandle,
      { personId: gate.personId, orgId: gate.competition.orgId },
      async (db) => {
        await requireCompetitionCapability(
          db,
          gate.personId,
          { orgId: gate.competition.orgId, competitionId: gate.competition.id },
          "competition.manage",
        );
        return fn(db);
      },
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return "forbidden";
    }
    throw error;
  }
}

const FORBIDDEN = "Only the season's organisers can enter auction results.";
const CLOSED =
  "This season already has an auction in the app, so its results come from there and can't be typed in.";

/**
 * Hand entry is open while the season has no auction in the app, an aborted
 * one aside — the Teams tab's own test. Publishing races "Create the auction" safely: the
 * season's one-real-auction index (0029) lets only one of them land.
 */
async function handEntryOpen(db: Db, competitionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(
      and(
        eq(auctions.competitionId, competitionId),
        eq(auctions.kind, "real"),
        ne(auctions.status, "abandoned"),
      ),
    )
    .limit(1);
  return row === undefined;
}

async function playerOf(db: Db, competitionId: string, registrationId: string) {
  const [row] = await db
    .select({
      status: registrations.status,
      teamId: registrations.teamId,
      teamName: teams.name,
      preSigned: preSignedSql,
    })
    .from(registrations)
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(
      and(eq(registrations.id, registrationId), eq(registrations.competitionId, competitionId)),
    )
    .limit(1);
  return row ?? null;
}

export type HandResult = { ok: true } | { ok: false; error: string };

/**
 * Put a player on a team as bought at the auction — or, with `teamId` null,
 * take them off it again (their price goes with them).
 *
 * A player already on ANOTHER team is refused rather than moved: on a screen
 * where an organiser is typing a hundred names, a silent move is how one
 * player ends up "bought" twice. Pre-signed players stay where they are.
 */
export async function placeByHandAction(
  slug: string,
  registrationId: string,
  teamId: string | null,
  /**
   * The results list's team dropdown names the destination outright — moving
   * a player there is the choice, not an accident. Their price moves with
   * them. The search box never passes it.
   */
  options: { move?: boolean } = {},
): Promise<HandResult> {
  const gate = await manageGate(slug);
  if (gate === null) {
    return { ok: false, error: "Not available." };
  }
  const result = await asManager(gate, async (db): Promise<HandResult> => {
    if (!(await handEntryOpen(db, gate.competition.id))) {
      return { ok: false, error: CLOSED };
    }
    const player = await playerOf(db, gate.competition.id, registrationId);
    if (player === null) {
      return { ok: false, error: "That player is not in this season." };
    }
    if (player.preSigned) {
      return {
        ok: false,
        error: "This player is a captain, icon or retained player — they're already on their team.",
      };
    }
    if (teamId !== null) {
      if (player.status !== "approved") {
        return {
          ok: false,
          error: "Approve this player first — only approved players join a team.",
        };
      }
      if (player.teamId !== null && player.teamId !== teamId && options.move !== true) {
        return {
          ok: false,
          error: `Already on ${player.teamName ?? "another team"}. Remove them there first.`,
        };
      }
      if (player.teamId === teamId) {
        return { ok: true };
      }
    }
    const assigned = await assignTeam(
      db,
      gate.competition.orgId,
      gate.competition.id,
      registrationId,
      teamId,
      gate.personId,
    );
    if (!assigned.ok) {
      return {
        ok: false,
        error:
          assigned.reason === "unknown_team"
            ? "That team is not in this season."
            : "That player can't be put on a team.",
      };
    }
    if (teamId === null) {
      await db
        .update(registrations)
        .set({ offlinePrice: null })
        .where(eq(registrations.id, registrationId));
    }
    return { ok: true };
  });
  return result === "forbidden" ? { ok: false, error: FORBIDDEN } : result;
}

/**
 * The price a placed player went for, as typed. Blank clears it — "no price"
 * is a real answer for an auction run on paper, and the poster just leaves the
 * price off.
 */
export async function priceByHandAction(
  slug: string,
  registrationId: string,
  raw: string,
): Promise<{ ok: true; price: number | null } | { ok: false; error: string }> {
  const gate = await manageGate(slug);
  if (gate === null) {
    return { ok: false, error: "Not available." };
  }
  const unit = gate.competition.auctionUnit;
  let price: number | null = null;
  if (raw.trim() !== "") {
    const parsed = parseAmount(raw, "price", unit === "points" ? "Points" : "Price", unit);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    price = parsed.value * 100;
  }
  const result = await asManager(
    gate,
    async (db): Promise<{ ok: true; price: number | null } | { ok: false; error: string }> => {
      if (!(await handEntryOpen(db, gate.competition.id))) {
        return { ok: false, error: CLOSED };
      }
      const player = await playerOf(db, gate.competition.id, registrationId);
      if (player === null || player.teamId === null || player.preSigned) {
        return { ok: false, error: "Put this player on a team first." };
      }
      await db
        .update(registrations)
        .set({ offlinePrice: price })
        .where(eq(registrations.id, registrationId));
      await db.insert(auditLog).values({
        id: newId(),
        actor: gate.personId,
        action: "registration.offline_price_set",
        scopeType: "org",
        scopeId: gate.competition.orgId,
        subject: registrationId,
        meta: price === null ? { cleared: "true" } : { price: String(price) },
      });
      return { ok: true, price };
    },
  );
  return result === "forbidden" ? { ok: false, error: FORBIDDEN } : result;
}

export type PublishByHandActionResult =
  { ok: true; sold: number; unsold: number } | { ok: false; error: string; field?: "purse" };

/**
 * PUBLISH: the typed results become the season's (completed) auction.
 *
 * The purse is the one number asked for here, because every "left" figure on
 * a team card and a squad poster is purse minus spend. It can't be less than
 * what a team already spent — that would be a team that overspent its purse.
 */
export async function publishByHandAction(
  slug: string,
  purseRaw: string,
): Promise<PublishByHandActionResult> {
  const gate = await manageGate(slug);
  if (gate === null) {
    return { ok: false, error: "Not available." };
  }
  const unit = gate.competition.auctionUnit;
  const parsed = parseAmount(purseRaw, "purse", "Purse per team", unit);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, field: "purse" };
  }
  const pursePerTeam = paise(parsed.value * 100);
  const result = await asManager(gate, async (db): Promise<PublishByHandActionResult> => {
    if (!(await handEntryOpen(db, gate.competition.id))) {
      return { ok: false, error: CLOSED };
    }
    const spend = await db
      .select({
        teamName: teams.name,
        // bigint arrives as a string — a rupee purse ×100 outgrows int4.
        spent: sql<string>`coalesce(sum(${registrations.offlinePrice}), 0)::bigint`,
        squad: sql<number>`count(*)::int`,
      })
      .from(registrations)
      .innerJoin(teams, eq(teams.id, registrations.teamId))
      .where(
        and(
          eq(registrations.competitionId, gate.competition.id),
          eq(registrations.status, "approved"),
          isNotNull(registrations.teamId),
        ),
      )
      .groupBy(teams.name);
    const over = spend.find((row) => Number(row.spent) > pursePerTeam);
    if (over !== undefined) {
      return {
        ok: false,
        field: "purse",
        error: `${over.teamName} spent ${formatAmount(paise(Number(over.spent)), unit)} — the purse can't be less than that.`,
      };
    }
    const defaults = defaultAuctionConfigFor(unit);
    const largestSquad = Math.max(1, ...spend.map((row) => row.squad));
    const published = await publishResultsByHand(db, gate.competition, gate.personId, {
      ...defaults,
      pursePerTeam,
      slabs: unit === "points" ? pointsSlabs(pursePerTeam) : defaults.slabs,
      // No squad rules were enforced on paper: the bounds just have to hold
      // the squads that exist.
      squadMin: 1,
      squadMax: largestSquad,
      basePriceBands: {},
      basePriceDefault: paise(Math.min(defaults.basePriceDefault, pursePerTeam)),
    });
    if (!published.ok) {
      return {
        ok: false,
        error: {
          invalid_config: "That purse doesn't work — try a larger number.",
          auction_exists: CLOSED,
          nobody_placed: "Put at least one player on a team before publishing.",
        }[published.reason],
      };
    }
    return { ok: true, sold: published.sold, unsold: published.unsold };
  });
  return result === "forbidden" ? { ok: false, error: FORBIDDEN } : result;
}
