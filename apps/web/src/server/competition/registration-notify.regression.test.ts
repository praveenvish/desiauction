/**
 * PERMANENT REGRESSION — the notices that went nowhere and said so as zero.
 *
 * `notifyDecision` built its link as
 * `${PUBLIC_BASE_URL}/seasons/${slug}/register`, and the `{link}` slot the DLT
 * operator registers is capped at 60 characters. A season slug is
 * `slugifyName(name)` — sliced to 40 — plus a four-character id suffix, so the
 * link ran to 85 characters at its worst and to 71 for a name as ordinary as
 * "Bandra Premier League 2027".
 *
 * Over the cap, `renderTemplate` refuses, `messageFor` returns null, and the
 * function answered `{sent: 0, failed: 0, suppressed: 0}`. Nothing threw,
 * nothing logged, nothing counted. An organizer approving forty players told
 * forty nobody and was shown a number that reads as "there was nothing to
 * send" — so the single loudest symptom of the bug was silence.
 *
 * Two properties are held here, and they are different in kind:
 *
 *   THE LINK FITS, for every season a person can create. Proven at the
 *   MAXIMUM, not at a plausible example, because "plausible" is how the
 *   original passed review.
 *
 *   AN UNRENDERABLE MESSAGE IS LOUD. Even if some future slot does overrun,
 *   the people who were not told are counted as failed rather than vanishing.
 *   The first property is the fix; the second is what makes the next one
 *   survivable.
 */
import { NAME_MAX_LENGTH, registrationNumber } from "@desiauction/core";
import {
  auditLog,
  competitions as competitionsTable,
  createDb,
  grants as grantsTable,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  people,
  registrations as registrationsTable,
  sessions,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { createOrg } from "../orgs/orgs";
import { advanceCompetition, createCompetition, resolveCompetition } from "./competitions";
import { DevInboxSmsSender, notifyDecision } from "./registration-notify";
import { purgeOrg } from "../test-support/purge-org";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const ORGANIZER = `+9198${RUN}1`;
const PLAYER = `+9198${RUN}2`;
// A SECOND player, because a registration is unique per person per season — the
// unrenderable case below needs its own row, not a second one for the first.
const OTHER_PLAYER = `+9198${RUN}3`;

/*
 * THE LONGEST NAME A PERSON CAN GIVE A SEASON. `validateName` refuses anything
 * over NAME_MAX_LENGTH, and `slugifyName` slices the result to 40 — so this
 * produces the longest slug the product can ever hold, which is the only case
 * worth testing. A merely realistic name ("Bandra Premier League 2027") also
 * broke the old code, but passing on one is not evidence about the rest.
 */
const LONGEST_NAME = `Malad Gymkhana Cricket Championship Invitational ${RUN}`.slice(
  0,
  NAME_MAX_LENGTH,
);

let organizerId = "";
let playerId = "";
let otherPlayerId = "";
let org = { id: "", name: "", slug: "" };
let season = "";
let seasonSlug = "";
const seeded: string[] = [];

async function login(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const [row] = await db
    .select({ code: otpInbox.code })
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(otpInbox.createdAt)
    .limit(1);
  const verified = await verifyOtp(db, phone, row?.code ?? "");
  if (!verified.ok) {
    throw new Error("login failed");
  }
  return verified.personId;
}

beforeAll(async () => {
  organizerId = await login(ORGANIZER);
  playerId = newId();
  await db.insert(people).values({ id: playerId, phone: PLAYER, name: "Told Player" });
  seeded.push(playerId);
  otherPlayerId = newId();
  await db.insert(people).values({ id: otherPlayerId, phone: OTHER_PLAYER, name: "Untold Player" });
  seeded.push(otherPlayerId);

  org = await createOrg(db, organizerId, `Notify Org ${RUN}`);
  const created = await createCompetition(db, org.id, organizerId, {
    sport: "cricket",
    name: LONGEST_NAME,
    location: "Malad",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
  });
  season = created.id;
  seasonSlug = created.slug;
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
  const phones = [ORGANIZER, PLAYER, OTHER_PLAYER];
  await db.delete(otpCodes).where(inArray(otpCodes.phone, phones));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, phones));
  await handle.sql.end();
});

