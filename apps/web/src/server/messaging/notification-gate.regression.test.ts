import {
  auctions,
  auditLog,
  competitions,
  consentRecords,
  createDb,
  newId,
  notificationPreferences,
  orgMessagingSettings,
  organizations,
  paddles,
  people,
  suppressions,
  teams,
  withTenantDb,
  type DbHandle,
} from "@desiauction/db";
import { DEFAULT_AUCTION_CONFIG } from "@desiauction/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import {
  latestSecurityEventAt,
  listInboxEvents,
  listSecurityEvents,
} from "../auth/security-events";
import { resolveOwnerEmail } from "../financial-operations/deps";
import { orgSwitchesFor, setOrgMessagingSetting, setPreference } from "./consent";
import { createHttpEmailAdapter, type EmailTransport } from "./email-adapter";
import { notificationGate } from "./gate";
import { FINANCE_DOCUMENT_ISSUED, createPersonInAppAdapter } from "./in-app-adapter";

/**
 * THE GATE'S FOUR GAPS, against a real database (Notification Control Center,
 * Phase 0). Each block is one gap the catalogue + gate closed; each asserts the
 * thing a person would notice, not the gate's return value alone.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
const PHONE_A = `+9195${RUN}1`;
const PHONE_B = `+9195${RUN}2`;
const EMAIL_A = `gate-a-${RUN}@example.com`;
const EMAIL_B = `gate-b-${RUN}@example.com`;

const ownerA = newId();
const ownerB = newId();
const orgId = newId();
const competitionId = newId();
const secondSeason = newId();
const auctionId = newId();
const teamSolo = newId();
const teamPair = newId();

function receipt(recipientRef: string) {
  const dispatchId = newId();
  return {
    dispatchId,
    orgId,
    channel: "email" as const,
    recipientRef,
    templateId: "receipt.issued",
    templateVersion: "1",
    subjectRef: `doc:${newId()}`,
    body: "Receipt RCT/2026-27/000001 for Rs 1,20,000",
    bodyDigest: "digest",
    idempotencyKey: `dispatch:${dispatchId}`,
  };
}

/** A transport that records who it was asked to mail. */
function recording(): { transport: EmailTransport; sentTo: string[] } {
  const sentTo: string[] = [];
  return {
    sentTo,
    transport: (_url, init) => {
      const body = JSON.parse(init.body) as { to: string[] };
      sentTo.push(...body.to);
      return Promise.resolve({ status: 202, body: "{}" });
    },
  };
}

/** The finops email adapter exactly as `webFinopsDeps` builds it, on `tx`. */
function receiptAdapter(tx: typeof db, transport: EmailTransport) {
  return createHttpEmailAdapter(
    { endpoint: "https://provider.test/send", apiKey: "k", from: "no-reply@test", transport },
    resolveOwnerEmail(tx),
  );
}

/** The org's own boundary — where `webFinopsDeps` runs in the product. */
function inOrg<T>(run: (tx: typeof db) => Promise<T>): Promise<T> {
  return withTenantDb(handle, { personId: ownerA, orgId }, run);
}

