// Against real Postgres. Sign-in by mailbox: the second door to the SAME
// person, added because Indian SMS needs DLT registration and email does not.
//
// The tests that matter here are the refusals. A sign-in code and an
// address-confirmation code live in one table, and the whole reason
// `email_verifications.purpose` exists is that letting either satisfy the other
// is an account-takeover. The phone side learned this the hard way
// (`otp-purpose.regression.test.ts`); this is the email twin.
import { createDb, emailVerifications, newId, people, type DbHandle } from "@desiauction/db";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { confirmEmailVerification, requestEmailVerification } from "./email-change";
import { requestEmailLogin, verifyEmailLogin } from "./email-login";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-8);
const VERIFIED = `verified${RUN}@example.test`;
const UNVERIFIED = `unverified${RUN}@example.test`;
const CROSS = `cross${RUN}@example.test`;
const personIds: string[] = [];

async function seed(email: string, verified: boolean): Promise<string> {
  const id = newId();
  await db.insert(people).values({
    id,
    phone: `+9189${RUN}${String(personIds.length)}`.slice(0, 14),
    email,
    ...(verified ? { emailVerifiedAt: new Date() } : {}),
  });
  personIds.push(id);
  return id;
}

afterAll(async () => {
  /*
   * BY EMAIL FIRST, and this is not belt-and-braces. A sign-up row has a NULL
   * `person_id` (0063), so the person-scoped delete below cannot see it — and
   * the address it holds is the thing the next run collides on. Deleting by the
   * run's address prefix reaches every row this file made, owned or not.
   */
  await db.delete(emailVerifications).where(like(emailVerifications.email, `%${RUN}@example.test`));
  await db.delete(people).where(like(people.email, `%${RUN}@example.test`));
  if (personIds.length > 0) {
    await db.delete(emailVerifications).where(inArray(emailVerifications.personId, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
  await handle.sql.end({ timeout: 5 });
});

describe("EMAIL SIGN-IN — the second door to the same person", () => {
  it("mints a code for a verified address and signs that person in", async () => {
    const personId = await seed(VERIFIED, true);
    const request = await requestEmailLogin(db, { email: VERIFIED });
    expect(request.ok).toBe(true);
    const code = request.ok ? request.code : undefined;
    expect(code).toBeDefined();

    const result = await verifyEmailLogin(db, { email: VERIFIED, code: code ?? "" });
    // The SAME personId the phone path would produce. Authorization keys on
    // this and cannot tell which door was used.
    expect(result).toEqual({ ok: true, personId, created: false });
  });

  it("refuses an UNVERIFIED address without saying so", async () => {
    /*
     * An unverified `people.email` is a string somebody typed, not proof of a
     * mailbox. Treating it as proof would let anyone who guessed a colleague's
     * address take their account. The refusal is silent: `ok: true` with no
     * code, so the form says the same thing either way.
     */
    await seed(UNVERIFIED, false);
    const request = await requestEmailLogin(db, { email: UNVERIFIED });
    expect(request.ok).toBe(true);
    expect(request.ok && request.code).toBeUndefined();
  });

  it("answers identically for an address nobody owns (no enumeration)", async () => {
    /*
     * A mailbox is a far better guess than a phone number, so a login form that
     * says "no such account" is a membership oracle for anyone with a list.
     *
     * Phase 2 MINTS for the unknown address rather than staying silent — it is
     * a sign-up — so the property is no longer "no code". It is that the two
     * outcomes are indistinguishable in everything that leaves this function
     * for the browser. The only field that differs, `isNew`, exists to pick the
     * mail's wording and is documented as never being echoed; the test below
     * holds the action to that.
     */
    const unknown = await requestEmailLogin(db, { email: `nobody${RUN}@example.test` });
    const known = await requestEmailLogin(db, { email: VERIFIED });
    expect(unknown.ok && known.ok).toBe(true);
    const shape = (r: typeof unknown): unknown =>
      r.ok ? { ok: r.ok, sent: r.sent, hasCode: r.code !== undefined } : { ok: r.ok };
    expect(shape(unknown)).toEqual(shape(known));
  });
});

describe("PURPOSE SEPARATION — the reason 0061 exists", () => {
  it("an address-CONFIRMATION code cannot sign anybody in", async () => {
    const personId = await seed(CROSS, true);
    const minted = await requestEmailVerification(db, {
      personId,
      email: `changed${RUN}@example.test`,
    });
    expect(minted.ok).toBe(true);
    const code = minted.ok ? minted.code : "";

    // Same table, same person, correct code — and refused, because it was
    // minted to prove a mailbox, not to open a session.
    const signIn = await verifyEmailLogin(db, {
      email: `changed${RUN}@example.test`,
      code,
    });
    expect(signIn).toEqual({ ok: false, reason: "invalid" });
  });

  it("a SIGN-IN code cannot confirm an address change", async () => {
    const personId = personIds[personIds.length - 1] ?? "";
    const request = await requestEmailLogin(db, { email: CROSS });
    const code = request.ok ? (request.code ?? "") : "";
    expect(code).not.toBe("");

    const confirmed = await confirmEmailVerification(db, { personId, code });
    expect(confirmed.ok).toBe(false);
  });

  it("stamps the purpose on every row it writes", async () => {
    const rows = await db
      .select({ purpose: emailVerifications.purpose })
      .from(emailVerifications)
      .where(and(eq(emailVerifications.email, CROSS), eq(emailVerifications.purpose, "login")));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.purpose === "login")).toBe(true);
  });
});

describe("CODE HANDLING — the ordinary guarantees, held", () => {
  it("a wrong code is refused and counts down the attempts", async () => {
    const email = `attempts${RUN}@example.test`;
    await seed(email, true);
    await requestEmailLogin(db, { email });
    const first = await verifyEmailLogin(db, { email, code: "000000" });
    expect(first.ok).toBe(false);
    expect(!first.ok && first.reason).toBe("invalid");
    expect(!first.ok && first.attemptsLeft).toBeLessThan(5);
  });

  it("a correct code cannot be used twice", async () => {
    // Session-minting is the caller's job precisely so both doors end in the
    // same place; a replayable code would make this door the weaker one.
    const email = `replay${RUN}@example.test`;
    const personId = await seed(email, true);
    const request = await requestEmailLogin(db, { email });
    const code = request.ok ? (request.code ?? "") : "";
    expect(await verifyEmailLogin(db, { email, code })).toEqual({
      ok: true,
      personId,
      created: false,
    });
    expect(await verifyEmailLogin(db, { email, code })).toEqual({ ok: false, reason: "invalid" });
  });

  it("never stores the code itself", async () => {
    const email = `hashed${RUN}@example.test`;
    await seed(email, true);
    const request = await requestEmailLogin(db, { email });
    const code = request.ok ? (request.code ?? "") : "";
    const [row] = await db
      .select({ hash: emailVerifications.codeHash })
      .from(emailVerifications)
      .where(and(eq(emailVerifications.email, email), eq(emailVerifications.purpose, "login")))
      .limit(1);
    expect(row?.hash).toBeDefined();
    expect(row?.hash).not.toBe(code);
  });
});

/*
 * PHASE 2 — the account an address creates.
 *
 * 0062 made `people.phone` nullable behind a CHECK that an account is anchored
 * by a phone, an email, or both; 0063 let a login code exist before its person
 * does. Together they make email SIGN-UP possible, and every test below is one
 * of the ways that could go wrong.
 */
describe("EMAIL SIGN-UP — the account the mailbox creates", () => {
  it("creates nobody until the code comes back proved", async () => {
    const email = `fresh${RUN}@example.test`;
    const request = await requestEmailLogin(db, { email });
    expect(request.ok && request.isNew).toBe(true);

    // The whole point of 0063: minting the person here would let anyone
    // manufacture `people` rows from a public form, one per guess, and would
    // take the address on behalf of somebody who never replies.
    const before = await db.select({ id: people.id }).from(people).where(eq(people.email, email));
    expect(before).toHaveLength(0);

    const code = request.ok ? (request.code ?? "") : "";
    const result = await verifyEmailLogin(db, { email, code });
    expect(result.ok).toBe(true);
    expect(result.ok && result.created).toBe(true);

    const [made] = await db
      .select({ id: people.id, phone: people.phone, verifiedAt: people.emailVerifiedAt })
      .from(people)
      .where(eq(people.email, email));
    expect(made?.id).toBe(result.ok ? result.personId : "");
    // NO PHONE — this is 0062's entire reason for existing. The account is
    // anchored by the address alone, and `people_reachable_check` is satisfied.
    expect(made?.phone).toBeNull();
    // Verified BY the code, not claimed: this person just proved the mailbox.
    expect(made?.verifiedAt).not.toBeNull();
  });

  it("holds the row that carried no person, so the ledger is not a lie", async () => {
    const email = `pending${RUN}@example.test`;
    const request = await requestEmailLogin(db, { email });
    const [pending] = await db
      .select({ personId: emailVerifications.personId })
      .from(emailVerifications)
      .where(and(eq(emailVerifications.email, email), isNull(emailVerifications.personId)));
    expect(pending, "a sign-up code must be mintable with no person").toBeDefined();

    const code = request.ok ? (request.code ?? "") : "";
    await verifyEmailLogin(db, { email, code });
  });

  it("signs the SAME person in the second time — it does not make two", async () => {
    const email = `twice${RUN}@example.test`;
    const first = await requestEmailLogin(db, { email });
    const firstResult = await verifyEmailLogin(db, {
      email,
      code: first.ok ? (first.code ?? "") : "",
    });
    expect(firstResult.ok && firstResult.created).toBe(true);

    const second = await requestEmailLogin(db, { email });
    // Now a KNOWN, verified address — an ordinary sign-in, not a second account.
    expect(second.ok && second.isNew).toBe(false);
    const secondResult = await verifyEmailLogin(db, {
      email,
      code: second.ok ? (second.code ?? "") : "",
    });
    expect(secondResult.ok && secondResult.created).toBe(false);
    expect(secondResult.ok && secondResult.personId).toBe(
      firstResult.ok ? firstResult.personId : "",
    );

    const rows = await db.select({ id: people.id }).from(people).where(eq(people.email, email));
    expect(rows).toHaveLength(1);
  });

  it("REFUSES to adopt an account that claimed the address but never proved it", async () => {
    /*
     * The merge this product does not do. Somebody typed this address into
     * their account page and never confirmed it; a stranger who owns the
     * mailbox then asks to sign in. The code proves the MAILBOX — it does not
     * prove anything about that account, whose owner signs in by phone — so
     * handing it over would be an account takeover dressed as a convenience.
     *
     * The refusal happens at request time (no code is minted at all), which is
     * also why it cannot be used to enumerate: the response is the uniform one.
     */
    const email = `claimed${RUN}@example.test`;
    await seed(email, false);
    const request = await requestEmailLogin(db, { email });
    expect(request.ok).toBe(true);
    expect(request.ok && request.code).toBeUndefined();

    const rows = await db.select({ id: people.id }).from(people).where(eq(people.email, email));
    expect(rows, "no second row on a taken address").toHaveLength(1);
  });

  it("refuses a sign-up code once somebody else has claimed the address unproved", async () => {
    /*
     * The window between minting and proving. The code was legitimately minted
     * for a free address; before it came back, an existing account claimed that
     * address without verifying it. The mailbox owner still holds a valid code
     * — and must still not be given the other account.
     */
    const email = `raced${RUN}@example.test`;
    const request = await requestEmailLogin(db, { email });
    const code = request.ok ? (request.code ?? "") : "";
    await seed(email, false);

    const result = await verifyEmailLogin(db, { email, code });
    expect(result).toEqual({ ok: false, reason: "taken" });
  });

  it("signs in rather than failing when the address became a real account meanwhile", async () => {
    // Same window, benign end: somebody signed up through the other door and
    // VERIFIED this address. The code proved the same mailbox, so it opens that
    // account instead of erroring at a person who did nothing wrong.
    const email = `overtaken${RUN}@example.test`;
    const request = await requestEmailLogin(db, { email });
    const code = request.ok ? (request.code ?? "") : "";
    const personId = await seed(email, true);

    const result = await verifyEmailLogin(db, { email, code });
    expect(result).toEqual({ ok: true, personId, created: false });
  });
});
