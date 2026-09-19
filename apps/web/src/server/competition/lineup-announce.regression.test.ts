// "YOU'RE IN THE LINEUP", against real Postgres: a match still to come is
// announced to the SAVED lineup once; a second press tells nobody; a player
// added later is told alone and one taken out hears nothing; a match already
// played cannot be announced at all.
import { registrationNumber } from "@desiauction/core";
import {
  auditLog,
  createDb,
  fixtures,
  messageOutbox,
  newId,
  people,
  registrations,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { createCompetition, createTeam } from "./competitions";
import { announceLineup, lineupAnnounceStates, smsWhen } from "./lineup-announce";
import { saveLineup } from "./lineups";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

let organizer = "";
let orgId = "";
let competitionId = "";
let kings = "";
let tigers = "";
let upcoming = "";
let played = "";
const person: Record<string, string> = {};
const registration: Record<string, string> = {};

async function member(name: string, suffix: string, teamId: string, isCaptain = false) {
  const personId = newId();
  await db.insert(people).values({ id: personId, phone: `+9196${RUN}${suffix}`, name });
  const id = newId();
  await db.insert(registrations).values({
    id,
    orgId,
    competitionId,
    personId,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(id),
    teamId,
    isCaptain,
  });
  person[name] = personId;
  registration[name] = id;
}

async function fixture(kickoffAt: string, seq: number, status: "published" | "completed") {
  const id = newId();
  await db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    fixtureNumber: `LA-${RUN}-${String(seq)}`,
    seq,
    homeTeamId: kings,
    awayTeamId: tigers,
    kickoffAt,
    status,
    createdBy: organizer,
  });
  return id;
}

async function lineupOf(...names: string[]) {
  return saveLineup(db, {
    competitionId,
    orgId,
    fixtureId: upcoming,
    teamId: kings,
    registrationIds: names.map((name) => registration[name] ?? ""),
    actorId: organizer,
  });
}

async function mailsFor(name: string) {
  return db
    .select({
      subject: messageOutbox.subject,
      text: messageOutbox.bodyText,
      channel: messageOutbox.channel,
    })
    .from(messageOutbox)
    .where(
      and(
        eq(messageOutbox.personId, person[name] ?? ""),
        eq(messageOutbox.kind, "lineup.announced"),
      ),
    );
}

beforeAll(async () => {
  organizer = newId();
  await db.insert(people).values({ id: organizer, phone: `+9196${RUN}00`, name: "Organizer" });
  orgId = (await createOrg(db, organizer, `Lineup Club ${RUN}`)).id;
  competitionId = (
    await createCompetition(db, orgId, organizer, {
      name: `Lineup Cup ${RUN}`,
      sport: "kabaddi",
      location: "Pune",
      startsOn: "2099-10-01",
      endsOn: "2099-10-30",
    })
  ).id;
  const k = await createTeam(db, orgId, competitionId, organizer, "Cup Kings");
  const t = await createTeam(db, orgId, competitionId, organizer, "Cup Tigers");
  if (!k.ok || !t.ok) throw new Error("teams not created");
  kings = k.team.id;
  tigers = t.team.id;
  await member("Vikram Captain", "01", kings, true);
  await member("Arjun Raider", "02", kings);
  await member("Rohit Bench", "03", kings);
  upcoming = await fixture("2099-10-04T19:30", 1, "published");
  played = await fixture("2020-10-04T19:30", 2, "completed");
});

afterAll(async () => {
  const everyone = Object.values(person);
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, everyone));
  await db
    .delete(auditLog)
    .where(
      and(inArray(auditLog.scopeId, everyone), eq(auditLog.action, "fixture.lineup_announced")),
    );
  if (orgId !== "") await purgeOrg(db, orgId);
  await db.delete(people).where(inArray(people.id, [organizer, ...everyone]));
  await handle.sql.end();
});

describe("ANNOUNCE THE LINEUP — before the match, once", () => {
  it("counts the saved lineup as waiting to be told", async () => {
    await lineupOf("Vikram Captain", "Arjun Raider");
    const states = await lineupAnnounceStates(
      { id: upcoming, kickoffAt: "2099-10-04T19:30", status: "published" },
      [
        {
          teamId: kings,
          players: [
            { registrationId: registration["Vikram Captain"] ?? "", played: true },
            { registrationId: registration["Arjun Raider"] ?? "", played: true },
            { registrationId: registration["Rohit Bench"] ?? "", played: false },
          ],
        },
      ],
    );
    expect(states[kings]).toEqual({ upcoming: true, pending: 2, told: 0 });
  });

  it("tells the saved lineup — email, text and inbox — and not the player left out", async () => {
    expect(
      await announceLineup(db, {
        competitionId,
        fixtureId: upcoming,
        teamId: kings,
        actorId: organizer,
      }),
    ).toEqual({ ok: true, told: 2 });
    const arjun = await mailsFor("Arjun Raider");
    const email = arjun.find((row) => row.channel === "email");
    expect(email?.subject).toBe("You're in the Cup Kings lineup vs Cup Tigers");
    expect(email?.text).toContain("Arjun Raider (you)");
    expect(email?.text).toContain("Vikram Captain");
    expect(email?.text).not.toContain("XI");
    const sms = arjun.find((row) => row.channel === "sms");
    expect(sms?.text).toContain(
      `You are in the Cup Kings lineup vs Cup Tigers on ${smsWhen("2099-10-04T19:30")}`,
    );
    expect(await mailsFor("Rohit Bench")).toHaveLength(0);
    const inbox = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeId, person["Vikram Captain"] ?? ""),
          eq(auditLog.action, "fixture.lineup_announced"),
        ),
      );
    expect(inbox).toHaveLength(1);
  });

  it("a second press tells nobody", async () => {
    expect(
      await announceLineup(db, {
        competitionId,
        fixtureId: upcoming,
        teamId: kings,
        actorId: organizer,
      }),
    ).toEqual({ ok: true, told: 0 });
  });

  it("a player added later is told alone; the one taken out hears nothing", async () => {
    await lineupOf("Vikram Captain", "Rohit Bench");
    expect(
      await announceLineup(db, {
        competitionId,
        fixtureId: upcoming,
        teamId: kings,
        actorId: organizer,
      }),
    ).toEqual({ ok: true, told: 1 });
    expect((await mailsFor("Rohit Bench")).length).toBeGreaterThan(0);
    // Arjun was told once, and nothing more reaches him now he is out.
    expect((await mailsFor("Arjun Raider")).filter((row) => row.channel === "email")).toHaveLength(
      1,
    );
  });
});

describe("ANNOUNCE THE LINEUP — never after the match", () => {
  it("refuses a match that has been played", async () => {
    expect(
      await announceLineup(db, {
        competitionId,
        fixtureId: played,
        teamId: kings,
        actorId: organizer,
      }),
    ).toEqual({ ok: false, reason: "not_upcoming" });
  });

  it("formats the kickoff to fit one SMS variable", () => {
    expect(smsWhen("2099-10-04T19:30")).toMatch(/^[A-Z][a-z]{2}, 4 Oct, 7:30 pm$/);
    expect(smsWhen("2026-09-30T12:30").length).toBeLessThanOrEqual(21);
  });
});
