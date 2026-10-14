import {
  competitions,
  createDb,
  newId,
  people,
  registrations,
  teamEntries,
  teamManagers,
  teams,
  withTenantDb,
} from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { createOrg } from "../orgs/orgs";
import { createCompetition } from "./competitions";
import { newTeamEntryCode, TEAM_ENTRY_CODE } from "./team-entry-code";
import { entryCompetitionByCode } from "./team-entry-resolver";
import { reviewTeamEntry, submitTeamEntry } from "./team-entries";

const owner = createDb(env.DATABASE_URL);
const app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const system = env.SYSTEM_DATABASE_URL ? createDb(env.SYSTEM_DATABASE_URL) : owner;
const organizer = newId(),
  captain = newId(),
  stranger = newId();
const playerPhone = `+919${String(Date.now()).slice(-9)}`;
let phonePerson: string | undefined;
let orgId = "",
  foreignOrg = "",
  competitionId = "",
  code = "";
const scope = () => ({ orgId, competitionId });
const within = <T>(personId: string, fn: (db: typeof owner.db) => Promise<T>) =>
  withTenantDb(app, { personId, orgId }, fn);
const input = (name: string) => ({ teamName: name, players: [{ name: `${name} player` }] });

beforeAll(async () => {
  await owner.db.insert(people).values([
    { id: organizer, name: "Entry organizer", email: `${organizer}@entry.test` },
    { id: captain, name: "Entry captain", email: `${captain}@entry.test` },
    { id: stranger, name: "Other captain", email: `${stranger}@entry.test` },
  ]);
  orgId = (await createOrg(owner.db, organizer, `Team entry ${newId()}`)).id;
  foreignOrg = (await createOrg(owner.db, stranger, `Other entry ${newId()}`)).id;
  competitionId = (
    await createCompetition(owner.db, orgId, organizer, {
      name: "Entry season",
      sport: "cricket",
      teamFormation: "team_entry",
    })
  ).id;
  await owner.db
    .update(competitions)
    .set({ status: "registration_open" })
    .where(eq(competitions.id, competitionId));
  const [season] = await owner.db
    .select()
    .from(competitions)
    .where(eq(competitions.id, competitionId));
  code = season?.entryCode ?? "";
});
afterAll(async () => {
  phonePerson = (
    await owner.db.select({ id: people.id }).from(people).where(eq(people.phone, playerPhone))
  )[0]?.id;
  if (orgId !== "") await purgeOrg(owner.db, orgId);
  if (phonePerson !== undefined) await owner.db.delete(people).where(eq(people.id, phonePerson));
  if (foreignOrg !== "") await purgeOrg(owner.db, foreignOrg);
  for (const id of [organizer, captain, stranger])
    await owner.db.delete(people).where(eq(people.id, id));
  if (app !== owner) await app.sql.end({ timeout: 5 });
  if (system !== owner) await system.sql.end({ timeout: 5 });
  await owner.sql.end({ timeout: 5 });
});