beforeAll(async () => {
  const verified = new Date();
  await db.insert(people).values([
    { id: ownerA, phone: PHONE_A, name: "Gate A", email: EMAIL_A, emailVerifiedAt: verified },
    { id: ownerB, phone: PHONE_B, name: "Gate B", email: EMAIL_B, emailVerifiedAt: verified },
  ]);
  await db.insert(organizations).values({
    id: orgId,
    name: `Gate Org ${RUN}`,
    slug: `gate-org-${RUN}`,
    createdBy: ownerA,
  });
  await db.insert(competitions).values({
    id: competitionId,
    orgId,
    sport: "cricket",
    name: `Gate Season ${RUN}`,
    slug: `gate-season-${RUN}`,
    createdBy: ownerA,
  });
  await db.insert(auctions).values({
    id: auctionId,
    orgId,
    competitionId,
    name: `Gate Auction ${RUN}`,
    config: DEFAULT_AUCTION_CONFIG,
    createdBy: ownerA,
  });
  await db.insert(teams).values([
    { id: teamSolo, orgId, competitionId, name: `Gate Solo ${RUN}`, createdBy: ownerA },
    { id: teamPair, orgId, competitionId, name: `Gate Pair ${RUN}`, createdBy: ownerA },
  ]);
  // One paddle per team per auction, and one live auction per season: a second
  // season's auction gives teamPair its second owner (two people accepted
  // ownership — only one holds the paddle at a time).
  const secondAuction = newId();
  await db.insert(competitions).values({
    id: secondSeason,
    orgId,
    sport: "cricket",
    name: `Gate Season 2 ${RUN}`,
    slug: `gate-season-2-${RUN}`,
    createdBy: ownerA,
  });
  await db.insert(auctions).values({
    id: secondAuction,
    orgId,
    competitionId: secondSeason,
    name: `Gate Auction 2 ${RUN}`,
    config: DEFAULT_AUCTION_CONFIG,
    createdBy: ownerA,
  });
  await db.insert(paddles).values([
    { id: newId(), orgId, auctionId, teamId: teamSolo, personId: ownerA, paddleNumber: "1" },
    { id: newId(), orgId, auctionId, teamId: teamPair, personId: ownerA, paddleNumber: "2" },
    {
      id: newId(),
      orgId,
      auctionId: secondAuction,
      teamId: teamPair,
      personId: ownerB,
      paddleNumber: "1",
    },
  ]);
});

afterAll(async () => {
  await db.delete(auditLog).where(inArray(auditLog.scopeId, [ownerA, ownerB]));
  await db
    .delete(notificationPreferences)
    .where(inArray(notificationPreferences.personId, [ownerA, ownerB]));
  await withTenantDb(handle, { personId: ownerA, orgId }, (tx) =>
    tx.delete(orgMessagingSettings).where(eq(orgMessagingSettings.orgId, orgId)),
  );
  await db.delete(suppressions).where(inArray(suppressions.contact, [EMAIL_A, EMAIL_B]));
  await db.delete(paddles).where(eq(paddles.orgId, orgId));
  await db.delete(auctions).where(eq(auctions.orgId, orgId));
  await db.delete(teams).where(eq(teams.orgId, orgId));
  await db.delete(competitions).where(eq(competitions.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, [ownerA, ownerB]));
  await db.delete(people).where(inArray(people.id, [ownerA, ownerB]));
  await handle.sql.end({ timeout: 5 });
});

describe("gap 1 — the money switch stops receipt emails", () => {
  it("mails a receipt to an owner who has not switched anything off", async () => {
    const mail = recording();
    const result = await inOrg((tx) =>
      receiptAdapter(tx, mail.transport).send(receipt(`owner:${teamSolo}`)),
    );
    expect(result.ok).toBe(true);
    expect(mail.sentTo).toEqual([EMAIL_A]);
  });

  it("withholds it once they switch 'Receipts and money' off — a failure, never a delivery", async () => {
    await setPreference(db, { personId: ownerA, topic: "money", channel: "email", allowed: false });
    const mail = recording();
    const result = await inOrg((tx) =>
      receiptAdapter(tx, mail.transport).send(receipt(`owner:${teamSolo}`)),
    );
    expect(mail.sentTo, "the provider was never asked").toEqual([]);
    // What finops records: a terminal DispatchFailed carrying this code (see
    // runDispatchSend — a non-retryable refusal is final, never `sent`).
    expect(result).toEqual({ ok: false, code: "withheld:opted_out", retryable: false });
  });

  it("sends the team's copy to a co-owner who still wants it", async () => {
    const mail = recording();
    const result = await inOrg((tx) =>
      receiptAdapter(tx, mail.transport).send(receipt(`owner:${teamPair}`)),
    );
    expect(result.ok).toBe(true);
    expect(mail.sentTo, "owner A opted out; owner B did not").toEqual([EMAIL_B]);
  });

  it("does not let the switch touch other topics", async () => {
    const decision = await notificationGate(db, {
      kind: "auction.sold",
      channel: "email",
      recipient: { personId: ownerA, contact: EMAIL_A },
    });
    expect(decision.send).toBe(true);
    await setPreference(db, { personId: ownerA, topic: "money", channel: "email", allowed: true });
  });
});

