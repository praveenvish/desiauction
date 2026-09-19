// "MEET YOUR SQUAD", against real Postgres: nothing goes while the auction is
// still to run; once it is over every squad member — the captain included —
// gets the whole squad, the coach and the first match; a second press sends
// nothing; a player moved to another team gets the new team's sheet.
import { DEFAULT_AUCTION_CONFIG, registrationNumber } from "@desiauction/core";
import {
  auctions,
  auditLog,
  createDb,
  fixtures,
  messageOutbox,
  newId,
  people,
  registrations,
  teams,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { createCompetition, createTeam } from "./competitions";
import { sendSquadSheets, squadSheetsView } from "./squad-sheets";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

let organizer = "";
let orgId = "";
let competitionId = "";
let auctionId = "";
let kings = "";
let tigers = "";
const person: Record<string, string> = {};
const registration: Record<string, string> = {};

async function member(name: string, suffix: string, teamId: string, isCaptain = false) {
  const personId = newId();
  await db.insert(people).values({ id: personId, phone: `+9195${RUN}${suffix}`, name });
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

async function sheetFor(name: string) {
  const [row] = await db
    .select({ subject: messageOutbox.subject, text: messageOutbox.bodyText })
    .from(messageOutbox)
    .where(
      and(
        eq(messageOutbox.personId, person[name] ?? ""),
        eq(messageOutbox.kind, "team.squad_sheet"),
      ),
    )
    .orderBy(messageOutbox.createdAt);
  return row;
}

beforeAll(async () => {
  organizer = newId();
  await db.insert(people).values({ id: organizer, phone: `+9195${RUN}00`, name: "Organizer" });
  orgId = (await createOrg(db, organizer, `Sheet Club ${RUN}`)).id;
  competitionId = (
    await createCompetition(db, orgId, organizer, {
      name: `Sheet Cup ${RUN}`,
      sport: "cricket",
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
  await db.update(teams).set({ coachName: "Ravi Coach" }).where(eq(teams.id, kings));
  await member("Vikram Captain", "01", kings, true);
  await member("Arjun Bought", "02", kings);
  await member("Rohit Tiger", "03", tigers);
  await db.insert(fixtures).values({
    id: newId(),
    orgId,
    competitionId,
    fixtureNumber: `SC-F${RUN}`,
    seq: 1,
    homeTeamId: tigers,
    awayTeamId: kings,
    kickoffAt: "2099-10-04T19:30",
    status: "published",
    createdBy: organizer,
  });
  auctionId = newId();
  await db.insert(auctions).values({
    id: auctionId,
    orgId,
    competitionId,
    name: "Sheet Auction",
    status: "scheduled",
    config: DEFAULT_AUCTION_CONFIG,
    createdBy: organizer,
  });
});

afterAll(async () => {
  const everyone = Object.values(person);
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, everyone));
  await db
    .delete(auditLog)
    .where(and(inArray(auditLog.scopeId, everyone), eq(auditLog.action, "team.squad_sheet")));
  if (orgId !== "") await purgeOrg(db, orgId);
  await db.delete(people).where(inArray(people.id, [organizer, ...everyone]));
  await handle.sql.end();
});

describe("SQUAD SHEETS — not while the auction is still to run", () => {
  it("says why, and refuses to send", async () => {
    const view = await squadSheetsView(db, competitionId);
    expect(view.blocked).toContain("once it is over");
    expect(await sendSquadSheets(db, { competitionId, actorId: organizer })).toMatchObject({
      ok: false,
    });
    expect(await sheetFor("Vikram Captain")).toBeUndefined();
  });
});

describe("SQUAD SHEETS — once the auction is over", () => {
  it("counts everyone on a team as waiting for their sheet", async () => {
    await db.update(auctions).set({ status: "completed" }).where(eq(auctions.id, auctionId));
    expect(await squadSheetsView(db, competitionId)).toEqual({
      blocked: null,
      pending: 3,
      sent: 0,
      teams: 2,
    });
  });

  it("sends every squad member — the captain too — the whole squad, the coach, the first match", async () => {
    expect(await sendSquadSheets(db, { competitionId, actorId: organizer })).toEqual({
      ok: true,
      sent: 3,
    });
    const captain = await sheetFor("Vikram Captain");
    expect(captain?.subject).toBe("Meet your Cup Kings squad");
    expect(captain?.text).toContain("Vikram Captain (you)");
    expect(captain?.text).toContain("Arjun Bought");
    expect(captain?.text).not.toContain("Rohit Tiger");
    expect(captain?.text).toContain("Ravi Coach");
    expect(captain?.text).toContain("Your first match: vs Cup Tigers");
    const tiger = await sheetFor("Rohit Tiger");
    expect(tiger?.text).toContain("vs Cup Kings");
    expect(tiger?.text).not.toContain("Coach");
    const inbox = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeId, person["Arjun Bought"] ?? ""),
          eq(auditLog.action, "team.squad_sheet"),
        ),
      );
    expect(inbox).toHaveLength(1);
  });

  it("a second press sends nothing", async () => {
    expect(await sendSquadSheets(db, { competitionId, actorId: organizer })).toEqual({
      ok: true,
      sent: 0,
    });
    expect((await squadSheetsView(db, competitionId)).pending).toBe(0);
  });

  it("a player moved to another team gets the new team's sheet, and only them", async () => {
    await db
      .update(registrations)
      .set({ teamId: kings })
      .where(eq(registrations.id, registration["Rohit Tiger"] ?? ""));
    expect((await squadSheetsView(db, competitionId)).pending).toBe(1);
    expect(await sendSquadSheets(db, { competitionId, actorId: organizer })).toEqual({
      ok: true,
      sent: 1,
    });
    const sheets = await db
      .select({ subject: messageOutbox.subject })
      .from(messageOutbox)
      .where(
        and(
          eq(messageOutbox.personId, person["Rohit Tiger"] ?? ""),
          eq(messageOutbox.kind, "team.squad_sheet"),
        ),
      );
    expect(sheets.map((sheet) => sheet.subject).sort()).toEqual([
      "Meet your Cup Kings squad",
      "Meet your Cup Tigers squad",
    ]);
  });
});
