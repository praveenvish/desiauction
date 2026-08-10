import { createDb, emailVerifications, newId, people, type DbHandle } from "@desiauction/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import {
  confirmEmailVerification,
  normalizeEmail,
  requestEmailVerification,
  verifiedEmailOf,
} from "./email-change";

/**
 * An address the platform may actually send to.
 *
 * The email delivery adapter has refused every document with `no_email_on_file`
 * since it was written, correctly — this product has never collected an
 * address. What is asserted here is the property that makes the column safe to
 * act on: `verifiedEmailOf` returns an address only after a code sent to that
 * mailbox came back. An address that is merely typed must stay invisible to the
 * sender, because a mistyped domain would put a club's receipt — a name, an
 * amount, a competition — into a stranger's inbox.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
const MINE = `player-${RUN}@example.com`;
const OTHERS = `rival-${RUN}@example.com`;

let personId = "";
let otherId = "";

async function pendingCodeFor(person: string): Promise<string> {
  const [row] = await db
    .select({ id: emailVerifications.id })
    .from(emailVerifications)
    .where(and(eq(emailVerifications.personId, person), isNull(emailVerifications.consumedAt)))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);
  if (row === undefined) {
    throw new Error("no pending verification");
  }
  return row.id;
}

beforeAll(async () => {
  personId = newId();
  otherId = newId();
  await db.insert(people).values([
    { id: personId, phone: `+9196${RUN}1`, name: "Email Person" },
    { id: otherId, phone: `+9196${RUN}2`, name: "Other Person" },
  ]);
});

afterAll(async () => {
  await db
    .delete(emailVerifications)
    .where(inArray(emailVerifications.personId, [personId, otherId]));
  await db.delete(people).where(inArray(people.id, [personId, otherId]));
  await handle.sql.end({ timeout: 5 });
});

describe("normalizeEmail", () => {
  it("case-folds, because a mailbox is not case-sensitive in practice", () => {
    // Two accounts each believing they hold `A@x.com` and `a@x.com` is the
    // failure the unique index on lower(email) also exists to stop.
    expect(normalizeEmail("  Player@Example.COM ")).toBe("player@example.com");
  });

  it("rejects what cannot be an address, and accepts what merely looks unusual", () => {
    for (const bad of ["", "nope", "a@b", "two@at@x.com", "has space@x.com", "@x.com", "a@"]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
    // Deliberately permissive: plus-addressing and long TLDs are real mail, and
    // a regex that rejects them rejects paying customers. The code decides.
    for (const good of ["a+tag@x.co.in", "x@sub.domain.technology"]) {
      expect(normalizeEmail(good), good).toBe(good);
    }
  });
});

describe("verification", () => {
  it("does NOT expose an unverified address to the sender", async () => {
    const requested = await requestEmailVerification(db, { personId, email: MINE });
    expect(requested.ok).toBe(true);
    // The whole point of the column split. The request has been made and a code
    // is outstanding; until it comes back there is nothing to send to.
    expect(await verifiedEmailOf(db, personId), "an address in flight is not a channel").toBeNull();
  });

  it("refuses a wrong code and leaves the account with no address", async () => {
    const result = await confirmEmailVerification(db, { personId, code: "000000" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.attemptsLeft).toBe(4);
    }
    expect(await verifiedEmailOf(db, personId)).toBeNull();
  });

  it("verifies with the right code, and only then is the address sendable", async () => {
    await db.delete(emailVerifications).where(eq(emailVerifications.personId, personId));
    const requested = await requestEmailVerification(db, { personId, email: MINE });
    if (!requested.ok) {
      throw new Error(requested.reason);
    }
    const result = await confirmEmailVerification(db, { personId, code: requested.code });
    expect(result).toEqual({ ok: true, email: MINE });
    expect(await verifiedEmailOf(db, personId)).toBe(MINE);
  });

  it("refuses an address already confirmed on another account", async () => {
    // Merging two accounts is not something this product can do safely — they
    // may hold opposing sides of a settlement — so refusing is the only honest
    // answer, exactly as on the phone-change path.
    const requested = await requestEmailVerification(db, { personId: otherId, email: MINE });
    if (!requested.ok) {
      throw new Error(requested.reason);
    }
    const result = await confirmEmailVerification(db, { personId: otherId, code: requested.code });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("taken");
    }
    expect(await verifiedEmailOf(db, otherId)).toBeNull();
  });

  it("burns the code BEFORE answering the collision", async () => {
    // Same no-oracle property the phone change holds: if the collision were
    // checked first, anyone with an account could type addresses and learn
    // which are registered, for free. The refusal above must have spent a code.
    await expect(pendingCodeFor(otherId)).rejects.toThrow("no pending verification");
  });

  it("sends for an address held by somebody ELSE rather than refusing up front", async () => {
    const requested = await requestEmailVerification(db, { personId: otherId, email: MINE });
    expect(requested.ok, "the request step must not be an ownership oracle").toBe(true);
  });

  it("does not re-verify the address already confirmed on this account", async () => {
    const result = await requestEmailVerification(db, { personId, email: MINE.toUpperCase() });
    expect(result).toEqual({ ok: false, reason: "same-email" });
  });

  it("moves to a new address, and the old one stops being the account's", async () => {
    const requested = await requestEmailVerification(db, { personId, email: OTHERS });
    if (!requested.ok) {
      throw new Error(requested.reason);
    }
    expect((await confirmEmailVerification(db, { personId, code: requested.code })).ok).toBe(true);
    expect(await verifiedEmailOf(db, personId)).toBe(OTHERS);
  });
});
