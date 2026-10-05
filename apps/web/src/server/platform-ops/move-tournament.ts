import {
  auctions,
  competitions,
  newId,
  organizations,
  settlementCases,
  tournaments,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { inOrg } from "../tenant";
import type { DeskResult } from "./club";

/*
 * MOVE A TOURNAMENT TO ANOTHER CLUB — the writer behind the club desk's
 * "Move to another club" (superadmin only; called from club-actions.ts after
 * `operatorFor`).
 *
 * No runtime role can rewrite a row's club (every org policy checks the same
 * predicate both ways), so the write is the database's own
 * `platform_move_tournament` (migration 0108): one transaction, which checks
 * the superadmin grant itself, refuses while an auction is live or paused or
 * when the seasons have money records, moves the tournament with every season
 * under it, and writes an audit row into BOTH clubs. It is called from the
 * old club's boundary on the APP role, so `app.person_id` is the operator.
 *
 * The unit is the tournament (BPL, with every edition), not one season: a
 * season moved alone would leave its tournament row in the old club. A
 * one-off season with no tournament moves on its own.
 */

export interface MoveSubject {
  readonly kind: "tournament" | "season";
  readonly id: string;
  readonly name: string;
  readonly seasons: readonly string[];
  /** Why it can't move now, in the desk's words; null when it can. */
  readonly blocked: string | null;
}

export interface MoveDesk {
  readonly subjects: readonly MoveSubject[];
  readonly clubs: readonly { slug: string; name: string }[];
}

const RUNNING = "An auction is live or paused. Move it after the auction ends.";
const MONEY =
  "It has money records (settlement or payments). Those are numbered per club and can't move.";

/** What can move out of this club, and where to. System pool, read only. */
export async function moveDesk(system: Db, orgId: string): Promise<MoveDesk> {
  const [tournamentRows, seasonRows, clubRows] = await Promise.all([
    system
      .select({ id: tournaments.id, name: tournaments.name })
      .from(tournaments)
      .where(eq(tournaments.orgId, orgId))
      .orderBy(asc(tournaments.name)),
    system
      .select({
        id: competitions.id,
        name: competitions.name,
        tournamentId: competitions.tournamentId,
      })
      .from(competitions)
      .where(eq(competitions.orgId, orgId))
      .orderBy(asc(competitions.createdAt)),
    system
      .select({ slug: organizations.slug, name: organizations.name })
      .from(organizations)
      .where(ne(organizations.id, orgId))
      .orderBy(asc(organizations.name))
      .limit(500),
  ]);
  const seasonIds = seasonRows.map((row) => row.id);
  const [runningRows, moneyRows] =
    seasonIds.length === 0
      ? [[], []]
      : await Promise.all([
          system
            .selectDistinct({ seasonId: auctions.competitionId })
            .from(auctions)
            .where(
              and(
                inArray(auctions.competitionId, seasonIds),
                inArray(auctions.status, ["live", "paused"]),
              ),
            ),
          system
            .selectDistinct({ seasonId: settlementCases.competitionId })
            .from(settlementCases)
            .where(inArray(settlementCases.competitionId, seasonIds)),
        ]);
  const running = new Set(runningRows.map((row) => row.seasonId));
  const money = new Set(moneyRows.map((row) => row.seasonId));
  const blockedFor = (ids: readonly string[]): string | null =>
    ids.some((id) => running.has(id)) ? RUNNING : ids.some((id) => money.has(id)) ? MONEY : null;

  const subjects: MoveSubject[] = tournamentRows.map((tournament) => {
    const seasons = seasonRows.filter((row) => row.tournamentId === tournament.id);
    return {
      kind: "tournament",
      id: tournament.id,
      name: tournament.name,
      seasons: seasons.map((row) => row.name),
      blocked: blockedFor(seasons.map((row) => row.id)),
    };
  });
  for (const season of seasonRows.filter((row) => row.tournamentId === null)) {
    subjects.push({
      kind: "season",
      id: season.id,
      name: season.name,
      seasons: [season.name],
      blocked: blockedFor([season.id]),
    });
  }
  return { subjects, clubs: clubRows };
}

/** The function's refusals, in words a support operator can act on. */
const REFUSALS: Record<string, string> = {
  move_needs_rls_bypass:
    "The database isn't set up for moves (the migration owner must bypass row security).",
  move_not_superadmin: "Only a superadmin can move a tournament.",
  move_reason_required: "Write a reason (10–500 characters).",
  move_one_subject: "Pick one tournament or season to move.",
  move_target_missing: "That club no longer exists.",
  move_subject_missing: "That tournament no longer exists.",
  move_season_has_tournament: "This season belongs to a tournament. Move the tournament instead.",
  move_split_subject: "This tournament's seasons are in different clubs, so it can't move as one.",
  move_same_club: "It's already in that club.",
  move_auction_running: RUNNING,
  move_has_money: MONEY,
};

function refusalOf(error: unknown): string | null {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    const code = /move_[a-z_]+/.exec(cause.message)?.[0];
    const words = code === undefined ? undefined : REFUSALS[code];
    if (words !== undefined) {
      return words;
    }
  }
  return null;
}

