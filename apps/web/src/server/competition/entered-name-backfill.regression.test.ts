// MIGRATION 0078 — freezing the name on club-added entries that pre-date 0075,
// against real Postgres. The migration file itself is executed, so the test
// proves the SQL that ships, not a copy of it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createDb, newId, people, registrations, type DbHandle } from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { createCompetition } from "./competitions";
import { addPlayerByPhone } from "./registrations";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);
const MIGRATION = readFileSync(
  join(__dirname, "../../../../../packages/db/migrations/0078_backfill_entered_name.sql"),
  "utf8",
);

let organizer = "";
let existing = "";
let orgId = "";
let competitionId = "";
const created: string[] = [];

beforeAll(async () => {
  organizer = newId();
  existing = newId();
  await db.insert(people).values([
    { id: organizer, phone: `+9193${RUN}1`, name: "Club Organizer" },
    // An account that existed long before the club added its number.
    {
      id: existing,
      phone: `+9193${RUN}2`,
      name: "Real Account Name",
      createdAt: new Date(Date.now() - 2 * 86_400_000),
    },
  ]);
  const org = await createOrg(db, organizer, `Backfill Club ${RUN}`);
  orgId = org.id;
  const season = await createCompetition(db, orgId, organizer, {
    name: `Backfill Cup ${RUN}`,
    sport: "cricket",
    location: "Pune",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
  });
  competitionId = season.id;
});

afterAll(async () => {
  if (orgId !== "") await purgeOrg(db, orgId);
  await db.delete(people).where(inArray(people.id, [organizer, existing, ...created]));
  await handle.sql.end();
});

describe("0078 — legacy club-added entries stop following the account", () => {
  it("freezes the seen name on an entry added to an OLDER account, and only there", async () => {
    const onExisting = await addPlayerByPhone(db, competitionId, orgId, organizer, {
      name: "What The Club Typed",
      phone: `+9193${RUN}2`,
      role: "batter",
      basePriceBand: null,
    });
    const onNew = await addPlayerByPhone(db, competitionId, orgId, organizer, {
      name: "Brand New Player",
      phone: `+9193${RUN}3`,
      role: "batter",
      basePriceBand: null,
    });
    if (!onExisting.ok || !onNew.ok) throw new Error("setup failed");
    created.push(onNew.personId);
    // Before 0075 nothing was kept: simulate a legacy row, added a while after
    // the account was made.
    await db
      .update(registrations)
      .set({ enteredName: null, createdAt: new Date(Date.now() - 86_400_000) })
      .where(eq(registrations.id, onExisting.registrationId));

    await handle.sql.unsafe(MIGRATION);

    const rows = await db
      .select({ id: registrations.id, enteredName: registrations.enteredName })
      .from(registrations)
      .where(inArray(registrations.id, [onExisting.registrationId, onNew.registrationId]));
    const byId = new Map(rows.map((row) => [row.id, row.enteredName]));
    // The typed name is gone for good; what the club already saw is frozen.
    expect(byId.get(onExisting.registrationId)).toBe("Real Account Name");
    // An account the add itself created: its name IS what was typed.
    expect(byId.get(onNew.registrationId)).toBeNull();

    // Re-running changes nothing.
    await handle.sql.unsafe(MIGRATION);
    const [again] = await db
      .select({ enteredName: registrations.enteredName })
      .from(registrations)
      .where(eq(registrations.id, onExisting.registrationId));
    expect(again?.enteredName).toBe("Real Account Name");
  });
});
