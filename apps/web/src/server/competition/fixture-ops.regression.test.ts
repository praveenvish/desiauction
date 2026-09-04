// PERMANENT FIXTURES & VENUES REGRESSION SUITE (M-IP3-3). Encodes the scheduling
// contract: deterministic generation + ordering, conflict detection (team/ground
// overlap, window), reschedule correctness, illegal transitions, published
// fixture protection, completed fixture immutability, mutation rollback safety,
// CSV import validation + rollback, export authorization + tenant scoping, audit
// completeness, RLS read+write proofs, and the 500+ fixture scale target.
// Real Postgres; unique phones/orgs per run.
import { competitionCode, fixtureNumber, parseFixtureCsv } from "@desiauction/core";
import {
  auditLog,
  competitions as competitionsTable,
  createDb,
  fixtures as fixturesTable,
  grants as grantsTable,
  grounds as groundsTable,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  people,
  sessions,
  teams as teamsTable,
  venues as venuesTable,
  type DbHandle,
} from "@desiauction/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { createOrg } from "../orgs/orgs";
import { canCompetition } from "./authz";
import { recordFixtureResult, resultOf, standingsOf } from "./results";
import { createCompetition, createTeam, type CompetitionSummary } from "./competitions";
import {
  cancelFixture,
  competitionConflicts,
  completeFixture,
  createFixture,
  editFixture,
  generateFixtures,
  publishAllScheduled,
  publishFixture,
  rescheduleFixture,
  scheduleAllDrafts,
  scheduleFixture,
  startFixture,
} from "./fixture-aggregate";
import { commitFixtureImport, importDryRun } from "./fixture-import";
import {
  calendarRange,
  competitionTimeline,
  fixtureStats,
  fixtureTimeline,
  matchDay,
  publishedSchedule,
  queryFixtures,
  PUBLIC_SCHEDULE_LIMIT,
  upcomingFixtures,
} from "./fixtures";
import { scheduleSnapshot, serializeScheduleCsv } from "./schedule-snapshot";
import { activeGroundsOf, createGround, createVenue, setGroundStatus, venuesOf } from "./venues";
import { purgeOrg } from "../test-support/purge-org";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9198${RUN}1`;
const PHONE_OUTSIDER = `+9196${RUN}3`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OUTSIDER];

let owner = "";
let outsider = "";
let org = { id: "", name: "", slug: "" };
let orgRival = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let venueId = "";
let groundA = "";
let groundB = "";
const teamIds: string[] = [];

async function login(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const [row] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const verified = await verifyOtp(db, phone, row?.code ?? "");
  if (!verified.ok) {
    throw new Error("login failed");
  }
  return verified.personId;
}

function must<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label}`);
  }
  return value;
}

async function statusOf(id: string): Promise<string> {
  const [row] = await db
    .select({ status: fixturesTable.status })
    .from(fixturesTable)
    .where(eq(fixturesTable.id, id))
    .limit(1);
  return row?.status ?? "missing";
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  outsider = await login(PHONE_OUTSIDER);
  org = await createOrg(db, owner, `Fix Org ${RUN}`);
  orgRival = await createOrg(db, outsider, `Fix Rival ${RUN}`);
  comp = await createCompetition(db, org.id, owner, {
    name: `Malad Premier League ${RUN}`,
    location: "Malad",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  });
  const venue = await createVenue(db, org.id, owner, "Azad Maidan", "Mahapalika Marg", "Mumbai");
  if (!venue.ok) {
    throw new Error("venue setup failed");
  }
  venueId = venue.venue.id;
  const a = await createGround(db, org.id, venueId, owner, { name: "Main Oval" });
  const b = await createGround(db, org.id, venueId, owner, { name: "Side Strip" });
  if (!a.ok || !b.ok) {
    throw new Error("ground setup failed");
  }
  groundA = a.ground.id;
  groundB = b.ground.id;
  for (const name of ["Andheri Arrows", "Bandra Blasters", "Colaba Kings", "Dadar Daredevils"]) {
    const team = await createTeam(db, org.id, comp.id, owner, name);
    if (!team.ok) {
      throw new Error("team setup failed");
    }
    teamIds.push(team.team.id);
  }
});

