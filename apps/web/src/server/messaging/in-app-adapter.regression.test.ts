import {
  auctions,
  auditLog,
  competitions,
  createDb,
  newId,
  organizations,
  paddles,
  people,
  teams,
  type DbHandle,
} from "@desiauction/db";
import { DEFAULT_AUCTION_CONFIG } from "@desiauction/core";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { FINANCE_DOCUMENT_ISSUED, createPersonInAppAdapter } from "./in-app-adapter";

/**
 * Does a receipt reach the person who paid?
 *
 * The platform's own in-app adapter answers "yes" without doing anything, so
 * this suite deliberately asserts the ROW, never the return value. A test that
 * trusted `ok: true` would have passed against the defect it exists to prevent.
 *
 * The existing finops delivery suite cannot cover this: it builds `finopsDeps`
 * directly and therefore always exercises the platform's default adapter, not
 * the override the web tier injects.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9194${RUN}1`;
const PHONE_SECOND = `+9194${RUN}2`;

const ownerId = newId();
const secondId = newId();
const teamId = newId();
const secondTeamId = newId();
const orphanTeamId = newId();
const auctionId = newId();
const orgId = newId();
const competitionId = newId();

function request(recipientRef: string) {
  const dispatchId = newId();
  return {
    dispatchId,
    orgId,
    channel: "in-app" as const,
    recipientRef,
    templateId: "receipt.issued",
    templateVersion: "1",
    subjectRef: `doc:${newId()}`,
    body: "Receipt RCT/2026-27/000001 for Rs 1,20,000",
    bodyDigest: "digest",
    idempotencyKey: `dispatch:${dispatchId}`,
  };
}

beforeAll(async () => {
  await db.delete(people).where(inArray(people.phone, [PHONE_OWNER, PHONE_SECOND]));
  await db.insert(people).values([
    { id: ownerId, phone: PHONE_OWNER, name: "Inapp Synthetic" },
    { id: secondId, phone: PHONE_SECOND, name: "Second Synthetic" },
  ]);
  /*
   * THE PARENTS THIS FIXTURE USED TO INVENT.
   *
   * It minted an `orgId`, a `competitionId` and an `auctionId` and inserted
   * paddles against them without ever creating the rows — a state the product
   * cannot produce, and one migration 0043's foreign keys now refuse outright.
   * Building the real chain is a handful of inserts and makes the fixture
   * describe something that could actually exist, which is what a regression
   * test is for.
   */
  await db.insert(organizations).values({
    id: orgId,
    name: `In-app Org ${RUN}`,
    slug: `inapp-org-${RUN}`,
    createdBy: ownerId,
  });
  await db.insert(competitions).values({
    id: competitionId,
    orgId,
    name: `In-app Season ${RUN}`,
    slug: `inapp-season-${RUN}`,
    createdBy: ownerId,
  });
  await db.insert(teams).values([
    { id: teamId, orgId, competitionId, name: `In-app Team A ${RUN}`, createdBy: ownerId },
    { id: secondTeamId, orgId, competitionId, name: `In-app Team B ${RUN}`, createdBy: ownerId },
    { id: orphanTeamId, orgId, competitionId, name: `In-app Team C ${RUN}`, createdBy: ownerId },
  ]);
  await db.insert(auctions).values({
    id: auctionId,
    orgId,
    competitionId,
    name: `In-app Auction ${RUN}`,
    config: DEFAULT_AUCTION_CONFIG,
    createdBy: ownerId,
  });

  // Ownership is a PADDLE, not a column on the team — the chain the adapter has
  // to walk, and the one an earlier fix got wrong by looking in `people`.
  // One paddle per team: `paddles_auction_team_active_uq` is UNIQUE on
  // (auction_id, team_id) for active rows, so a team has exactly one paddle
  // holder at a time. Two people can ACCEPT ownership through invites - Screen
  // 24 found nothing prevents that - but only one can hold the paddle. Hence
  // two teams here rather than two paddles on one.
  await db.insert(paddles).values([
    // `paddle_number` is TEXT, not an integer — Postgres coerced a number at
    // runtime and only typecheck noticed.
    { id: newId(), orgId, auctionId, teamId: teamId, personId: ownerId, paddleNumber: "1" },
    { id: newId(), orgId, auctionId, teamId: secondTeamId, personId: secondId, paddleNumber: "2" },
  ]);
});

afterAll(async () => {
  await db.delete(auditLog).where(inArray(auditLog.scopeId, [ownerId, secondId]));
  await db.delete(paddles).where(eq(paddles.auctionId, auctionId));
  await db.delete(auctions).where(eq(auctions.id, auctionId));
  await db.delete(teams).where(eq(teams.competitionId, competitionId));
  await db.delete(competitions).where(eq(competitions.id, competitionId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(people).where(inArray(people.phone, [PHONE_OWNER, PHONE_SECOND]));
  await db.delete(auditLog).where(like(auditLog.subject, `%${RUN}%`));
  await handle.sql.end({ timeout: 5 });
});

describe("in-app delivery reaches the payer", () => {
  it("writes a person-scoped row the inbox will read", async () => {
    const adapter = createPersonInAppAdapter(db);
    const result = await adapter.send(request(`owner:${teamId}`));
    expect(result.ok).toBe(true);

    // The assertion that matters: a row exists, scoped to the person, with the
    // action the inbox has a label for. `ok: true` proves nothing here — the
    // adapter this replaces returned exactly that and wrote nothing.
    const rows = await db
      .select({ action: auditLog.action, scopeType: auditLog.scopeType })
      .from(auditLog)
      .where(eq(auditLog.scopeId, ownerId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.action).toBe(FINANCE_DOCUMENT_ISSUED);
    expect(rows[0]?.scopeType, "person-scoped, or listSecurityEvents cannot see it").toBe("person");
  });

  it("tells the right team's owner and nobody else", async () => {
    // Two teams, two paddle holders. A receipt addressed to one team must not
    // land in the other owner's inbox - they are rivals in the same auction.
    const adapter = createPersonInAppAdapter(db);
    await adapter.send(request(`owner:${secondTeamId}`));
    const first = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.scopeId, ownerId));
    const second = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.scopeId, secondId));
    expect(first.length, "one receipt each, not two").toBe(1);
    expect(second.length).toBe(1);
  });

  it("REFUSES, retryably, when nobody has claimed a paddle for the team", async () => {
    // A team with no paddle has no person to tell. Retryable on purpose: an
    // owner may accept and claim after the document was issued.
    const adapter = createPersonInAppAdapter(db);
    const result = await adapter.send(request(`owner:${orphanTeamId}`));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("recipient_unresolved");
      expect(result.retryable).toBe(true);
    }
  });

  it("REFUSES a recipient shape it does not understand, rather than confirming", async () => {
    // The whole defect being replaced is a confirmation for something that did
    // not happen. An unparseable recipient must fail loudly and not retry.
    const adapter = createPersonInAppAdapter(db);
    const result = await adapter.send(request("person:whatever"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
    }
  });
});
