import type { Db } from "@desiauction/db";

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
      ...result.rows.map((row) => ({
        registrationId: row.id,
        personId: row.personId,
        playerName: row.name,
        role: row.role,
        basePriceBand: row.basePriceBand,
        registrationNumber: row.number,
      })),
    );
    if (page * result.pageSize >= result.total) {
      break;
    }
    page += 1;
  }

  const checks: AuctionReadyCheck[] = [
    {
      id: "intake_closed",
      label: "Registration is closed (the pool is locked)",
      pass: competition.status === "registration_closed",
      detail: `competition is ${competition.status.replace(/_/g, " ")}`,
    },
    {
      id: "pool_present",
      label: "The approved pool is non-empty",
      pass: pool.length >= 1,
      detail: `${String(pool.length)} approved player(s)`,
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
    scheduledFixtures: snapshot.stats.total,
  });
}