afterAll(async () => {
  const orgIds = [org.id, orgRival.id].filter((id) => id !== "");
  // PA-1R Phase 3: the spine these teardowns never deleted (purge-org.ts).
  for (const purgeId of orgIds) {
    await purgeOrg(db, purgeId);
  }
  const personIds = [owner, outsider].filter((id) => id !== "");
  if (orgIds.length > 0) {
    await db.delete(fixturesTable).where(inArray(fixturesTable.orgId, orgIds));
    await db.delete(groundsTable).where(inArray(groundsTable.orgId, orgIds));
    await db.delete(venuesTable).where(inArray(venuesTable.orgId, orgIds));
    await db.delete(teamsTable).where(inArray(teamsTable.orgId, orgIds));
    await db.delete(competitionsTable).where(inArray(competitionsTable.orgId, orgIds));
    await db.delete(grantsTable).where(inArray(grantsTable.scopeId, orgIds));
    await db.delete(orgMembers).where(inArray(orgMembers.orgId, orgIds));
    await db.delete(auditLog).where(inArray(auditLog.scopeId, orgIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  if (personIds.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, personIds));
    await db.delete(auditLog).where(inArray(auditLog.actor, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await handle.sql.end();
});

describe("FIXTURE OPS REGRESSION — venues & availability", () => {
  it("venue and ground creation is audited; duplicates are refused", async () => {
    const dupVenue = await createVenue(db, org.id, owner, "Azad Maidan");
    expect(dupVenue).toEqual({ ok: false, reason: "duplicate_name" });
    const dupGround = await createGround(db, org.id, venueId, owner, { name: "Main Oval" });
    expect(dupGround).toEqual({ ok: false, reason: "duplicate_name" });
    const list = await venuesOf(db, org.id);
    expect(list.length).toBe(1);
    expect(list[0]?.grounds.length).toBe(2);
  });

  it("a foreign venue cannot receive this org's ground (tenant safety)", async () => {
    const foreign = await createVenue(db, orgRival.id, outsider, "Rival Park");
    if (!foreign.ok) {
      throw new Error("rival venue failed");
    }
    expect(
      await createGround(db, org.id, foreign.venue.id, owner, { name: "Sneaky Pitch" }),
    ).toEqual({ ok: false, reason: "venue_not_found" });
  });

  it("availability: an unavailable ground leaves the active picker", async () => {
    const before = await activeGroundsOf(db, org.id);
    expect(before.map((g) => g.id)).toContain(groundB);
    expect((await setGroundStatus(db, org.id, groundB, owner, "unavailable")).ok).toBe(true);
    const after = await activeGroundsOf(db, org.id);
    expect(after.map((g) => g.id)).not.toContain(groundB);
    expect((await setGroundStatus(db, org.id, groundB, owner, "active")).ok).toBe(true);
  });

  it("capability: the owner holds venue.manage + fixture.manage; an outsider holds neither", async () => {
    const scope = { orgId: org.id, competitionId: comp.id };
    expect(await canCompetition(db, owner, scope, "fixture.manage")).toBe(true);
    expect(await canCompetition(db, outsider, scope, "fixture.manage")).toBe(false);
  });
});

describe("FIXTURE OPS REGRESSION — deterministic generation", () => {
  const GEN = {
    rounds: 1 as const,
    startDate: "2026-08-01",
    kickoffTimes: ["18:00", "20:00"],
    durationMinutes: 120,
  };

  it("generates the full round robin as drafts with stable numbers and ordering", async () => {
    const result = await generateFixtures(db, comp, owner, {
      ...GEN,
      groundIds: [groundA, groundB],
    });
    expect(result).toEqual({ ok: true, created: 6 }); // C(4,2)
    const page = await queryFixtures(db, comp.id, { sort: "number", page: 1, pageSize: 50 });
    expect(page.total).toBe(6);
    expect(page.rows.every((f) => f.status === "draft")).toBe(true);
    // Deterministic numbers: <code>-F001..F006 (competition code from name+year).
    const code = competitionCode(comp.name, comp.startsOn);
    expect(page.rows.map((f) => f.number)).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => fixtureNumber(code, n)),
    );
    // Kickoff ordering is total and stable (seq tiebreak).
    const kickoffSorted = await queryFixtures(db, comp.id, {
      sort: "kickoff",
      page: 1,
      pageSize: 50,
    });
    const kickoffs = kickoffSorted.rows.map((f) => f.kickoffAt ?? "");
    expect(kickoffs).toEqual([...kickoffs].sort());
    // No blocking conflicts anywhere in the generated schedule.
    const conflicts = await competitionConflicts(db, comp);
    expect(conflicts.filter((c) => c.severity === "blocking")).toEqual([]);
  });

  /**
   * The home/away balance, asserted on the PERSISTED schedule rather than only
   * on the pure planner. Single round robin is the UI default, and it used to
   * hand exactly one team every single one of its fixtures away — reproduced in
   * the product as Panthers 0 home / 3 away over four teams.
   */
  it("HOME ADVANTAGE: no team is shut out of home fixtures in the written schedule", async () => {
    const page = await queryFixtures(db, comp.id, { sort: "number", page: 1, pageSize: 50 });
    const home = new Map<string, number>();
    const away = new Map<string, number>();
    for (const fixture of page.rows) {
      home.set(fixture.homeTeamName, (home.get(fixture.homeTeamName) ?? 0) + 1);
      away.set(fixture.awayTeamName, (away.get(fixture.awayTeamName) ?? 0) + 1);
    }
    const names = [...new Set([...home.keys(), ...away.keys()])];
    expect(names.length).toBe(4);
    for (const name of names) {
      const h = home.get(name) ?? 0;
      const a = away.get(name) ?? 0;
      expect(h + a).toBe(3);
      expect(h).toBeGreaterThan(0);
      expect(Math.abs(h - a)).toBeLessThanOrEqual(1);
    }
  });

  it("generation is deterministic: an identical competition yields the identical schedule", async () => {
    const mk = async (name: string) => {
      const c = await createCompetition(db, org.id, owner, {
        name,
        startsOn: "2026-10-01",
        endsOn: "2026-10-30",
      });
      for (const teamName of ["T Alpha", "T Bravo", "T Charlie"]) {
        await createTeam(db, org.id, c.id, owner, teamName);
      }
      const generated = await generateFixtures(db, c, owner, {
        ...GEN,
        startDate: "2026-10-01",
        groundIds: [groundA],
      });
      expect(generated).toEqual({ ok: true, created: 3 });
      const rows = await db
        .select({
          id: fixturesTable.id,
          seq: fixturesTable.seq,
          round: fixturesTable.round,
          home: fixturesTable.homeTeamId,
          away: fixturesTable.awayTeamId,
          kickoff: fixturesTable.kickoffAt,
          ground: fixturesTable.groundId,
        })
        .from(fixturesTable)
        .where(eq(fixturesTable.competitionId, c.id))
        .orderBy(asc(fixturesTable.seq));
      // Release the slots (drafts hold them for conflict prevention) so the
      // second identical competition can occupy the identical schedule.
      for (const row of rows) {
        expect((await cancelFixture(db, c, row.id, owner)).ok).toBe(true);
      }
      // Normalize team ids to names for cross-competition comparison.
      const names = new Map(
        (
          await db
            .select({ id: teamsTable.id, name: teamsTable.name })
            .from(teamsTable)
            .where(eq(teamsTable.competitionId, c.id))
        ).map((t) => [t.id, t.name]),
      );
      return rows.map((r) => ({
        seq: r.seq,
        round: r.round,
        home: names.get(r.home),
        away: names.get(r.away),
        kickoff: r.kickoff,
        ground: r.ground,
      }));
    };
    const first = await mk(`Det One ${RUN}`);
    const second = await mk(`Det Two ${RUN}`);
    expect(second).toEqual(first);
  });

  it("generation is refused while live fixtures exist (stable numbers forever)", async () => {
    expect(await generateFixtures(db, comp, owner, { ...GEN, groundIds: [groundA] })).toEqual({
      ok: false,
      reason: "fixtures_exist",
    });
  });
});

describe("FIXTURE OPS REGRESSION — lifecycle, conflicts, protection", () => {
  it("schedule all drafts → publish all; the machine refuses shortcuts", async () => {
    const drafts = await queryFixtures(db, comp.id, { status: "draft", page: 1, pageSize: 50 });
    const firstDraft = must(drafts.rows[0], "a draft");
    // Publishing a draft is an illegal transition (no hidden edges).
    expect(await publishFixture(db, comp, firstDraft.id, owner)).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    const scheduled = await scheduleAllDrafts(db, comp, owner);
    expect(scheduled).toEqual({ applied: 6, skipped: 0 });
    // Completing a scheduled fixture is illegal (must pass through published+started).
    expect(await completeFixture(db, comp, firstDraft.id, owner)).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    const published = await publishAllScheduled(db, comp, owner);
    expect(published).toEqual({ applied: 6, skipped: 0 });
    expect((await fixtureStats(db, comp.id)).published).toBe(6);
  });

  it("TEAM OVERLAP: scheduling a fixture that double-books a team is refused", async () => {
    const existing = must(
      (await queryFixtures(db, comp.id, { status: "published", page: 1, pageSize: 1 })).rows[0],
      "a published fixture",
    );
    const free = teamIds.filter((id) => id !== existing.homeTeamId && id !== existing.awayTeamId);
    // A new fixture sharing a team, at the same instant, on the OTHER ground.
    const created = await createFixture(db, comp, owner, {
      homeTeamId: existing.homeTeamId,
      awayTeamId: must(free[0], "a free team"),
      groundId: existing.groundId === groundA ? groundB : groundA,
      kickoffAt: existing.kickoffAt ?? "2026-08-01T18:00",
      durationMinutes: 120,
    });
    if (!created.ok) {
      throw new Error("create failed");
    }
    const refused = await scheduleFixture(db, comp, created.fixtureId, owner);
    expect(refused.ok).toBe(false);
    if (refused.ok || refused.reason !== "conflicts") {
      throw new Error("expected a conflicts refusal");
    }
    expect(refused.conflicts.some((c) => c.type === "team_double_booking")).toBe(true);
    // Resolve: move the draft to a free evening — now it schedules.
    const resolved = await scheduleFixture(db, comp, created.fixtureId, owner, {
      kickoffAt: "2026-09-10T18:00",
    });
    expect(resolved.ok).toBe(true);
    await cancelFixture(db, comp, created.fixtureId, owner, "test cleanup");
  });

  it("GROUND OVERLAP: two fixtures cannot share a ground simultaneously", async () => {
    const existing = must(
      (await queryFixtures(db, comp.id, { status: "published", page: 1, pageSize: 1 })).rows[0],
      "a published fixture",
    );
    const others = teamIds.filter((id) => id !== existing.homeTeamId && id !== existing.awayTeamId);
    const created = await createFixture(db, comp, owner, {
      homeTeamId: must(others[0], "free team"),
      awayTeamId: must(others[1], "free team"),
      groundId: existing.groundId ?? groundA,
      kickoffAt: existing.kickoffAt ?? "2026-08-01T18:00",
      durationMinutes: 120,
    });
    if (!created.ok) {
      throw new Error("create failed");
    }
    const refused = await scheduleFixture(db, comp, created.fixtureId, owner);
    if (refused.ok || refused.reason !== "conflicts") {
      throw new Error("expected a conflicts refusal");
    }
    expect(refused.conflicts.some((c) => c.type === "ground_double_booking")).toBe(true);
    await cancelFixture(db, comp, created.fixtureId, owner);
  });

  it("WINDOW: a fixture outside the competition dates is refused at scheduling", async () => {
    const created = await createFixture(db, comp, owner, {
      homeTeamId: must(teamIds[0], "team"),
      awayTeamId: must(teamIds[1], "team"),
      groundId: groundA,
      kickoffAt: "2026-12-25T18:00", // after endsOn 2026-09-15
      durationMinutes: 120,
    });
    if (!created.ok) {
      throw new Error("create failed");
    }
    const refused = await scheduleFixture(db, comp, created.fixtureId, owner);
    if (refused.ok || refused.reason !== "conflicts") {
      throw new Error("expected a conflicts refusal");
    }
    expect(refused.conflicts.some((c) => c.type === "outside_competition_dates")).toBe(true);
    await cancelFixture(db, comp, created.fixtureId, owner);
  });

  it("RESCHEDULE CORRECTNESS: published fixtures move only via the workflow, with provenance", async () => {
    const published = must(
      (await queryFixtures(db, comp.id, { status: "published", page: 1, pageSize: 1 })).rows[0],
      "a published fixture",
    );
    // Direct edit on a published fixture is refused (published protection).
    expect(
      await editFixture(db, comp, published.id, owner, { kickoffAt: "2026-09-01T18:00" }),
    ).toEqual({ ok: false, reason: "illegal_transition" });
    // The reschedule workflow works and records old → new in the audit trail.
    const fromKickoff = published.kickoffAt ?? "";
    const moved = await rescheduleFixture(db, comp, published.id, owner, {
      kickoffAt: "2026-09-01T18:00",
    });
    expect(moved).toEqual({ ok: true, status: "published" });
    const timeline = await fixtureTimeline(db, published.id);
    const reschedule = timeline.find((t) => t.action === "fixture.rescheduled");
    expect(reschedule).toBeDefined();
    const meta = reschedule?.meta as { fromKickoff?: string; toKickoff?: string };
    expect(meta.fromKickoff).toBe(fromKickoff);
    expect(meta.toKickoff).toBe("2026-09-01T18:00");
    // A reschedule INTO an occupied slot is refused (conflict prevention).
    const other = must(
      (await queryFixtures(db, comp.id, { status: "published", page: 1, pageSize: 10 })).rows.find(
        (f) => f.id !== published.id && f.kickoffAt !== null,
      ),
      "another published fixture",
    );
    const clash = await rescheduleFixture(db, comp, published.id, owner, {
      kickoffAt: other.kickoffAt ?? "",
      groundId: other.groundId ?? groundA,
    });
    expect(clash.ok).toBe(false);
  });

  it("COMPLETED IMMUTABILITY: a completed fixture accepts no mutation, permanently", async () => {
    const target = must(
      (await queryFixtures(db, comp.id, { status: "published", page: 1, pageSize: 1 })).rows[0],
      "a published fixture",
    );
    expect((await startFixture(db, comp, target.id, owner)).ok).toBe(true);
    expect((await completeFixture(db, comp, target.id, owner)).ok).toBe(true);
    expect(await statusOf(target.id)).toBe("completed");
    expect(
      await rescheduleFixture(db, comp, target.id, owner, { kickoffAt: "2026-09-05T18:00" }),
    ).toEqual({ ok: false, reason: "illegal_transition" });
    expect(await editFixture(db, comp, target.id, owner, { durationMinutes: 90 })).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    expect(await cancelFixture(db, comp, target.id, owner)).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
  });

  it("CANCEL releases the slot: another fixture can take it", async () => {
    const victim = must(
      (await queryFixtures(db, comp.id, { status: "published", page: 1, pageSize: 10 })).rows.find(
        (f) => f.kickoffAt !== null && f.groundId !== null,
      ),
      "a published fixture with a slot",
    );
    const slot = { kickoffAt: victim.kickoffAt ?? "", groundId: victim.groundId ?? "" };
    expect((await cancelFixture(db, comp, victim.id, owner, "rain")).ok).toBe(true);
    const replacement = await createFixture(db, comp, owner, {
      homeTeamId: victim.homeTeamId,
      awayTeamId: victim.awayTeamId,
      groundId: slot.groundId,
      kickoffAt: slot.kickoffAt,
      durationMinutes: 120,
    });
    if (!replacement.ok) {
      throw new Error("create failed");
    }
    expect((await scheduleFixture(db, comp, replacement.fixtureId, owner)).ok).toBe(true);
  });

  it("ROLLBACK SAFETY: a mid-transaction failure leaves NO partial state", async () => {
    const target = must(
      (await queryFixtures(db, comp.id, { status: "scheduled", page: 1, pageSize: 1 })).rows[0],
      "a scheduled fixture",
    );
    // An over-length orgId makes the audit insert fail (char(26)) AFTER the
    // status update inside the same transaction — everything must roll back.
    const doctored = { ...comp, orgId: "THIS_ORG_ID_IS_WAY_TOO_LONG_FOR_CHAR_26" };
    await expect(cancelFixture(db, doctored, target.id, owner)).rejects.toThrow();
    expect(await statusOf(target.id)).toBe("scheduled");
  });

  it("AUDIT COMPLETENESS: every lifecycle step wrote its audit row", async () => {
    const completed = must(
      (await queryFixtures(db, comp.id, { status: "completed", page: 1, pageSize: 1 })).rows[0],
      "a completed fixture",
    );
    const actions = (await fixtureTimeline(db, completed.id)).map((t) => t.action);
    for (const expected of [
      "fixture.schedule",
      "fixture.publish",
      "fixture.start",
      "fixture.complete",
    ]) {
      expect(actions).toContain(expected);
    }
  });
});

describe("FIXTURE OPS REGRESSION — calendar, import/export, isolation, scale", () => {
  it("calendar day/range and match-day group deterministically", async () => {
    const timeline = await competitionTimeline(db, comp.id);
    expect(timeline.length).toBeGreaterThan(0);
    const kickoffs = timeline.map((f) => f.kickoffAt ?? "");
    expect(kickoffs).toEqual([...kickoffs].sort());
    const firstDate = (timeline[0]?.kickoffAt ?? "").slice(0, 10);
    const day = await calendarRange(db, comp.id, firstDate, firstDate);
    expect(day.length).toBe(1);
    expect(day[0]?.date).toBe(firstDate);
    const groups = await matchDay(db, comp.id, firstDate);
    expect(groups.length).toBeGreaterThan(0);
    const upcoming = await upcomingFixtures(db, comp.id, `${firstDate}T00:00`);
    expect(upcoming.every((f) => f.status !== "cancelled" && f.status !== "completed")).toBe(true);
  });

  it("the published schedule reports its TOTAL, not just the page it returns", async () => {
    /*
     * The bug: the public competition page asked for page 1 at a page size of
     * 100 and discarded the total. A season with more than 100 published
     * fixtures rendered 100 of them under a heading reading "Published
     * schedule", and nothing on the page admitted the rest existed — a
     * spectator looking for a late-season match concluded it was unscheduled.
     *
     * The count must therefore be the count of ALL published fixtures, never
     * the length of the returned page, which is what makes it possible for the
     * page to say "showing the first N of M".
     */
    const published = await publishedSchedule(db, comp.id);
    const [{ count }] = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(fixturesTable)
      .where(
        and(eq(fixturesTable.competitionId, comp.id), eq(fixturesTable.status, "published")),
      )) as [{ count: number }];
    expect(published.total, "the total counts every published fixture").toBe(count);
    expect(published.rows.length).toBeLessThanOrEqual(PUBLIC_SCHEDULE_LIMIT);
    expect(published.rows.every((row) => row.status === "published")).toBe(true);
    const kickoffs = published.rows.map((row) => row.kickoffAt ?? "");
    expect(kickoffs, "kickoff order, as a schedule is read").toEqual([...kickoffs].sort());
  });

  it("CSV IMPORT VALIDATION: an unknown team refuses the WHOLE file (no partial writes)", async () => {
    const before = (await fixtureStats(db, comp.id)).total;
    const csv =
      "home_team,away_team,kickoff,ground,duration_minutes\n" +
      "Andheri Arrows,Bandra Blasters,2026-09-12 10:00,Main Oval,120\n" +
      "Ghost Team,Colaba Kings,2026-09-12 14:00,Main Oval,120";
    const parsed = parseFixtureCsv(csv);
    expect(parsed.errors).toEqual([]);
    const result = await commitFixtureImport(db, comp, owner, parsed.rows);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected refusal");
    }
    expect(result.errors[0]?.message).toContain("Ghost Team");
    expect((await fixtureStats(db, comp.id)).total).toBe(before);
  });

  it("CSV IMPORT: a fully-valid file lands as drafts, atomically, audited", async () => {
    const before = (await fixtureStats(db, comp.id)).total;
    const csv =
      "home_team,away_team,kickoff,ground,duration_minutes\n" +
      "Andheri Arrows,Bandra Blasters,2026-09-12 10:00,Main Oval,120\n" +
      "Colaba Kings,Dadar Daredevils,,,";
    const parsed = parseFixtureCsv(csv);
    const result = await commitFixtureImport(db, comp, owner, parsed.rows);
    expect(result).toEqual({ ok: true, imported: 2 });
    expect((await fixtureStats(db, comp.id)).total).toBe(before + 2);
  });

  /**
   * Import was the one write path that never met the conflict engine. The Move
   * path REFUSED a team double-booking; the identical collision then succeeded
   * through Import, and the preview called it "1 valid row(s) · 0 error(s)".
   * The aggregate's contract — "the invariants are machine-enforced, not
   * UI-suggested" — has to be true at every door, so this asserts both doors.
   */
  it("CSV IMPORT GATE: a duplicate of a live fixture is refused, on its own line", async () => {
    const existing = (
      await queryFixtures(db, comp.id, { status: "published", page: 1, pageSize: 1 })
    ).rows[0];
    if (existing === undefined || existing.kickoffAt === null) {
      throw new Error("expected a published fixture to clash with");
    }
    const before = (await fixtureStats(db, comp.id)).total;
    const csv =
      "home_team,away_team,kickoff,ground,duration_minutes\n" +
      `${existing.homeTeamName},${existing.awayTeamName},${existing.kickoffAt.replace("T", " ")},${existing.groundName ?? ""},120`;
    const parsed = parseFixtureCsv(csv);
    expect(parsed.errors).toEqual([]);
    const dryRun = await importDryRun(db, comp, parsed.rows);
    expect(dryRun.length).toBeGreaterThan(0);
    expect(dryRun[0]?.line).toBe(2);
    expect(dryRun[0]?.message).toContain(existing.number);

    const result = await commitFixtureImport(db, comp, owner, parsed.rows);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected refusal");
    }
    expect(result.errors[0]?.line).toBe(2);
    expect(result.errors[0]?.message).toContain("booked twice");
    // Nothing was written — the refusal is a refusal, not a warning.
    expect((await fixtureStats(db, comp.id)).total).toBe(before);
  });

  it("IMPORT ROLLBACK: a failure mid-commit writes nothing", async () => {
    const before = (await fixtureStats(db, comp.id)).total;
    const csv =
      "home_team,away_team\n" +
      "Andheri Arrows,Colaba Kings\n" +
      "Bandra Blasters,Dadar Daredevils";
    const parsed = parseFixtureCsv(csv);
    const doctored = { ...comp, orgId: "THIS_ORG_ID_IS_WAY_TOO_LONG_FOR_CHAR_26" };
    await expect(commitFixtureImport(db, doctored, owner, parsed.rows)).rejects.toThrow();
    expect((await fixtureStats(db, comp.id)).total).toBe(before);
  });

  it("EXPORT: a pure snapshot serialization — seq order, tenant-scoped, authz enforced", async () => {
    const csv = serializeScheduleCsv(await scheduleSnapshot(db, comp));
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "fixture_number,round,home_team,away_team,kickoff,venue,ground,status,duration_minutes",
    );
    const numbers = lines.slice(1).map((l) => l.split(",")[0] ?? "");
    expect(numbers).toEqual([...numbers].sort());
    // Tenant scoping: a rival competition's fixtures never leak in.
    const rivalComp = await createCompetition(db, orgRival.id, outsider, { name: `Rival ${RUN}` });
    const rt1 = await createTeam(db, orgRival.id, rivalComp.id, outsider, "Rival Reds");
    const rt2 = await createTeam(db, orgRival.id, rivalComp.id, outsider, "Rival Blues");
    if (!rt1.ok || !rt2.ok) {
      throw new Error("rival team setup failed");
    }
    await createFixture(db, rivalComp, outsider, {
      homeTeamId: rt1.team.id,
      awayTeamId: rt2.team.id,
    });
    expect(serializeScheduleCsv(await scheduleSnapshot(db, comp))).not.toContain("Rival Reds");
    // Export authorization = fixture.manage, which the outsider lacks here.
    expect(
      await canCompetition(
        db,
        outsider,
        { orgId: org.id, competitionId: comp.id },
        "fixture.manage",
      ),
    ).toBe(false);
  });

  it("SCHEDULE SNAPSHOT: deterministic, deeply immutable, and complete (M-IP3-4)", async () => {
    const first = await scheduleSnapshot(db, comp);
    const second = await scheduleSnapshot(db, comp);
    // Deterministic: identical database state → identical snapshot value.
    expect(second).toEqual(first);
    expect(serializeScheduleCsv(second)).toBe(serializeScheduleCsv(first));
    // Deeply immutable: the snapshot and every nested node are frozen.
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.competition)).toBe(true);
    expect(Object.isFrozen(first.fixtures)).toBe(true);
    expect(first.fixtures.every((f) => Object.isFrozen(f))).toBe(true);
    expect(Object.isFrozen(first.venues)).toBe(true);
    expect(first.venues.every((v) => Object.isFrozen(v) && Object.isFrozen(v.grounds))).toBe(true);
    expect(Object.isFrozen(first.teams)).toBe(true);
    expect(Object.isFrozen(first.stats)).toBe(true);
    // Complete + consistent: fixtures reconcile with stats, ordering is total,
    // and every referenced ground resolves inside the snapshot itself.
    expect(first.fixtures.length).toBe(first.stats.total);
    expect(first.fixtures.map((f) => f.seq)).toEqual(
      [...first.fixtures.map((f) => f.seq)].sort((a, b) => a - b),
    );
    const groundIds = new Set(first.venues.flatMap((v) => v.grounds.map((g) => g.id)));
    for (const fixture of first.fixtures) {
      if (fixture.groundId !== null) {
        expect(groundIds.has(fixture.groundId)).toBe(true);
      }
    }
    // The competition code matches the fixture-number prefix.
    expect(first.fixtures.every((f) => f.number.startsWith(`${first.competition.code}-F`))).toBe(
      true,
    );
  });

  it("RLS PROOF (fixtures/venues/grounds): cross-tenant + no-context reads are empty", async () => {
    const role = `fix_rls_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select on venues, grounds, fixtures to ${role}`);
    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    try {
      const visible = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        return tx`select * from fixtures where org_id = ${org.id}`;
      });
      expect(visible.length).toBeGreaterThan(0);
      const cross = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        return tx`select * from fixtures where org_id = ${orgRival.id}`;
      });
      expect(cross.length).toBe(0);
      expect((await probe`select * from venues`).length).toBe(0);
      expect((await probe`select * from grounds`).length).toBe(0);
      expect((await probe`select * from fixtures`).length).toBe(0);
    } finally {
      await probe.end();
      await handle.sql.unsafe(`drop owned by ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  });

  it("RLS WRITE PROOF: a cross-tenant fixture insert is rejected by WITH CHECK", async () => {
    const role = `fix_wrls_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select, insert on fixtures to ${role}`);
    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    const [t1, t2] = teamIds;
    try {
      // Active tenant = org; attempt a fixture scoped to the RIVAL org -> denied.
      const cross = probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        await tx`insert into fixtures(id, org_id, competition_id, fixture_number, seq,
                   home_team_id, away_team_id, status, created_by)
                 values (${newId()}::char(26), ${orgRival.id}::char(26), ${comp.id}::char(26),
                         ${"XX-F999"}::text, ${999}::int, ${must(t1, "team")}::char(26),
                         ${must(t2, "team")}::char(26), ${"draft"}::text, ${owner}::char(26))`;
      });
      await expect(cross).rejects.toThrow(/row-level security/);
      // The ACTIVE tenant's insert is accepted.
      const okId = newId();
      await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        await tx`insert into fixtures(id, org_id, competition_id, fixture_number, seq,
                   home_team_id, away_team_id, status, created_by)
                 values (${okId}::char(26), ${org.id}::char(26), ${comp.id}::char(26),
                         ${"XX-F998"}::text, ${998}::int, ${must(t1, "team")}::char(26),
                         ${must(t2, "team")}::char(26), ${"draft"}::text, ${owner}::char(26))`;
      });
      const [written] = await db
        .select({ orgId: fixturesTable.orgId })
        .from(fixturesTable)
        .where(eq(fixturesTable.id, okId))
        .limit(1);
      expect(written?.orgId).toBe(org.id);
      await db.delete(fixturesTable).where(eq(fixturesTable.id, okId));
    } finally {
      await probe.end();
      await handle.sql.unsafe(`drop owned by ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  });

  it("SCALE: 520 fixtures page correctly, bounded per page, stats reconcile", async () => {
    const scaleComp = await createCompetition(db, org.id, owner, {
      name: `Scale Fixtures ${RUN}`,
      startsOn: "2026-08-01",
      endsOn: "2027-08-01",
    });
    const ta = await createTeam(db, org.id, scaleComp.id, owner, "Scale A");
    const tb = await createTeam(db, org.id, scaleComp.id, owner, "Scale B");
    if (!ta.ok || !tb.ok) {
      throw new Error("scale team setup failed");
    }
    const rows = Array.from({ length: 520 }, (_, i) => {
      const id = newId();
      const day = String(1 + (i % 28)).padStart(2, "0");
      const month = String(1 + (i % 12)).padStart(2, "0");
      return {
        id,
        orgId: org.id,
        competitionId: scaleComp.id,
        fixtureNumber: `SF26-F${String(i + 1).padStart(3, "0")}`,
        seq: i + 1,
        homeTeamId: ta.team.id,
        awayTeamId: tb.team.id,
        groundId: groundA,
        kickoffAt: `2026-${month}-${day}T18:00`,
        durationMinutes: 120,
        status: "draft" as const,
        createdBy: owner,
      };
    });
    await db.insert(fixturesTable).values(rows);
    const stats = await fixtureStats(db, scaleComp.id);
    expect(stats.total).toBe(520);
    expect(stats.draft).toBe(520);
    const p1 = await queryFixtures(db, scaleComp.id, { sort: "number", page: 1, pageSize: 25 });
    expect(p1.rows.length).toBe(25); // never the whole dataset
    expect(p1.total).toBe(520);
    const p2 = await queryFixtures(db, scaleComp.id, { sort: "number", page: 2, pageSize: 25 });
    const overlap = p1.rows.filter((r) => p2.rows.some((o) => o.id === r.id));
    expect(overlap).toEqual([]);
    const last = await queryFixtures(db, scaleComp.id, { sort: "number", page: 21, pageSize: 25 });
    expect(last.rows.length).toBe(20); // 520 = 20×25 + 20
    const beyond = await queryFixtures(db, scaleComp.id, {
      sort: "number",
      page: 22,
      pageSize: 25,
    });
    expect(beyond.rows.length).toBe(0);
  });
});

