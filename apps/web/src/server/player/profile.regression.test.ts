import { auditLog, createDb, newId, people, playerProfiles, type DbHandle } from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { EMPTY_PLAYER_PROFILE, playerProfileFor, upsertPlayerProfile } from "./profile";

/**
 * The person-level profile, against a real database (PI-1).
 *
 * `player_profiles` carries no RLS — like `people` and `sessions`, app-layer
 * self-scoping is the lock. That makes two properties load-bearing enough to
 * pin here rather than trust from reading the module: one person's write is
 * invisible to another person's read (isolation is BY PARAMETER, so the test
 * is the contract that no caller may pass a foreign id), and the audit row
 * names fields, never values — a gender answer must not leak into a ledger
 * other surfaces render.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
const PHONE_A = `+9194${RUN}01`;
const PHONE_B = `+9194${RUN}02`;

const personA = newId();
const personB = newId();

beforeAll(async () => {
  await db.delete(people).where(inArray(people.phone, [PHONE_A, PHONE_B]));
  await db.insert(people).values([
    { id: personA, phone: PHONE_A, name: "Profile Synthetic A" },
    { id: personB, phone: PHONE_B, name: "Profile Synthetic B" },
  ]);
});

afterAll(async () => {
  await db.delete(playerProfiles).where(inArray(playerProfiles.personId, [personA, personB]));
  await db.delete(auditLog).where(inArray(auditLog.scopeId, [personA, personB]));
  await db.delete(people).where(inArray(people.id, [personA, personB]));
  await handle.sql.end({ timeout: 5 });
});

describe("player profile document (PI-1)", () => {
  it("reads the empty shape when no row exists — absence IS the empty state", async () => {
    expect(await playerProfileFor(personA)).toEqual(EMPTY_PLAYER_PROFILE);
  });

  it("creates lazily on first write and round-trips the document", async () => {
    await upsertPlayerProfile(personA, {
      ...EMPTY_PLAYER_PROFILE,
      gender: "female",
      dateOfBirth: "1998-03-11",
      location: "Kolkata",
      defaultRole: "all_rounder",
    });
    const read = await playerProfileFor(personA);
    expect(read.gender).toBe("female");
    expect(read.dateOfBirth).toBe("1998-03-11");
    expect(read.location).toBe("Kolkata");
    expect(read.defaultRole).toBe("all_rounder");
    expect(read.preferredJerseyNumber).toBeNull();
  });

  it("updates in place — one row per person, held by the unique index", async () => {
    await upsertPlayerProfile(personA, {
      ...(await playerProfileFor(personA)),
      location: "Howrah",
    });
    const rows = await db.select().from(playerProfiles).where(eq(playerProfiles.personId, personA));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.location).toBe("Howrah");
    expect(rows[0]?.gender).toBe("female");
  });

  it("audits fields, never values", async () => {
    const rows = await db
      .select({ action: auditLog.action, meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, personA), eq(auditLog.action, "profile.player.updated")))
      .orderBy(auditLog.id); // ULIDs sort by mint time, so this is write order
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      const fields = (row.meta as { fields?: string }).fields ?? "";
      expect(fields).not.toContain("female");
      expect(fields).not.toContain("Kolkata");
      expect(fields).not.toContain("1998");
    }
    const latest = rows[rows.length - 1];
    expect((latest?.meta as { fields?: string }).fields).toBe("location");
  });

  it("writes nothing at all for a no-op save", async () => {
    const before = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.scopeId, personA));
    await upsertPlayerProfile(personA, await playerProfileFor(personA));
    const after = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.scopeId, personA));
    expect(after.length).toBe(before.length);
  });

  it("keeps people apart — B reads empty after A's write, and B's write leaves A alone", async () => {
    expect(await playerProfileFor(personB)).toEqual(EMPTY_PLAYER_PROFILE);
    await upsertPlayerProfile(personB, { ...EMPTY_PLAYER_PROFILE, gender: "unspecified" });
    const a = await playerProfileFor(personA);
    expect(a.gender).toBe("female");
    expect(a.location).toBe("Howrah");
  });

  it("the database refuses an unknown gender even if a validator is bypassed", async () => {
    // Drizzle wraps the postgres error; the constraint name rides the cause.
    const refusal = await db
      .insert(playerProfiles)
      .values({ id: newId(), personId: newId(), gender: "other" as never })
      .then(() => null)
      .catch((error: unknown) => error);
    expect(refusal).not.toBeNull();
    const cause = (refusal as { cause?: { constraint_name?: string } }).cause;
    expect(cause?.constraint_name).toBe("player_profiles_gender_check");
  });
});
