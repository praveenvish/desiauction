import { competitions, createDb, newId, people, teamEntries, withTenantDb } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { dbHandle } from "../server/db";
import { createOrg } from "../server/orgs/orgs";
import { createCompetition } from "../server/competition/competitions";
import { entryCompetitionByCode } from "../server/competition/team-entry-resolver";
import { submitTeamEntry } from "../server/competition/team-entries";
import { purgeOrg } from "../server/test-support/purge-org";

const owner = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const organizer = newId(),
  captain = newId(),
  other = newId();
let orgId = "",
  competitionId = "",
  code = "",
  entryId = "";

beforeAll(async () => {
  await owner.db.insert(people).values(
    [organizer, captain, other].map((id) => ({
      id,
      name: "Entry posture",
      email: `${id}@posture.test`,
    })),
  );
  orgId = (await createOrg(owner.db, organizer, `Entry posture ${newId()}`)).id;
  competitionId = (
    await createCompetition(owner.db, orgId, organizer, {
      name: "Posture season",
      sport: "cricket",
      teamFormation: "team_entry",
    })
  ).id;
  await owner.db
    .update(competitions)
    .set({ status: "registration_open" })
    .where(eq(competitions.id, competitionId));
  code =
    (await owner.db.select().from(competitions).where(eq(competitions.id, competitionId)))[0]
      ?.entryCode ?? "";
  entryId = await withTenantDb(dbHandle, { personId: captain, orgId }, (db) =>
    submitTeamEntry(db, { orgId, competitionId }, captain, code, {
      teamName: "Posture team",
      players: [{ name: "Private roster name", phone: "9876543212" }],
    }),
  );
});
afterAll(async () => {
  if (orgId !== "") await purgeOrg(owner.db, orgId);
  for (const id of [organizer, captain, other])
    await owner.db.delete(people).where(eq(people.id, id));
  await owner.sql.end({ timeout: 5 });
});

it("the named system reader returns no entry, roster, contacts or grant facts", async () => {
  expect(await entryCompetitionByCode(code)).toEqual({
    id: competitionId,
    orgId,
    name: "Posture season",
    sport: "cricket",
  });
  expect(await entryCompetitionByCode("IIIIII")).toBeNull();
  await owner.db
    .update(competitions)
    .set({ status: "registration_closed" })
    .where(eq(competitions.id, competitionId));
  expect(await entryCompetitionByCode(code)).toBeNull();
});
it("captain-only scope reads its own row but cannot insert, update or delete", async () => {
  expect(
    (
      await withTenantDb(dbHandle, { personId: captain }, (db) => db.select().from(teamEntries))
    ).map((row) => row.id),
  ).toContain(entryId);
  expect(
    await withTenantDb(dbHandle, { personId: other }, (db) => db.select().from(teamEntries)),
  ).toEqual([]);
  expect(
    await withTenantDb(dbHandle, { personId: captain }, (db) =>
      db
        .update(teamEntries)
        .set({ status: "approved" })
        .where(eq(teamEntries.id, entryId))
        .returning(),
    ),
  ).toEqual([]);
  expect(
    await withTenantDb(dbHandle, { personId: captain }, (db) =>
      db.delete(teamEntries).where(eq(teamEntries.id, entryId)).returning(),
    ),
  ).toEqual([]);
  await expect(
    withTenantDb(dbHandle, { personId: captain }, (db) =>
      db.insert(teamEntries).values({
        id: newId(),
        orgId,
        competitionId,
        captainPersonId: captain,
        teamName: "Forged tenant",
        players: [],
      }),
    ),
  ).rejects.toThrow();
});
