import { grants, newId, paddleGrants, people } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, sql } from "../db.js";
import { deletePeopleCascading } from "./people-teardown.js";

/**
 * THE NIGHTLY'S 23503, REPRODUCED AND FIXED.
 *
 * `nightly-verify` failed four consecutive nights (2026-09-01..04), always in
 * `live-engine`, always the same way: every assertion passed and then `afterAll`
 * threw `paddle_grants_person_id_people_id_fk`. The suite reported FAILED with
 * nothing wrong with the engine, and leaked a person into the shared database
 * on the way out.
 *
 * The teardowns removed children `where org_id = <the suite's org>` and then
 * removed people `where id in (<the suite's people>)`. Those are two different
 * questions, and the second one is the one the database asks. This test states
 * the gap as a fact rather than a theory: it plants exactly the two shapes that
 * survive an org-scoped sweep, proves the naive delete still refuses, and proves
 * the cascading teardown does not.
 *
 * `paddle_grants` carries only ONE foreign key — `person_id`. Its `org_id`,
 * `auction_id` and `team_id` are plain columns, which is why a grant can point
 * at our person from an org that no sweep of ours will ever visit.
 */

const stamp = String(Date.now()).slice(-7);
const phone = (suffix: string): string => `+9195${stamp.slice(0, 5)}${suffix}`;

async function plantPerson(id: string, suffix: string): Promise<void> {
  await db.insert(people).values({ id, phone: phone(suffix), name: "Teardown Subject" });
}

/**
 * The Postgres SQLSTATE behind a refused delete, or null if it succeeded.
 *
 * drizzle wraps the driver error, so the class we care about ("23503",
 * foreign_key_violation) is on the CAUSE — asserting against the outer message
 * only ever sees "Failed query: delete from ...", which would pass for a
 * syntax error just as happily.
 */
async function refusalCode(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? null;
  }
}

describe("deletePeopleCascading", () => {
  afterAll(async () => {
    await sql.end();
  });

  it("removes a person whose paddle grant belongs to another org — the nightly's failure", async () => {
    const personId = newId();
    const someoneElsesOrg = newId();
    await plantPerson(personId, "01");
    await db.insert(paddleGrants).values({
      id: newId(),
      orgId: someoneElsesOrg,
      auctionId: newId(),
      teamId: newId(),
      personId,
      grantedBy: personId,
    });

    // What every engine teardown used to end with, and what CI hit four nights
    // running. If this ever stops refusing, the FK is gone and so is the bug.
    expect(await refusalCode(db.delete(people).where(eq(people.id, personId)))).toBe("23503");

    await deletePeopleCascading([personId]);
    expect(await db.select().from(people).where(eq(people.id, personId))).toHaveLength(0);
  });

  it("removes a person holding a capability grant — a table no engine teardown deleted at all", async () => {
    const personId = newId();
    await plantPerson(personId, "02");
    await db.insert(grants).values({
      id: newId(),
      personId,
      scopeType: "org",
      scopeId: newId(),
      capabilitySet: "viewer",
      grantedBy: personId,
    });

    expect(await refusalCode(db.delete(people).where(eq(people.id, personId)))).toBe("23503");

    await deletePeopleCascading([personId]);
    expect(await db.select().from(people).where(eq(people.id, personId))).toHaveLength(0);
  });

  it("is a no-op on an empty list rather than deleting the table", async () => {
    const before = await db.select({ id: people.id }).from(people);
    await deletePeopleCascading([]);
    expect(await db.select({ id: people.id }).from(people)).toHaveLength(before.length);
  });
});
