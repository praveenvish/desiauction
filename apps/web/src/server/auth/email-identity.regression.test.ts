/**
 * PERMANENT REGRESSION — an account anchored by an address instead of a number.
 *
 * Migration 0062 dropped `people.phone`'s NOT NULL and put a CHECK in its place:
 * a person is anchored by a phone, an email, or both — never neither. That one
 * change touches three different kinds of promise, and each is asserted here
 * because breaking any of them is silent:
 *
 *   THE DATABASE still refuses a person with no way to be reached at all, and
 *   still refuses two accounts on one credential. "Both unique" is the decision
 *   this phase was built on: a credential already in use is REFUSED, never
 *   merged, because two person rows may hold registrations in one competition,
 *   paddles in one auction, or opposing sides of a settlement, and no automatic
 *   rule can decide which survives.
 *
 *   A PLAYER still needs a phone. Not an authentication rule — an email-only
 *   account signs in perfectly well and can organize, own a team or keep the
 *   books. It is a product rule, because a season reaches its players by SMS
 *   and by nothing else: entering one we cannot text would approve, auction and
 *   sell somebody without ever telling them.
 *
 *   ATTACHING A NUMBER is the way out of that, and it is the SAME flow that
 *   changes one — deliberately, so the collision rule cannot drift into two
 *   versions of itself.
 */
import {
  competitions as competitionsTable,
  createDb,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  people,
  registrations as registrationsTable,
  auditLog,
  grants as grantsTable,
  sessions,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registrationNumber } from "@desiauction/core";

import { env } from "../../env";
import { hashCode, requestOtp, verifyOtp } from "./otp";
import { DevInboxSender } from "./otp-sender";
import { confirmPhoneChange, requestPhoneChange } from "./phone-change";
import {
  advanceCompetition,
  createCompetition,
  resolveCompetition,
} from "../competition/competitions";
import { createOrg } from "../orgs/orgs";
import { submitRegistration } from "../competition/registrations";
import { DevInboxSmsSender, notifyDecision } from "../competition/registration-notify";
import { purgeOrg } from "../test-support/purge-org";
import { userDirectory } from "../admin/views";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
// EXACTLY ten digits after +91, the way phone-change.regression.test.ts spells
// them: an eleven-digit fixture fails every case on the test's own bad data.
const ORGANIZER = `+9198${RUN}1`;
const TO_ATTACH = `+9198${RUN}2`;
const SOMEBODY_ELSES = `+9198${RUN}3`;
const PHONES = [ORGANIZER, TO_ATTACH, SOMEBODY_ELSES];

const EMAIL_ONLY = `emailonly${RUN}@example.test`;
const OTHER_EMAIL = `other${RUN}@example.test`;

let organizerId = "";
let emailOnlyId = "";
let phoneHolderId = "";
let org = { id: "", name: "", slug: "" };
let season = "";
const seeded: string[] = [];

async function latestCode(phone: string): Promise<string> {
  const [row] = await db
    .select({ codeHash: otpCodes.codeHash })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (row === undefined) {
    throw new Error(`no pending code for ${phone}`);
  }
  const [message] = await db
    .select({ code: otpInbox.code })
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const code = message?.code ?? "";
  if (hashCode(code) !== row.codeHash) {
    throw new Error("dev inbox and otp_codes disagree about the code");
  }
  return code;
}

/**
 * WHICH constraint refused this write.
 *
 * Drizzle wraps the driver error, so `.message` is "Failed query: insert into
 * …" and every refusal looks the same to `rejects.toThrow()`. Postgres names
 * the constraint on the cause, and naming it is the difference between "the
 * database said no" and "the database said no FOR THE REASON THIS TEST IS
 * ABOUT".
 */
async function refusedBy(write: Promise<unknown>): Promise<string> {
  try {
    await write;
  } catch (error) {
    const cause: unknown = (error as { cause?: unknown }).cause ?? error;
    const name = (cause as { constraint_name?: string }).constraint_name;
    return name ?? `unnamed: ${String((cause as { message?: string }).message)}`;
  }
  return "not refused";
}

async function login(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const verified = await verifyOtp(db, phone, await latestCode(phone));
  if (!verified.ok) {
    throw new Error("login failed");
  }
  return verified.personId;
}

/** An account anchored by an address alone — what 0062 made possible. */
async function emailAnchored(email: string): Promise<string> {
  const id = newId();
  await db.insert(people).values({ id, phone: null, email, emailVerifiedAt: new Date() });
  seeded.push(id);
  return id;
}