describe("team entry boundaries", () => {
  it("creates exact unique six-character codes and returns only minimal discovery", async () => {
    expect(code).toMatch(TEAM_ENTRY_CODE);
    const samples = Array.from({ length: 100 }, newTeamEntryCode);
    expect(samples.every((value) => TEAM_ENTRY_CODE.test(value))).toBe(true);
    expect(new Set(samples).size).toBe(samples.length);
    expect(await entryCompetitionByCode(code, system.db)).toEqual({
      id: competitionId,
      orgId,
      name: "Entry season",
      sport: "cricket",
    });
    for (const invalid of [code.toLowerCase(), "IIIIII", "OOOOOO", "ABC123", `${code}A`]) {
      expect(await entryCompetitionByCode(invalid, system.db)).toBeNull();
    }
    await expect(
      owner.db.insert(competitions).values({
        id: newId(),
        orgId,
        createdBy: organizer,
        name: "Duplicate code",
        slug: newId(),
        sport: "cricket",
        entryCode: code,
      }),
    ).rejects.toThrow();
  });
  it("refuses caller identities, review state, oversized players and rotated/closed links", async () => {
    for (const forged of [
      { ...input("Forged"), orgId: foreignOrg },
      { ...input("Forged"), captainPersonId: stranger },
      { ...input("Forged"), status: "approved" },
      { ...input("Forged"), reviewedBy: organizer },
      { teamName: "Too many", players: Array.from({ length: 31 }, () => ({ name: "Player" })) },
    ]) {
      await expect(
        within(captain, (db) => submitTeamEntry(db, scope(), captain, code, forged)),
      ).rejects.toThrow();
    }
    await owner.db
      .update(competitions)
      .set({ entryCode: newTeamEntryCode() })
      .where(eq(competitions.id, competitionId));
    await expect(
      within(captain, (db) => submitTeamEntry(db, scope(), captain, code, input("Rotated"))),
    ).rejects.toThrow("unavailable");
    await owner.db
      .update(competitions)
      .set({ entryCode: code, teamFormation: "organizer" })
      .where(eq(competitions.id, competitionId));
    expect(await entryCompetitionByCode(code, system.db)).toBeNull();
    await expect(
      within(captain, (db) => submitTeamEntry(db, scope(), captain, code, input("Closed"))),
    ).rejects.toThrow("unavailable");
    await owner.db
      .update(competitions)
      .set({ teamFormation: "team_entry", status: "registration_closed" })
      .where(eq(competitions.id, competitionId));
    expect(await entryCompetitionByCode(code, system.db)).toBeNull();
    await owner.db
      .update(competitions)
      .set({ status: "registration_open" })
      .where(eq(competitions.id, competitionId));
  });
  it("allows captain own-only reads and denies person-arm writes and reviewer authority", async () => {
    const id = await within(captain, (db) =>
      submitTeamEntry(db, scope(), captain, code, input("Own read")),
    );
    const own = await withTenantDb(app, { personId: captain }, (db) =>
      db.select().from(teamEntries),
    );
    expect(own.map((entry) => entry.id)).toContain(id);
    expect(
      await withTenantDb(app, { personId: stranger }, (db) => db.select().from(teamEntries)),
    ).toEqual([]);
    expect(
      await withTenantDb(app, { personId: captain }, (db) =>
        db
          .update(teamEntries)
          .set({ status: "approved" })
          .where(eq(teamEntries.id, id))
          .returning(),
      ),
    ).toEqual([]);
    expect(
      await withTenantDb(app, { personId: captain }, (db) =>
        db.delete(teamEntries).where(eq(teamEntries.id, id)).returning(),
      ),
    ).toEqual([]);
    await expect(
      within(captain, (db) => reviewTeamEntry(db, scope(), captain, id, "approve")),
    ).rejects.toThrow();
    await expect(
      withTenantDb(app, { personId: stranger, orgId: foreignOrg }, (db) =>
        reviewTeamEntry(db, scope(), stranger, id, "approve"),
      ),
    ).rejects.toThrow();
  });
  it("approves atomically and idempotently with approved registrations and a captain manager", async () => {
    const id = await within(captain, (db) =>
      submitTeamEntry(db, scope(), captain, code, {
        teamName: "Approved eleven",
        players: [
          { name: "Club only entry player" },
          { name: "Phone entry player", phone: playerPhone },
        ],
      }),
    );
    await Promise.all(
      [1, 2].map(() =>
        within(organizer, (db) => reviewTeamEntry(db, scope(), organizer, id, "approve")),
      ),
    );
    const rows = await owner.db
      .select()
      .from(teams)
      .where(and(eq(teams.competitionId, competitionId), eq(teams.name, "Approved eleven")));
    expect(rows).toHaveLength(1);
    const teamId = rows[0]?.id ?? "";
    const players = await owner.db
      .select()
      .from(registrations)
      .where(eq(registrations.teamId, teamId));
    expect(players).toHaveLength(2);
    expect(players.every((row) => row.status === "approved")).toBe(true);
    expect(
      await owner.db.select().from(teamManagers).where(eq(teamManagers.teamId, teamId)),
    ).toMatchObject([{ personId: captain, role: "captain", source: "team_entry" }]);
    expect(
      (await owner.db.select().from(teamEntries).where(eq(teamEntries.id, id)))[0]?.status,
    ).toBe("approved");
  });
  it("rolls back a failed approval and requires a rejection reason", async () => {
    const id = await within(captain, (db) =>
      submitTeamEntry(db, scope(), captain, code, {
        teamName: "Rollback eleven",
        players: [{ name: "Repeated name" }, { name: "Repeated name" }],
      }),
    );
    await expect(
      within(organizer, (db) => reviewTeamEntry(db, scope(), organizer, id, "approve")),
    ).rejects.toThrow();
    expect(await owner.db.select().from(teams).where(eq(teams.name, "Rollback eleven"))).toEqual(
      [],
    );
    expect(
      (await owner.db.select().from(teamEntries).where(eq(teamEntries.id, id)))[0]?.status,
    ).toBe("submitted");
    await expect(
      within(organizer, (db) => reviewTeamEntry(db, scope(), organizer, id, "reject")),
    ).rejects.toThrow("reason");
    await within(organizer, (db) =>
      reviewTeamEntry(db, scope(), organizer, id, "reject", "Duplicate players"),
    );
    expect(
      (await owner.db.select().from(teamEntries).where(eq(teamEntries.id, id)))[0]?.status,
    ).toBe("rejected");
  });
});
