import { registrations, type Db } from "@desiauction/db";
import { eq, sql } from "drizzle-orm";

import { countNoun } from "../../lib/plural";
import type { CompetitionSummary } from "../competition/competitions";
import { queryRegistrations } from "../competition/registrations";
import { scheduleSnapshot } from "../competition/schedule-snapshot";

// THE AUCTIONREADY PROJECTION (M-IP4-1). The sole gateway into Auction: an
// auction can be created only from a projection whose checks all pass. It
// consumes ONLY the frozen Competition surfaces — the ScheduleSnapshot, the
// approved-registration read model, and the CompetitionSummary API — never a
// mutable Competition entity (the IP-3 freeze condition, GATES condition 2).
// Deep-frozen and deterministic, like every read model downstream of a freeze.

export interface AuctionPoolEntry {
  readonly registrationId: string;
  readonly personId: string;
  readonly playerName: string | null;
  readonly role: string | null;
  readonly basePriceBand: string | null;
  readonly registrationNumber: string;
  /** Already on a team sheet (retained, or sold in this auction) — not "left to place". */
  readonly teamId: string | null;
}

export interface AuctionReadyCheck {
  readonly id: "intake_closed" | "pool_present" | "teams_present";
  readonly label: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface AuctionReadyProjection {
  readonly ok: boolean;
  readonly checks: readonly AuctionReadyCheck[];
  readonly competitionId: string;
  readonly competitionCode: string;
  /** The locked pool: approved registrations in registration-number order. */
  readonly pool: readonly AuctionPoolEntry[];
  readonly teams: readonly { id: string; name: string; shortName: string | null }[];
  /**
   * Players already on each team's sheet, in `teams` order — icons, retained
   * players and anyone already sold. The engine's below-minimum guard counts
   * exactly these rows, so the feasibility arithmetic can agree with it.
   */
  readonly squadSizes: readonly number[];
  readonly scheduledFixtures: number;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export async function auctionReady(
  db: Db,
  competition: CompetitionSummary,
): Promise<AuctionReadyProjection> {
  const snapshot = await scheduleSnapshot(db, competition);

  // The approved pool through the registration read model, all pages,
  // deterministic (registration-number sort with stable tiebreaks).
  const pool: AuctionPoolEntry[] = [];
  let page = 1;
  for (;;) {
    const result = await queryRegistrations(db, competition.id, {
      status: "approved",
      sort: "number",
      page,
      pageSize: 100,
    });
    pool.push(
      // Pre-signed players never enter the block — they are squad already, not
      // auction lots. TWO MARKS MEAN THAT, and this filter read only one.
      //
      // `is_retained` has been documented as excluded since migration 0018 and
      // was excluded by the poster, the showcase, the career page and the live
      // summary — but not here, so a retained player reached the block and was
      // bid for. `squad-board.tsx` carries the scar: it de-duplicates a player
      // who is "BOTH pre-signed and auctioned", a combination its own comment
      // calls impossible, because this line made it possible. That defence
      // stays; the cause is fixed here.
      //
      // It was unreachable in practice only because nothing could SET the flag.
      // Now that an organizer can, it would be a live defect rather than a
      // latent one.
      ...result.rows
        .filter((row) => !row.isIcon && !row.isRetained)
        .map((row) => ({
          registrationId: row.id,
          personId: row.personId,
          playerName: row.name,
          role: row.role,
          basePriceBand: row.basePriceBand,
          registrationNumber: row.number,
          teamId: row.teamId,
        })),
    );
    if (page * result.pageSize >= result.total) {
      break;
    }
    page += 1;
  }

  // Team sheets as they stand. Counted the way the engine's below-minimum
  // guard counts them (every registration carrying the team id), so the
  // feasibility arithmetic on the setup screen and the refusal at closing time
  // are the same sum.
  const sizeRows = await db
    .select({ teamId: registrations.teamId, count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(eq(registrations.competitionId, competition.id))
    .groupBy(registrations.teamId);
  const sizeByTeam = new Map(
    sizeRows.flatMap((row) => (row.teamId === null ? [] : [[row.teamId, row.count] as const])),
  );

  /**
   * A gate row is read at a glance, and every label here used to be written
   * as though it had already passed: "Registration is closed (the pool is
   * locked)" sat under a BLOCKED chip WHILE REGISTRATION WAS OPEN, so a skim
   * came away believing the opposite of the truth. A failing row now says
   * what is true now and what to do about it; a passing one states the fact.
   * The `id`s are untouched — specs and the readiness page key on them.
   */
  const intakeClosed = competition.status === "registration_closed";
  const poolPresent = pool.length >= 1;
  const teamsPresent = snapshot.teams.length >= 2;
  const checks: AuctionReadyCheck[] = [
    {
      id: "intake_closed",
      label: intakeClosed
        ? "Registration is closed — the pool is locked"
        : "Registration is still open — close it to lock the pool",
      pass: intakeClosed,
      detail: `competition is ${competition.status.replace(/_/g, " ")}`,
    },
    {
      id: "pool_present",
      // Registrations calls this the auction pool, and it is not the same
      // number as "approved" — icons are approved and never enter it.
      label: poolPresent
        ? "The auction pool has players"
        : "The auction pool is empty — approve registrations to fill it",
      pass: poolPresent,
      detail: `${countNoun(pool.length, "player")} in the auction pool`,
    },
    {
      id: "teams_present",
      label: teamsPresent
        ? "At least two teams exist"
        : "Fewer than two teams — add teams before the auction",
      pass: teamsPresent,
      detail: countNoun(snapshot.teams.length, "team"),
    },
  ];

  return deepFreeze({
    ok: checks.every((check) => check.pass),
    checks,
    competitionId: competition.id,
    competitionCode: snapshot.competition.code,
    pool,
    teams: snapshot.teams.map((team) => ({
      id: team.id,
      name: team.name,
      shortName: team.shortName,
    })),
    squadSizes: snapshot.teams.map((team) => sizeByTeam.get(team.id) ?? 0),
    scheduledFixtures: snapshot.stats.total,
  });
}