beforeAll(async () => {
  organizerId = await login(ORGANIZER);
  emailOnlyId = await emailAnchored(EMAIL_ONLY);
  phoneHolderId = newId();
  await db
    .insert(people)
    .values({ id: phoneHolderId, phone: SOMEBODY_ELSES, name: "Already Here" });
  seeded.push(phoneHolderId);

  org = await createOrg(db, organizerId, `Email Identity Org ${RUN}`);
  const created = await createCompetition(db, org.id, organizerId, {
    sport: "cricket",
    name: `Email Identity Cup ${RUN}`,
    location: "Malad",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  });
  for (const status of ["setup", "registration_open"] as const) {
    const current = await resolveCompetition(db, organizerId, created.slug);
    if (current === null) {
      throw new Error("competition vanished");
    }
    const advanced = await advanceCompetition(db, current, organizerId, status);
    if (!advanced.ok) {
      throw new Error(`could not reach ${status}: ${JSON.stringify(advanced)}`);
    }
  }
  season = created.id;
});

afterAll(async () => {
  if (org.id !== "") {
    await purgeOrg(db, org.id);
    await db.delete(registrationsTable).where(eq(registrationsTable.orgId, org.id));
    await db.delete(teamsTable).where(eq(teamsTable.orgId, org.id));
    await db.delete(competitionsTable).where(eq(competitionsTable.orgId, org.id));
    await db.delete(grantsTable).where(eq(grantsTable.scopeId, org.id));
    await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
    await db.delete(auditLog).where(eq(auditLog.scopeId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
  const ids = [organizerId, ...seeded].filter((id) => id !== "");
  if (ids.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, ids));
    await db.delete(auditLog).where(inArray(auditLog.actor, ids));
    await db.delete(people).where(inArray(people.id, ids));
  }
  await db.delete(otpCodes).where(inArray(otpCodes.phone, PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, PHONES));
  await handle.sql.end();
});

describe("THE ANCHOR — what the database still refuses", () => {
  it("accepts a person with an email and no phone", async () => {
    const [row] = await db
      .select({ phone: people.phone, email: people.email })
      .from(people)
      .where(eq(people.id, emailOnlyId));
    expect(row?.phone).toBeNull();
    expect(row?.email).toBe(EMAIL_ONLY);
  });

  it("REFUSES a person with neither — people_reachable_check", async () => {
    // The constraint is the whole reason dropping NOT NULL was safe. Without it
    // 0062 would have permitted an account nobody, including its owner, can
    // ever reach again.
    expect(
      await refusedBy(db.insert(people).values({ id: newId(), phone: null, email: null })),
    ).toBe("people_reachable_check");
  });

  it("keeps BOTH credentials unique — a second account on either is refused", async () => {
    // Named, not merely "it threw": a unique violation and a reachable-check
    // violation are different refusals, and a test that accepts either would
    // pass if this row were rejected for having no contact at all.
    expect(
      await refusedBy(db.insert(people).values({ id: newId(), phone: null, email: EMAIL_ONLY })),
    ).toBe("people_email_uq");
    expect(await refusedBy(db.insert(people).values({ id: newId(), phone: SOMEBODY_ELSES }))).toBe(
      "people_phone_unique",
    );
    /*
     * AND CASE-INSENSITIVELY on the address — `people_email_uq` is a unique
     * index on `lower(email)`. Without that, `Verified@…` and `verified@…` are
     * two accounts on one mailbox, and whoever reads it can sign into either:
     * the same takeover the unverified-address refusal was written to stop,
     * reached by holding shift.
     */
    expect(
      await refusedBy(
        db.insert(people).values({ id: newId(), phone: null, email: EMAIL_ONLY.toUpperCase() }),
      ),
    ).toBe("people_email_uq");
  });
});

describe("THE PLAYER RULE — a season reaches players by SMS or not at all", () => {
  it("REFUSES a registration from an account with no phone", async () => {
    const result = await submitRegistration(db, season, org.id, emailOnlyId, "batter");
    expect(result).toEqual({ ok: false, reason: "no_phone" });
  });

  it("writes nothing when it refuses", async () => {
    // A refusal that left a row would be worse than no rule at all: the
    // organizer would see a player in the pool that no notice can reach.
    const rows = await db
      .select({ id: registrationsTable.id })
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.competitionId, season),
          eq(registrationsTable.personId, emailOnlyId),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("lets the same person in once a number is attached", async () => {
    const requested = await requestPhoneChange(db, sender, {
      personId: emailOnlyId,
      newPhone: TO_ATTACH,
    });
    expect(requested).toEqual({ ok: true });

    const confirmed = await confirmPhoneChange(db, {
      personId: emailOnlyId,
      newPhone: TO_ATTACH,
      code: await latestCode(TO_ATTACH),
    });
    // No OLD number to announce to — this was an attach, not a move.
    expect(confirmed).toEqual({ ok: true, previousPhone: null, newPhone: TO_ATTACH });

    const result = await submitRegistration(db, season, org.id, emailOnlyId, "batter");
    expect(result).toMatchObject({ ok: true });
  });

  it("keeps the address as well as the number — attaching is not replacing", async () => {
    const [row] = await db
      .select({ phone: people.phone, email: people.email })
      .from(people)
      .where(eq(people.id, emailOnlyId));
    expect(row?.phone).toBe(TO_ATTACH);
    expect(row?.email).toBe(EMAIL_ONLY);
  });
});

describe("NO MERGE — a credential in use is refused, never folded", () => {
  it("REFUSES to attach a number that already signs somebody else in", async () => {
    const claimant = await emailAnchored(OTHER_EMAIL);
    await requestPhoneChange(db, sender, { personId: claimant, newPhone: SOMEBODY_ELSES });
    const confirmed = await confirmPhoneChange(db, {
      personId: claimant,
      newPhone: SOMEBODY_ELSES,
      code: await latestCode(SOMEBODY_ELSES),
    });
    expect(confirmed).toEqual({ ok: false, reason: "taken" });

    // And nothing moved: the other account still holds its number, and the
    // claimant still holds none. A half-applied merge is the outcome this
    // refusal exists to prevent.
    const [holder] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, phoneHolderId));
    expect(holder?.phone).toBe(SOMEBODY_ELSES);
    const [refused] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, claimant));
    expect(refused?.phone).toBeNull();
  });
});

