import {
  auditLog,
  competitions,
  consentRecords,
  createDb,
  fixtureResults,
  fixtures,
  grants,
  messageOutbox,
  newId,
  organizations,
  orgMembers,
  people,
  registrations,
  teams,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { createCompetition } from "./competitions";
import { announceChampion, finaleState } from "./season-finale";

/**
 * THE CHAMPION (email programme PR12), against a real database: offered only
 * when every match is done, named by the organizer, told to everyone once.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const organizer = newId();
const winner = newId();
const other = newId();
const kings = newId();
const tigers = newId();
const opener = newId();
const decider = newId();
let org = { id: "", name: "", slug: "" };
let seasonId = "";

const outbox = () =>
  db
    .select({
      personId: messageOutbox.personId,
      subject: messageOutbox.subject,
      body: messageOutbox.bodyText,
    })
    .from(messageOutbox)
    .where(like(messageOutbox.dedupeKey, `season.champion:${seasonId}:%`));

beforeAll(async () => {
  await db.insert(people).values([
    {
      id: organizer,
      phone: `+9185${RUN}1`,
      name: "Priya Organizer",
      email: `finale-${RUN}@example.test`,
      emailVerifiedAt: new Date(),
    },
    { id: winner, phone: `+9185${RUN}2`, name: "Arjun Winner", email: `w-${RUN}@example.test` },
    { id: other, phone: `+9185${RUN}3`, name: "Sana Other", email: `o-${RUN}@example.test` },
  ]);
  org = await createOrg(db, organizer, `Finale Club ${RUN}`);
  const season = await createCompetition(db, org.id, organizer, {
    sport: "cricket",
    name: `Finale League ${RUN}`,
    location: "Malad",
    startsOn: "2031-10-01",
    endsOn: "2031-10-30",
  });
  seasonId = season.id;
  await db.insert(teams).values([
    { id: kings, orgId: org.id, competitionId: seasonId, name: "Cup Kings", createdBy: organizer },
    { id: tigers, orgId: org.id, competitionId: seasonId, name: "Tigers", createdBy: organizer },
  ]);
  await db.insert(registrations).values([
    {
      id: newId(),
      orgId: org.id,
      competitionId: seasonId,
      personId: winner,
      role: "batter",
      status: "approved",
      teamId: kings,
    },
    {
      id: newId(),
      orgId: org.id,
      competitionId: seasonId,
      personId: other,
      role: "batter",
      status: "approved",
      teamId: tigers,
    },
  ]);
  const fixture = (id: string, seq: number, status: "completed" | "published") => ({
    id,
    orgId: org.id,
    competitionId: seasonId,
    fixtureNumber: `F${RUN}-${String(seq)}`,
    seq,
    homeTeamId: kings,
    awayTeamId: tigers,
    kickoffAt: `2031-10-0${String(seq)}T16:00`,
    status,
    createdBy: organizer,
  });
  await db
    .insert(fixtures)
    .values([fixture(opener, 1, "completed"), fixture(decider, 2, "published")]);
  await db.insert(fixtureResults).values({
    fixtureId: opener,
    orgId: org.id,
    competitionId: seasonId,
    outcome: "home_win",
    winnerTeamId: kings,
    recordedBy: organizer,
  });
});

afterAll(async () => {
  const ids = [organizer, winner, other];
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  await db.delete(fixtureResults).where(eq(fixtureResults.orgId, org.id));
  await db.delete(fixtures).where(eq(fixtures.orgId, org.id));
  await db.delete(registrations).where(eq(registrations.orgId, org.id));
  await db.delete(teams).where(eq(teams.orgId, org.id));
  await purgeOrg(db, org.id);
  await db.delete(competitions).where(eq(competitions.orgId, org.id));
  await db.delete(grants).where(eq(grants.scopeId, org.id));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
  await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
  await db.delete(organizations).where(eq(organizations.id, org.id));
  await db.delete(auditLog).where(inArray(auditLog.scopeId, ids));
  await db.delete(auditLog).where(inArray(auditLog.actor, ids));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

describe("naming the champion", () => {
  it("is refused while a match is still to play", async () => {
    expect((await finaleState(db, seasonId)).matchesDone).toBe(false);
    expect(
      await announceChampion(db, { competitionId: seasonId, teamId: kings, actorId: organizer }),
    ).toEqual({ ok: false, reason: "not_done" });
  });

  it("offers the top of the table once every match is played or called off", async () => {
    await db.update(fixtures).set({ status: "cancelled" }).where(eq(fixtures.id, decider));
    const state = await finaleState(db, seasonId);
    expect(state.matchesDone).toBe(true);
    expect(state.table[0]).toMatchObject({ teamName: "Cup Kings", won: 1, played: 1 });
    expect(state.tiedAtTop).toBe(false);
    expect(state.announced).toBeNull();
  });

  it("refuses a team from another season", async () => {
    expect(
      await announceChampion(db, { competitionId: seasonId, teamId: newId(), actorId: organizer }),
    ).toEqual({ ok: false, reason: "not_a_team" });
  });

  it("tells the champions, every other team and the organizer — once", async () => {
    expect(
      await announceChampion(db, { competitionId: seasonId, teamId: kings, actorId: organizer }),
    ).toEqual({ ok: true, told: 3 });
    const rows = await outbox();
    const champion = rows.find((row) => row.personId === winner);
    expect(champion?.subject).toBe(`Champions! Cup Kings win Finale League ${RUN}`);
    expect(champion?.body).toContain("Champions");
    const loser = rows.find((row) => row.personId === other);
    expect(loser?.subject).toBe(`Finale League ${RUN} is a wrap — Cup Kings are champions`);
    expect(loser?.body).toContain("Tigers finished 2nd of 2");
    const theOrganizer = rows.find((row) => row.personId === organizer);
    expect(theOrganizer?.subject).toBe(`Cup Kings are your Finale League ${RUN} champions`);

    const inbox = await db
      .select({ scopeId: auditLog.scopeId })
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "season.champion"), inArray(auditLog.scopeId, [winner, other])),
      );
    expect(inbox).toHaveLength(2);

    expect((await finaleState(db, seasonId)).announced).toMatchObject({
      teamId: kings,
      teamName: "Cup Kings",
    });
    expect(
      await announceChampion(db, { competitionId: seasonId, teamId: tigers, actorId: organizer }),
    ).toEqual({ ok: false, reason: "already" });
    expect(await outbox()).toHaveLength(3);
  });
});
