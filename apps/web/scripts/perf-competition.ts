// Competition performance harness (M-IP3-4). Seeds a 520-fixture competition +
// a 300-registration competition against the local database, measures the hot
// read/mutation paths with real timings (median + p95 over N runs), prints a
// report, and cleans up after itself. Rerunnable evidence for the freeze
// PERFORMANCE record: `pnpm --filter @desiauction/web perf:competition`.
import { performance } from "node:perf_hooks";

import { detectConflicts, registrationNumber, type FixtureForConflicts } from "@desiauction/core";
import {
  auditLog,
  competitions,
  createDb,
  fixtures,
  grounds,
  newId,
  organizations,
  orgMembers,
  people,
  registrations,
  teams,
  venues,
} from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";

import {
  competitionConflicts,
  rescheduleFixture,
} from "../src/server/competition/fixture-aggregate.js";
import { fixtureStats, queryFixtures } from "../src/server/competition/fixtures.js";
import { queryRegistrations, registrationStats } from "../src/server/competition/registrations.js";
import {
  scheduleSnapshot,
  serializeScheduleCsv,
} from "../src/server/competition/schedule-snapshot.js";
import type { CompetitionSummary } from "../src/server/competition/competitions.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) {
  throw new Error("DATABASE_URL is required (run via pnpm perf:competition)");
}
const handle = createDb(DATABASE_URL);
const db = handle.db;

const RUN = `perf${String(Date.now()).slice(-6)}`;

async function measure(name: string, runs: number, fn: () => Promise<unknown>): Promise<void> {
  const samples: number[] = [];
  await fn(); // warm-up (connection, plan cache)
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] ?? 0;
  const p95 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)] ?? 0;
  console.log(
    `${name.padEnd(58)} median ${median.toFixed(1).padStart(7)} ms · p95 ${p95.toFixed(1).padStart(7)} ms · n=${String(runs)}`,
  );
}