describe("RESULTS — who won, and the table derived from it", () => {
  /*
   * A fixture could be scheduled, published, started and marked `completed`
   * while the product recorded NOTHING about how it went. A club could run a
   * whole season here and nothing could say who won a match.
   *
   * The table is derived on every read rather than stored. What is asserted
   * here is that the derivation reads the FIXTURES as the authority on whether
   * a match stands — a result whose fixture was cancelled must stop counting,
   * which a stored table would get wrong until somebody rebuilt it.
   */
  let played = "";

  it("refuses a result for a match that was not played", async () => {
    const [draft] = await db
      .select({ id: fixturesTable.id })
      .from(fixturesTable)
      .where(and(eq(fixturesTable.competitionId, comp.id), eq(fixturesTable.status, "published")))
      .limit(1);
    const target = draft?.id ?? "";
    expect(target).not.toBe("");
    // Published is not played. A score on a game nobody turned up to would go
    // into the table exactly as if it had been.
    await db.update(fixturesTable).set({ status: "scheduled" }).where(eq(fixturesTable.id, target));
    expect(
      await recordFixtureResult(db, {
        orgId: org.id,
        fixtureId: target,
        actorId: owner,
        result: { outcome: "home_win", homeRuns: 100, awayRuns: 90 },
      }),
    ).toEqual({ ok: false, reason: "not_played" });
    await db.update(fixturesTable).set({ status: "completed" }).where(eq(fixturesTable.id, target));
    played = target;
  });

  it("refuses a declared winner with no score behind it", async () => {
    // Otherwise two points land on the table from a result that says nothing
    // about how anybody played, and contributes nothing to run rate.
    expect(
      await recordFixtureResult(db, {
        orgId: org.id,
        fixtureId: played,
        actorId: owner,
        result: { outcome: "home_win" },
      }),
    ).toEqual({ ok: false, reason: "winner_without_score" });
  });

  it("refuses an impossible score rather than storing it", async () => {
    expect(
      await recordFixtureResult(db, {
        orgId: org.id,
        fixtureId: played,
        actorId: owner,
        result: { outcome: "home_win", homeRuns: 100, homeWickets: 11, awayRuns: 90 },
      }),
    ).toEqual({ ok: false, reason: "impossible_score" });
  });

  it("records a result, and AMENDING it replaces rather than accumulates", async () => {
    const first = await recordFixtureResult(db, {
      orgId: org.id,
      fixtureId: played,
      actorId: owner,
      result: {
        outcome: "home_win",
        homeRuns: 180,
        homeWickets: 4,
        homeBalls: 120,
        awayRuns: 150,
        awayWickets: 8,
        awayBalls: 120,
      },
    });
    expect(first).toEqual({ ok: true, amended: false });

    // A scorer correcting themselves — a misread board, a late penalty run.
    const second = await recordFixtureResult(db, {
      orgId: org.id,
      fixtureId: played,
      actorId: owner,
      result: {
        outcome: "home_win",
        homeRuns: 181,
        homeWickets: 4,
        homeBalls: 120,
        awayRuns: 150,
        awayWickets: 8,
        awayBalls: 120,
      },
    });
    expect(second, "the second is an amendment, and says so").toEqual({ ok: true, amended: true });

    const stored = await resultOf(db, played);
    expect(stored?.homeRuns, "one row, the current truth").toBe(181);
    // Named apart from the first recording: "who changed this afterwards" is
    // the question an aggrieved club asks, and one action cannot answer it.
    const actions = (
      await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.subject, played))
    ).map((row) => row.action);
    expect(actions).toContain("fixture.result.recorded");
    expect(actions).toContain("fixture.result.amended");
  });

  it("derives the table, and the FIXTURE decides whether a result still counts", async () => {
    const before = await standingsOf(db, comp.id);
    expect(before.recorded).toBe(1);
    const leader = before.rows[0];
    expect(leader?.played).toBe(1);
    expect(leader?.points).toBe(2);
    // Every team gets a row, including the four that have not played.
    expect(before.rows.length).toBeGreaterThan(1);

    /*
     * The property a stored table would get wrong. Cancelling the fixture must
     * remove its result from the standings immediately — the fixture is the
     * authority on whether the match stands, and a stale result must not hold
     * points open until somebody remembers to rebuild.
     */
    await db.update(fixturesTable).set({ status: "cancelled" }).where(eq(fixturesTable.id, played));
    const after = await standingsOf(db, comp.id);
    expect(after.recorded, "a cancelled fixture takes its result out of the table").toBe(0);
    expect(after.rows.every((row) => row.played === 0)).toBe(true);
    await db.update(fixturesTable).set({ status: "completed" }).where(eq(fixturesTable.id, played));
  });

  it("RLS: a rival tenant, and no tenant at all, read no results", async () => {
    /*
     * Through a real `nobypassrls` role, like the fixture proof above. The
     * default handle in this suite is the database owner, so a query through it
     * proves nothing about the policy — an earlier draft of this test passed a
     * cross-tenant read and would have called an unprotected table protected.
     */
    const role = `res_rls_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select on fixture_results to ${role}`);
    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    try {
      const mine = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${org.id}, true)`;
        return tx`select * from fixture_results where fixture_id = ${played}`;
      });
      expect(mine.length, "the owning tenant sees its own result").toBe(1);
      const cross = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgRival.id}, true)`;
        return tx`select * from fixture_results where fixture_id = ${played}`;
      });
      expect(cross.length, "a rival club cannot read this club's scores").toBe(0);
      expect((await probe`select * from fixture_results`).length, "no tenant, no rows").toBe(0);
    } finally {
      await probe.end();
      await handle.sql.unsafe(`drop owned by ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  });
});
