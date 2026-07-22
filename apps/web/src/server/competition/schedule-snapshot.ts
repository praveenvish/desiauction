import {
  competitionCode,
  csvCell,
  type CompetitionStatus,
  type GroundStatus,
  type GroundSurface,
} from "@desiauction/core";
import { fixtures, grounds, teams, venues, type Db } from "@desiauction/db";
import { asc, eq } from "drizzle-orm";

import type { CompetitionSummary } from "./competitions";
import {
  competitionFixtureSnapshots,
  fixtureStats,
  type FixtureSnapshot,
  type FixtureStats,
} from "./fixtures";

// SCHEDULE SNAPSHOT (M-IP3-4). THE canonical read model of a competition's
// schedule — one deep-frozen, deterministic projection consumed by calendar,
// exports, and the future Auction and Match engines. Downstream modules never
// read mutable fixture entities: they receive this. Pure of ambient time (no
// generated-at field): the same database state always serializes to the same
// snapshot, byte for byte.

export interface ScheduleTeam {
  readonly id: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly primaryColor: string | null;
}

export interface ScheduleGround {
  readonly id: string;
  readonly name: string;
  readonly surface: GroundSurface;
  readonly capacity: number | null;
  readonly floodlights: boolean;
  readonly indoor: boolean;
  readonly status: GroundStatus;
}

export interface ScheduleVenue {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly city: string | null;
  readonly grounds: readonly ScheduleGround[];
}

export interface ScheduleSnapshot {
  readonly competition: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly code: string; // the fixture-number prefix, e.g. MPL26
    readonly status: CompetitionStatus;
    readonly location: string | null;
    readonly startsOn: string | null;
    readonly endsOn: string | null;
  };
  readonly teams: readonly ScheduleTeam[]; // (name, id) order
  readonly venues: readonly ScheduleVenue[]; // only venues the schedule references
  readonly fixtures: readonly FixtureSnapshot[]; // seq order — total and stable
  readonly stats: FixtureStats;
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

/**
 * Build the snapshot. Every list carries a total, deterministic order (teams by
 * name+id, venues/grounds by name+id, fixtures by seq), so identical data
 * yields an identical — deeply frozen — value.
 */
export async function scheduleSnapshot(
  db: Db,
  competition: CompetitionSummary,
): Promise<ScheduleSnapshot> {
  const [teamRows, groundRows, fixtureRows, stats] = await Promise.all([
    db
      .select({
        id: teams.id,
        name: teams.name,
        shortName: teams.shortName,
        primaryColor: teams.primaryColor,
      })
      .from(teams)
      .where(eq(teams.competitionId, competition.id))
      .orderBy(asc(teams.name), asc(teams.id)),
    // Only grounds this schedule actually references (via its fixtures).
    db
      .selectDistinct({
        id: grounds.id,
        name: grounds.name,
        surface: grounds.surface,
        capacity: grounds.capacity,
        floodlights: grounds.floodlights,
        indoor: grounds.indoor,
        status: grounds.status,
        venueId: venues.id,
        venueName: venues.name,
        venueAddress: venues.address,
        venueCity: venues.city,
      })
      .from(fixtures)
      .innerJoin(grounds, eq(grounds.id, fixtures.groundId))
      .innerJoin(venues, eq(venues.id, grounds.venueId))
      .where(eq(fixtures.competitionId, competition.id))
      .orderBy(asc(venues.name), asc(venues.id), asc(grounds.name), asc(grounds.id)),
    competitionFixtureSnapshots(db, competition.id),
    fixtureStats(db, competition.id),
  ]);

  const venueMap = new Map<
    string,
    { venue: Omit<ScheduleVenue, "grounds">; grounds: ScheduleGround[] }
  >();
  for (const row of groundRows) {
    const entry = venueMap.get(row.venueId) ?? {
      venue: {
        id: row.venueId,
        name: row.venueName,
        address: row.venueAddress,
        city: row.venueCity,
      },
      grounds: [],
    };
    entry.grounds.push({
      id: row.id,
      name: row.name,
      surface: row.surface,
      capacity: row.capacity,
      floodlights: row.floodlights,
      indoor: row.indoor,
      status: row.status,
    });
    venueMap.set(row.venueId, entry);
  }

  return deepFreeze({
    competition: {
      id: competition.id,
      name: competition.name,
      slug: competition.slug,
      code: competitionCode(competition.name, competition.startsOn),
      status: competition.status,
      location: competition.location,
      startsOn: competition.startsOn,
      endsOn: competition.endsOn,
    },
    teams: teamRows,
    venues: [...venueMap.values()].map((entry) => ({ ...entry.venue, grounds: entry.grounds })),
    fixtures: fixtureRows,
    stats,
  });
}

// --- Serializations (pure — the snapshot in, bytes out) --------------------------

export const SCHEDULE_CSV_HEADER =
  "fixture_number,round,home_team,away_team,kickoff,venue,ground,status,duration_minutes";

/** The fixtures CSV export IS a serialization of the snapshot — nothing else. */
export function serializeScheduleCsv(snapshot: ScheduleSnapshot): string {
  const lines = snapshot.fixtures.map((f) =>
    [
      f.number,
      f.round === null ? "" : String(f.round),
      f.homeTeamName,
      f.awayTeamName,
      f.kickoffAt ?? "",
      f.venueName ?? "",
      f.groundName ?? "",
      f.status,
      f.durationMinutes === null ? "" : String(f.durationMinutes),
    ]
      .map(csvCell)
      .join(","),
  );
  return [SCHEDULE_CSV_HEADER, ...lines].join("\n");
}
