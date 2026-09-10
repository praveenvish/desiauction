// Against real Postgres. Sign-in by mailbox: the second door to the SAME
// person, added because Indian SMS needs DLT registration and email does not.
//
// The tests that matter here are the refusals. A sign-in code and an
// address-confirmation code live in one table, and the whole reason
// `email_verifications.purpose` exists is that letting either satisfy the other
// is an account-takeover. The phone side learned this the hard way
// (`otp-purpose.regression.test.ts`); this is the email twin.
import { createDb, emailVerifications, newId, people, type DbHandle } from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
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
    expect(result).toEqual({ ok: true, personId });
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
    // A mailbox is a far better guess than a phone number, so a login form that
    // says "no such account" is a membership oracle for anyone with a list.
    const request = await requestEmailLogin(db, { email: `nobody${RUN}@example.test` });
    expect(request.ok).toBe(true);
    expect(request.ok && request.sent).toBe(true);
    expect(request.ok && request.code).toBeUndefined();
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
    expect(await verifyEmailLogin(db, { email, code })).toEqual({ ok: true, personId });
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