async function main(): Promise<void> {
  const personId = newId();
  const orgId = newId();
  const ids = {
    venues: [] as string[],
    grounds: [] as string[],
    competitions: [] as string[],
    people: [personId],
  };
  await db
    .insert(people)
    .values({ id: personId, phone: `+9190${RUN.slice(-6)}0`, name: "Perf Actor" });
  await db
    .insert(organizations)
    .values({ id: orgId, name: `Perf Org ${RUN}`, slug: `perf-${RUN}`, createdBy: personId });
  await db.insert(orgMembers).values({ orgId, personId });

  // --- 520-fixture competition ---------------------------------------------------
  const fixComp: CompetitionSummary = {
    id: newId(),
    orgId,
    tournamentId: null,
    name: `Perf Fixtures ${RUN}`,
    slug: `perf-fix-${RUN}`,
    status: "draft",
    visibility: "private" as const,
    entryCategory: "open" as const,
    sport: "cricket",
    location: "Local",
    startsOn: "2026-01-01",
    endsOn: "2027-12-31",
  };
  ids.competitions.push(fixComp.id);
  await db.insert(competitions).values({ ...fixComp, sport: "cricket", createdBy: personId });
  const venueId = newId();
  ids.venues.push(venueId);
  await db
    .insert(venues)
    .values({ id: venueId, orgId, name: `Perf Venue ${RUN}`, createdBy: personId });
  const groundIds = Array.from({ length: 4 }, () => newId());
  ids.grounds.push(...groundIds);
  await db.insert(grounds).values(
    groundIds.map((id, i) => ({
      id,
      orgId,
      venueId,
      name: `Ground ${String(i)} ${RUN}`,
      createdBy: personId,
    })),
  );
  const teamIds = Array.from({ length: 12 }, () => newId());
  await db.insert(teams).values(
    teamIds.map((id, i) => ({
      id,
      orgId,
      competitionId: fixComp.id,
      name: `Perf Team ${String(i).padStart(2, "0")} ${RUN}`,
      createdBy: personId,
    })),
  );
  // 520 fixtures: spread across days/times/grounds so intervals rarely collide.
  const FIXTURE_COUNT = 520;
  const rows = Array.from({ length: FIXTURE_COUNT }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 8)));
    const date = day.toISOString().slice(0, 10);
    const time = ["09:00", "12:00", "15:00", "18:00", "09:30", "12:30", "15:30", "18:30"][
      i % 8
    ] as string;
    return {
      id: newId(),
      orgId,
      competitionId: fixComp.id,
      fixtureNumber: `PF26-F${String(i + 1).padStart(3, "0")}`,
      seq: i + 1,
      round: Math.floor(i / 6) + 1,
      homeTeamId: teamIds[i % 12] as string,
      awayTeamId: teamIds[(i + 1 + (i % 10)) % 12] as string,
      groundId: groundIds[i % 4] as string,
      kickoffAt: `${date}T${time}`,
      durationMinutes: 120,
      status: "published" as const,
      createdBy: personId,
    };
  }).filter((r) => r.homeTeamId !== r.awayTeamId);
  await db.insert(fixtures).values(rows);
  console.log(`\nSeeded ${String(rows.length)} fixtures / 12 teams / 4 grounds — measuring:\n`);

  await measure("fixtureStats (520 fixtures)", 20, () => fixtureStats(db, fixComp.id));
  await measure("queryFixtures page 1 of 21 (25/page, kickoff sort)", 20, () =>
    queryFixtures(db, fixComp.id, { sort: "kickoff", page: 1, pageSize: 25 }),
  );
  await measure("queryFixtures deep page 21 of 21", 20, () =>
    queryFixtures(db, fixComp.id, { sort: "kickoff", page: 21, pageSize: 25 }),
  );
  await measure("queryFixtures filtered (status+team+search)", 20, () =>
    queryFixtures(db, fixComp.id, {
      status: "published",
      teamId: teamIds[0] as string,
      search: "F0",
      page: 1,
      pageSize: 25,
    }),
  );

  // Pure conflict engine over the full org set (the aggregate's in-memory check).
  const conflictInput: FixtureForConflicts[] = rows.map((r) => ({
    id: r.id,
    homeTeamId: r.homeTeamId,
    awayTeamId: r.awayTeamId,
    groundId: r.groundId,
    venueId,
    kickoffAt: r.kickoffAt,
    durationMinutes: r.durationMinutes,
    status: r.status,
  }));
  await measure("conflict engine, pure (520 fixtures, pairwise)", 20, () =>
    Promise.resolve(
      detectConflicts(conflictInput, { startsOn: "2026-01-01", endsOn: "2027-12-31" }),
    ),
  );
  await measure("competitionConflicts (DB load + engine)", 20, () =>
    competitionConflicts(db, fixComp),
  );
  const target = rows[rows.length - 1] as (typeof rows)[number];
  await measure("rescheduleFixture (conflict-checked mutation + audit)", 20, () =>
    rescheduleFixture(db, fixComp, target.id, personId, {
      kickoffAt: "2027-11-30T18:00",
      groundId: target.groundId,
    }),
  );

  await measure("scheduleSnapshot (520 fixtures, full projection)", 20, () =>
    scheduleSnapshot(db, fixComp),
  );
  const snapshot = await scheduleSnapshot(db, fixComp);
  await measure("serializeScheduleCsv (pure, 520 rows)", 20, () =>
    Promise.resolve(serializeScheduleCsv(snapshot)),
  );

  // --- 300-registration dashboard --------------------------------------------------
  const regComp: CompetitionSummary = { ...fixComp, id: newId(), slug: `perf-reg-${RUN}` };
  ids.competitions.push(regComp.id);
  await db.insert(competitions).values({ ...regComp, sport: "cricket", createdBy: personId });
  const regPeople = Array.from({ length: 300 }, (_, i) => ({
    id: newId(),
    phone: `+9191${RUN.slice(-4)}${String(i).padStart(3, "0")}`,
    name: `Perf Player ${String(i)}`,
  }));
  ids.people.push(...regPeople.map((p) => p.id));
  await db.insert(people).values(regPeople);
  await db.insert(registrations).values(
    regPeople.map((p, i) => {
      const id = newId();
      return {
        id,
        orgId,
        competitionId: regComp.id,
        personId: p.id,
        role: "batter" as const,
        status: (["submitted", "approved", "waitlisted"] as const)[i % 3] as "submitted",
        registrationNumber: registrationNumber(id),
      };
    }),
  );
  console.log("");
  await measure("registrationStats (300 registrations)", 20, () =>
    registrationStats(db, regComp.id),
  );
  await measure("queryRegistrations page 1 (search+sort, 25/page)", 20, () =>
    queryRegistrations(db, regComp.id, { search: "Perf", sort: "name", page: 1, pageSize: 25 }),
  );
  await measure("queryRegistrations deep page 12", 20, () =>
    queryRegistrations(db, regComp.id, { sort: "number", page: 12, pageSize: 25 }),
  );

  // --- Cleanup ---------------------------------------------------------------------
  await db.delete(registrations).where(eq(registrations.orgId, orgId));
  await db.delete(fixtures).where(eq(fixtures.orgId, orgId));
  await db.delete(teams).where(eq(teams.orgId, orgId));
  await db.delete(grounds).where(eq(grounds.orgId, orgId));
  await db.delete(venues).where(eq(venues.orgId, orgId));
  await db.delete(competitions).where(inArray(competitions.id, ids.competitions));
  await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(people).where(inArray(people.id, ids.people));
  await handle.sql.end();
  console.log("\ncleanup complete");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