describe("gap 2 — the in-app switch hides the inbox row, and keeps the evidence", () => {
  it("shows a receipt in the inbox until the person switches money off for the app", async () => {
    const sent = await createPersonInAppAdapter(db).send({
      ...receipt(`owner:${teamSolo}`),
      channel: "in-app",
    });
    expect(sent.ok).toBe(true);
    const before = await listInboxEvents(ownerA, 50);
    expect(before.map((event) => event.action)).toContain(FINANCE_DOCUMENT_ISSUED);

    await setPreference(db, {
      personId: ownerA,
      topic: "money",
      channel: "in-app",
      allowed: false,
    });
    const after = await listInboxEvents(ownerA, 50);
    expect(
      after.map((event) => event.action),
      "hidden from the inbox",
    ).not.toContain(FINANCE_DOCUMENT_ISSUED);
    const bell = await latestSecurityEventAt(ownerA);
    const newestShown = after[0]?.at ?? null;
    expect(bell?.getTime() ?? null, "the bell agrees with the inbox").toBe(
      newestShown?.getTime() ?? null,
    );

    // The audit row is the evidence, and a preference never erases it.
    const ledger = await listSecurityEvents(ownerA, 50);
    expect(ledger.map((event) => event.action)).toContain(FINANCE_DOCUMENT_ISSUED);
    const rows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.scopeId, ownerA));
    expect(rows.length).toBeGreaterThan(0);

    await setPreference(db, { personId: ownerA, topic: "money", channel: "in-app", allowed: true });
    const back = await listInboxEvents(ownerA, 50);
    expect(
      back.map((event) => event.action),
      "and it comes back",
    ).toContain(FINANCE_DOCUMENT_ISSUED);
  });
});

describe("gap 3 — the club's switch shows what it stops, and stops what it shows", () => {
  it("shows a topic OFF when its email row is off, even with the SMS row on", async () => {
    // The state the old view hid: it read the SMS row only.
    await inOrg((tx) =>
      setOrgMessagingSetting(tx, {
        orgId,
        topic: "registration",
        channel: "email",
        enabled: false,
        actorId: ownerA,
      }),
    );
    const shown = await inOrg((tx) => orgSwitchesFor(tx, orgId));
    expect(shown["registration"], "something is withheld, so it reads off").toBe(false);
    expect(shown["auction"]).toBe(true);
    expect(Object.keys(shown), "only switches some send obeys").toEqual([
      "registration",
      "auction",
      "money",
    ]);
  });

  it("and the gate honours that email row for mail sent on the club's behalf", async () => {
    const byMail = await inOrg((tx) =>
      notificationGate(tx, {
        kind: "registration.approved",
        channel: "email",
        recipient: { personId: ownerB, contact: EMAIL_B },
        orgId,
      }),
    );
    expect(byMail).toEqual({ send: false, reason: "org_disabled" });
    const byWhatsApp = await inOrg((tx) =>
      notificationGate(tx, {
        kind: "registration.approved",
        channel: "whatsapp",
        recipient: { personId: ownerB, contact: PHONE_B },
        orgId,
      }),
    );
    expect(byWhatsApp.send, "the text row is still on").toBe(true);
  });

  it("stops WhatsApp with the text switch — one row for both apps", async () => {
    await inOrg((tx) =>
      setOrgMessagingSetting(tx, {
        orgId,
        topic: "auction",
        channel: "sms",
        enabled: false,
        actorId: ownerA,
      }),
    );
    const decision = await inOrg((tx) =>
      notificationGate(tx, {
        kind: "auction.sold",
        channel: "whatsapp",
        recipient: { personId: ownerB, contact: PHONE_B },
        orgId,
      }),
    );
    expect(decision).toEqual({ send: false, reason: "org_disabled" });
  });

  it("lets a club stop receipt emails — a withheld dispatch, not a delivery", async () => {
    await inOrg((tx) =>
      setOrgMessagingSetting(tx, {
        orgId,
        topic: "money",
        channel: "email",
        enabled: false,
        actorId: ownerA,
      }),
    );
    const mail = recording();
    const result = await inOrg((tx) =>
      receiptAdapter(tx, mail.transport).send(receipt(`owner:${teamPair}`)),
    );
    expect(mail.sentTo).toEqual([]);
    expect(result).toEqual({ ok: false, code: "withheld:org_disabled", retryable: false });
  });
});
