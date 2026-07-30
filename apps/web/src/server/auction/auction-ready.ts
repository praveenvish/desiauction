import { registrations, type Db } from "@desiauction/db";
import { eq, sql } from "drizzle-orm";

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
  readonly role: string;
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
      // Icon (marquee) players are pre-signed to their team and never enter the
      // block — they are retained squad, not auction lots.
      ...result.rows
        .filter((row) => !row.isIcon)
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

  const checks: AuctionReadyCheck[] = [
    {
      id: "intake_closed",
      label: "Registration is closed (the pool is locked)",
      pass: competition.status === "registration_closed",
      detail: `competition is ${competition.status.replace(/_/g, " ")}`,
    },
    {
      id: "pool_present",
      // Registrations calls this the auction pool, and it is not the same
      // number as "approved" — icons are approved and never enter it.
      label: "The auction pool is non-empty",
      pass: pool.length >= 1,
      detail: `${String(pool.length)} player(s) in the auction pool`,
    },
    {
      id: "teams_present",
      label: "At least two teams exist",
      pass: snapshot.teams.length >= 2,
      detail: `${String(snapshot.teams.length)} team(s)`,
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