describe("THE DIRECTORY — an email-anchored person can still be found", () => {
  it("matches on the address, not only the name and number", async () => {
    /*
     * The only directory the platform has. Before this, an account anchored by
     * an address matched nothing: no phone to search, and no name either until
     * onboarding is finished. An operator handed the address had no way to
     * reach the row — which is the single thing this screen exists to do.
     */
    const found = await userDirectory(db, EMAIL_ONLY);
    expect(found.rows.map((row) => row.id)).toContain(emailOnlyId);
  });

  it("still matches on a name and a number", async () => {
    // The addition must not have cost the two that already worked.
    expect((await userDirectory(db, "Already Here")).rows.map((r) => r.id)).toContain(
      phoneHolderId,
    );
    expect((await userDirectory(db, SOMEBODY_ELSES.slice(-6))).rows.map((r) => r.id)).toContain(
      phoneHolderId,
    );
  });
});

describe("THE NOTICE — a null phone is SUPPRESSED, never counted as failed", () => {
  it("stands the decision and reports it as suppressed", async () => {
    /*
     * A DEFENSIVE BRANCH, TESTED BY BUILDING THE STATE IT DEFENDS AGAINST.
     *
     * `submitRegistration` now refuses a phoneless applicant, so nothing in the
     * product produces this row any more — which is exactly why it is written
     * here by hand rather than through the door. The branch exists for the row
     * that arrives another way (an organizer adding somebody, a future import,
     * a person whose account changes under a pending registration), and an
     * untested defence is a defence nobody has seen work.
     *
     * FAILED and SUPPRESSED are the distinction that matters. Counting this as
     * failed sends an organizer chasing a delivery fault that does not exist;
     * worse, on a bulk approve of forty players it makes the whole run look
     * broken because of one row. The decision stands either way — the notice is
     * a courtesy, the approval is the fact.
     */
    const phoneless = await emailAnchored(`notify${RUN}@example.test`);
    const registrationId = newId();
    await db.insert(registrationsTable).values({
      id: registrationId,
      orgId: org.id,
      competitionId: season,
      personId: phoneless,
      role: "batter",
      status: "approved",
      registrationNumber: registrationNumber(registrationId),
    });

    const outcome = await notifyDecision(
      db,
      {
        orgId: org.id,
        competitionName: "Cup",
        registrationIds: [registrationId],
        event: "approve",
        actorId: organizerId,
      },
      new DevInboxSmsSender(db),
    );
    expect(outcome).toEqual({ sent: 0, failed: 0, suppressed: 1 });
  });
});