interface Counts {
  seasons: number;
  auctions: number;
  teams: number;
  registrations: number;
  membersAdded: number;
}

export async function moveTournament(
  system: Db,
  input: {
    operator: string;
    slug: string;
    subjectKind: "tournament" | "season";
    subjectId: string;
    targetSlug: string;
    reason: string;
  },
): Promise<DeskResult & { targetSlug?: string }> {
  const clubs = await system
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
    .from(organizations)
    .where(inArray(organizations.slug, [input.slug, input.targetSlug]));
  const source = clubs.find((club) => club.slug === input.slug);
  const target = clubs.find((club) => club.slug === input.targetSlug);
  if (source === undefined) {
    return { ok: false, error: "This club no longer exists." };
  }
  if (target === undefined) {
    return { ok: false, error: "Pick the club to move it to." };
  }
  if (target.id === source.id) {
    return { ok: false, error: REFUSALS.move_same_club as string };
  }
  // The subject must be in THIS club — the desk only offers its own, and the
  // function would refuse a split anyway, but a forged id from another club
  // should read as "not here", not move someone else's tournament.
  const owned =
    input.subjectKind === "tournament"
      ? await system
          .select({ id: tournaments.id })
          .from(tournaments)
          .where(and(eq(tournaments.id, input.subjectId), eq(tournaments.orgId, source.id)))
      : await system
          .select({ id: competitions.id })
          .from(competitions)
          .where(
            and(
              eq(competitions.id, input.subjectId),
              eq(competitions.orgId, source.id),
              isNull(competitions.tournamentId),
            ),
          );
  if (owned.length === 0) {
    return { ok: false, error: "That isn't in this club any more. Reload the page." };
  }
  const tournamentId = input.subjectKind === "tournament" ? input.subjectId : null;
  const competitionId = input.subjectKind === "season" ? input.subjectId : null;
  try {
    const counts = await inOrg(input.operator, source.id, async (tx) => {
      const [row] = await tx.execute<{ moved: Counts } & Record<string, unknown>>(
        sql`select platform_move_tournament(${tournamentId}, ${competitionId}, ${target.id}, ${input.reason}, ${newId()}, ${newId()}) as moved`,
      );
      if (row === undefined) {
        throw new Error("move_returned_nothing");
      }
      return row.moved;
    });
    const seasons = counts.seasons === 1 ? "1 season" : `${String(counts.seasons)} seasons`;
    return {
      ok: true,
      message: `Moved to ${target.name}: ${seasons}, ${String(counts.teams)} teams, ${String(counts.registrations)} registrations. ${String(counts.membersAdded)} people were added to ${target.name} so they keep access.`,
      targetSlug: target.slug,
    };
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal !== null) {
      return { ok: false, error: refusal };
    }
    throw error;
  }
}