/** An approved registration for one of the seeded players, ready to be told about. */
async function approvedRegistration(personId: string): Promise<string> {
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId: org.id,
    competitionId: season,
    personId,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(id),
  });
  return id;
}

describe("THE LONG SEASON NAME that silently swallowed every notice", () => {
  it("produces the longest slug the product can hold", () => {
    // If this stops being true the test below stops proving anything, so it is
    // asserted rather than assumed.
    expect(seasonSlug.length).toBeGreaterThanOrEqual(40);
  });

  it("TEXTS THE PLAYER — the whole point, and what used to return zero", async () => {
    const registrationId = await approvedRegistration(playerId);
    const outcome = await notifyDecision(
      db,
      {
        orgId: org.id,
        competitionName: LONGEST_NAME,
        registrationIds: [registrationId],
        event: "approve",
        actorId: organizerId,
      },
      new DevInboxSmsSender(db),
    );
    expect(outcome).toEqual({ sent: 1, failed: 0, suppressed: 0 });

    // And a real message reached the real number, rather than a count that says
    // so. The old code's failure was precisely a count that agreed with itself.
    const [message] = await db
      .select({ body: otpInbox.code })
      .from(otpInbox)
      .where(and(eq(otpInbox.phone, PLAYER), like(otpInbox.code, "DesiAuction:%")))
      .limit(1);
    expect(message?.body).toContain("You are approved for");
    expect(message?.body).toContain(LONGEST_NAME);
  });

  it("sends a link that fits the slot with the season left out of it", async () => {
    const [message] = await db
      .select({ body: otpInbox.code })
      .from(otpInbox)
      .where(and(eq(otpInbox.phone, PLAYER), like(otpInbox.code, "DesiAuction:%")))
      .limit(1);
    // Matched, not split on a lead-in word: "Details: " was dropped from these
    // notices to save nine characters on every send, and a test that locates
    // the link by prose breaks when the prose changes for reasons that have
    // nothing to do with what it is checking.
    const link = /https?:\/\/\S+/.exec(message?.body ?? "")?.[0] ?? "";
    expect(link).not.toBe("");
    /*
     * THE SLUG MUST NOT BE IN IT. This is the property that makes the bug
     * unrepeatable: any link carrying the season can overflow at the slug's own
     * maximum — even `desiauction.in/c/<slug>`, with no scheme, reaches 62 —
     * so the only safe link is one with no variable part at all.
     */
    expect(link).not.toContain(seasonSlug);
    expect(link.length).toBeLessThanOrEqual(60);
  });
});

describe("AN UNRENDERABLE MESSAGE IS COUNTED, NOT SWALLOWED", () => {
  it("reports every untold person as FAILED rather than answering zero", async () => {
    /*
     * Forced through the competition NAME, the other capped slot, because the
     * link can no longer overrun. The point is not which slot broke — it is
     * that a message we could not compose must never read as "nothing to send".
     *
     * FAILED and not SUPPRESSED, deliberately: suppressed means "we decided not
     * to text this person" and is a settled state nobody chases. This is ours
     * to fix, and an organizer seeing a non-zero failure is the only way it
     * surfaces at all.
     */
    const registrationId = await approvedRegistration(otherPlayerId);
    const outcome = await notifyDecision(
      db,
      {
        orgId: org.id,
        competitionName: "x".repeat(200),
        registrationIds: [registrationId],
        event: "approve",
        actorId: organizerId,
      },
      new DevInboxSmsSender(db),
    );
    expect(outcome).toEqual({ sent: 0, failed: 1, suppressed: 0 });
  });

  it("still answers zero for an empty batch, which really is nothing to do", async () => {
    const outcome = await notifyDecision(db, {
      orgId: org.id,
      competitionName: LONGEST_NAME,
      registrationIds: [],
      event: "approve",
      actorId: organizerId,
    });
    expect(outcome).toEqual({ sent: 0, failed: 0, suppressed: 0 });
  });
});
