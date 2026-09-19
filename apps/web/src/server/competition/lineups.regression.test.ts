// LINEUPS — who played each match (launch polish, Phase 3), against real
// Postgres. The contract: a lineup is a SET per team per fixture (a save
// replaces it); only approved members of THAT team's squad in THAT season can
// be in it; and a player's career keeps "didn't play" apart from "nobody
// recorded it".
import {
  auditLog,
  createDb,
  fixtures as fixturesTable,
  newId,
  otpCodes,
  otpInbox,
  people,
  registrations,
  sessions,
  type DbHandle,
} from "@desiauction/db";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { createOrg } from "../orgs/orgs";
import { storage } from "../media";
import { playerMatches } from "../player/career";
import { purgeOrg } from "../test-support/purge-org";
import { createCompetition, createTeam, type CompetitionSummary } from "./competitions";
import { createFixture } from "./fixture-aggregate";
import { lineupFixtures, lineupSides, saveLineup } from "./lineups";
import { teamsWorkspace } from "./team-workspace";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);
const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9197${RUN}8`;

let owner = "";
let orgId = "";
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let other: CompetitionSummary = null as unknown as CompetitionSummary;
let teamA = "";
let teamB = "";
let teamC = "";
let fixtureId = "";
const players: { personId: string; registrationId: string }[] = [];

async function seedPlayer(competitionId: string, teamId: string, index: number) {
  const personId = newId();
  await db
    .insert(people)
    .values({ id: personId, phone: `+9193${RUN}${String(index)}`, name: `P${String(index)}` });
  const registrationId = newId();
  await db.insert(registrations).values({
    id: registrationId,
    orgId,
    competitionId,
    personId,
    role: "batter",
    status: "approved",
    teamId,
    registrationNumber: `R${RUN}${String(index)}`,
  });
  return { personId, registrationId };
}

beforeAll(async () => {
  await requestOtp(db, sender, PHONE_OWNER);
  const [code] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, PHONE_OWNER))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const verified = await verifyOtp(db, PHONE_OWNER, code?.code ?? "");
  if (!verified.ok) throw new Error("login failed");
  owner = verified.personId;
  const org = await createOrg(db, owner, `Lineup Org ${RUN}`);
  orgId = org.id;
  const base = {
    sport: "cricket",
    location: "Mumbai",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  };
  comp = await createCompetition(db, orgId, owner, { ...base, name: `Lineup League ${RUN}` });
  other = await createCompetition(db, orgId, owner, { ...base, name: `Other League ${RUN}` });
  for (const [name, set] of [
    ["Alpha", (id: string) => (teamA = id)],
    ["Bravo", (id: string) => (teamB = id)],
  ] as const) {
    const made = await createTeam(db, orgId, comp.id, owner, name);
    if (!made.ok) throw new Error("team");
    set(made.team.id);
  }
  const c = await createTeam(db, orgId, other.id, owner, "Charlie");
  if (!c.ok) throw new Error("team");
  teamC = c.team.id;
  players.push(await seedPlayer(comp.id, teamA, 1)); // A
  players.push(await seedPlayer(comp.id, teamA, 2)); // A
  players.push(await seedPlayer(comp.id, teamB, 3)); // B
  players.push(await seedPlayer(other.id, teamC, 4)); // another season
  const made = await createFixture(db, comp, owner, {
    homeTeamId: teamA,
    awayTeamId: teamB,
    kickoffAt: "2026-08-10T09:00",
  });
  if (!made.ok) throw new Error("fixture");
  fixtureId = made.fixtureId;
  await db
    .update(fixturesTable)
    .set({ status: "completed" })
    .where(eq(fixturesTable.id, fixtureId));
});

afterAll(async () => {
  if (orgId !== "") await purgeOrg(db, orgId);
  const ids = [owner, ...players.map((p) => p.personId)].filter((id) => id !== "");
  await db.delete(sessions).where(inArray(sessions.personId, ids));
  await db.delete(auditLog).where(inArray(auditLog.actor, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await db.delete(otpCodes).where(eq(otpCodes.phone, PHONE_OWNER));
  await db.delete(otpInbox).where(eq(otpInbox.phone, PHONE_OWNER));
  await handle.sql.end();
});

const base = () => ({ competitionId: comp.id, orgId, fixtureId, actorId: owner });

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture data missing");
  return value;
}

describe("LINEUPS — who played", () => {
  it("records a team's lineup and a career reads played / in the squad / not recorded", async () => {
    const [p1, p2, p3] = players;
    expect(
      await saveLineup(db, {
        ...base(),
        teamId: teamA,
        registrationIds: [must(p1).registrationId],
      }),
    ).toEqual({ ok: true, played: 1 });

    expect((await playerMatches(must(p1).personId))[0]?.played).toBe("played");
    // Alpha's lineup is recorded and P2 is not in it: in the squad, didn't play.
    expect((await playerMatches(must(p2).personId))[0]?.played).toBe("bench");
    // Nobody recorded Bravo: the career must not claim P3 sat out.
    expect((await playerMatches(must(p3).personId))[0]?.played).toBe("unknown");
  });

  it("a save REPLACES the team's set — unticking is recorded too", async () => {
    const [p1, p2] = players;
    await saveLineup(db, { ...base(), teamId: teamA, registrationIds: [must(p2).registrationId] });
    expect((await playerMatches(must(p1).personId))[0]?.played).toBe("bench");
    expect((await playerMatches(must(p2).personId))[0]?.played).toBe("played");
    const sides = await lineupSides(db, comp.id, must((await lineupFixtures(db, comp.id))[0]));
    expect(sides.find((s) => s.teamId === teamA)?.players.filter((p) => p.played).length).toBe(1);
  });

  it("refuses anyone outside this team's approved squad, a team not in the match, and a foreign fixture", async () => {
    const [, , p3, p4] = players;
    // P3 is Bravo's; P4 is another season's — neither is Alpha's to field.
    expect(
      await saveLineup(db, {
        ...base(),
        teamId: teamA,
        registrationIds: [must(p3).registrationId],
      }),
    ).toEqual({ ok: false, reason: "not_in_squad" });
    expect(
      await saveLineup(db, {
        ...base(),
        teamId: teamA,
        registrationIds: [must(p4).registrationId],
      }),
    ).toEqual({ ok: false, reason: "not_in_squad" });
    expect(await saveLineup(db, { ...base(), teamId: teamC, registrationIds: [] })).toEqual({
      ok: false,
      reason: "not_a_side",
    });
    expect(
      await saveLineup(db, {
        ...base(),
        competitionId: other.id,
        teamId: teamA,
        registrationIds: [],
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("a scheduled match is not part of a career", async () => {
    await db
      .update(fixturesTable)
      .set({ status: "scheduled" })
      .where(eq(fixturesTable.id, fixtureId));
    expect(await playerMatches(must(players[1]).personId)).toEqual([]);
    await db
      .update(fixturesTable)
      .set({ status: "completed" })
      .where(eq(fixturesTable.id, fixtureId));
  });
});

describe("PHOTOS on the organizer's desks — consent decides", () => {
  it("lineups and the team roster sign a player's photo only with recorded consent", async () => {
    const p1 = must(players[0]);
    const key = `people/${p1.personId}/photo.jpg`;
    const sideOf = async () =>
      (await lineupSides(db, comp.id, must((await lineupFixtures(db, comp.id))[0])))
        .find((s) => s.teamId === teamA)
        ?.players.find((p) => p.registrationId === p1.registrationId);
    const rosterOf = async () =>
      (await teamsWorkspace(db, comp, { money: false, roster: true })).teams
        .find((team) => team.id === teamA)
        ?.roster?.find((row) => row.registrationId === p1.registrationId);

    // A stored photo without consent never gets a URL.
    await db.update(people).set({ photoUrl: key }).where(eq(people.id, p1.personId));
    expect((await sideOf())?.photoUrl).toBeNull();
    expect((await rosterOf())?.photoUrl).toBeNull();

    await db.update(people).set({ photoConsentAt: new Date() }).where(eq(people.id, p1.personId));
    expect((await sideOf())?.photoUrl).toBe(storage.readUrl(key));
    expect((await rosterOf())?.photoUrl).toBe(storage.readUrl(key));

    await db
      .update(people)
      .set({ photoUrl: null, photoConsentAt: null })
      .where(eq(people.id, p1.personId));
  });
});
