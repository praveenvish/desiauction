import { DEFAULT_AUCTION_CONFIG } from "@desiauction/core";
import {
  auctions,
  auditLog,
  competitions,
  createDb,
  newId,
  notificationPreferences,
  orgMessagingSettings,
  organizations,
  paddles,
  people,
  teams,
  type DbHandle,
} from "@desiauction/db";
import { finopsDeps, type FinopsDeps } from "@desiauction/financial-operations/server";
import type { EmailTransport } from "@desiauction/messaging/email-adapter";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runnerDelivery } from "./delivery";
import { parseEnv } from "./env";

/**
 * THE RUNNER'S DELIVERY PATH, against a real database.
 *
 * Built exactly as `index.ts` builds it — `finopsDeps(db, { delivery:
 * runnerDelivery(db, env) })` under a PRODUCTION environment — and driven
 * through `deps.delivery(channel)`, which is the one call `runDispatchSend`
 * makes. The provider is a recording transport; everything else is real.
 *
 * A POSTURE test, named so: with `RUNNER_DATABASE_URL` set it runs the
 * adapters as `desiauction_runner` (ops/db/create-app-role.sql) rather than the
 * owner, so the grants the path needs are proven rather than assumed — CI does
 * exactly that once the roles exist. Without it (the integration run, before
 * the roles are created) it runs as the owner. Seeding always uses the owner.
 */

const owner: DbHandle = createDb(process.env["DATABASE_URL"] ?? "");
const runner: DbHandle =
  process.env["RUNNER_DATABASE_URL"] === undefined
    ? owner
    : createDb(process.env["RUNNER_DATABASE_URL"]);

const PROD = parseEnv({
  NODE_ENV: "production",
  DATABASE_URL: "postgres://runner@db/desiauction",
  SENTRY_DSN: "https://key@sentry.example/1",
  FINOPS_ARTIFACT_STORE: "bucket",
  EMAIL_API_ENDPOINT: "https://provider.test/send",
  EMAIL_API_KEY: "k",
  EMAIL_FROM: "no-reply@test",
});

const RUN = String(Date.now()).slice(-7);
const EMAIL = `runner-owner-${RUN}@example.com`;
const personId = newId();
const orgId = newId();
const competitionId = newId();
const auctionId = newId();
const teamId = newId();

const sentTo: string[] = [];
const transport: EmailTransport = (_url, init) => {
  sentTo.push(...(JSON.parse(init.body) as { to: string[] }).to);
  return Promise.resolve({ status: 202, body: "{}" });
};

let deps: FinopsDeps;

function receipt(channel: "email" | "in-app") {
  const dispatchId = newId();
  return {
    dispatchId,
    orgId,
    channel,
    recipientRef: `owner:${teamId}`,
    templateId: "receipt.issued",
    templateVersion: "1",
    subjectRef: `doc:${newId()}`,
    body: "Receipt RCT/2026-27/000001 for Rs 1,20,000",
    bodyDigest: "digest",
    idempotencyKey: `dispatch:${dispatchId}`,
  };
}

beforeAll(async () => {
  const db = owner.db;
  await db.insert(people).values({
    id: personId,
    phone: `+9196${RUN}1`,
    name: "Runner Owner",
    email: EMAIL,
    emailVerifiedAt: new Date(),
  });
  await db.insert(organizations).values({
    id: orgId,
    name: `Runner Org ${RUN}`,
    slug: `runner-org-${RUN}`,
    createdBy: personId,
  });
  await db.insert(competitions).values({
    id: competitionId,
    orgId,
    sport: "cricket",
    name: `Runner Season ${RUN}`,
    slug: `runner-season-${RUN}`,
    createdBy: personId,
  });
  await db.insert(auctions).values({
    id: auctionId,
    orgId,
    competitionId,
    name: `Runner Auction ${RUN}`,
    config: DEFAULT_AUCTION_CONFIG,
    createdBy: personId,
  });
  await db.insert(teams).values({
    id: teamId,
    orgId,
    competitionId,
    name: `Runner Team ${RUN}`,
    createdBy: personId,
  });
  await db
    .insert(paddles)
    .values({ id: newId(), orgId, auctionId, teamId, personId, paddleNumber: "1" });
  deps = finopsDeps(runner.db, { delivery: runnerDelivery(runner.db, PROD, transport) });
});

afterAll(async () => {
  const db = owner.db;
  await db.delete(auditLog).where(eq(auditLog.scopeId, personId));
  await db.delete(notificationPreferences).where(eq(notificationPreferences.personId, personId));
  // The owner handle is the superuser locally and in CI, so FORCE RLS does not
  // hide this org's row from it.
  await db.delete(orgMessagingSettings).where(eq(orgMessagingSettings.orgId, orgId));
  await db.delete(paddles).where(eq(paddles.orgId, orgId));
  await db.delete(auctions).where(eq(auctions.orgId, orgId));
  await db.delete(teams).where(eq(teams.orgId, orgId));
  await db.delete(competitions).where(eq(competitions.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(people).where(eq(people.id, personId));
  if (runner !== owner) {
    await runner.sql.end({ timeout: 5 });
  }
  await owner.sql.end({ timeout: 5 });
});

describe("the runner delivers a receipt to the person it is addressed to", () => {
  it("emails the team owner's verified address through the provider", async () => {
    sentTo.length = 0;
    const result = await deps.delivery("email")?.send(receipt("email"));
    expect(result?.ok).toBe(true);
    expect(sentTo).toEqual([EMAIL]);
  });

  it("writes the person-scoped row /inbox reads", async () => {
    const request = receipt("in-app");
    const result = await deps.delivery("in-app")?.send(request);
    expect(result?.ok).toBe(true);
    const rows = await owner.db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.scopeId, personId), eq(auditLog.action, "finance.document.issued")));
    expect(rows.map((row) => (row.meta as { dispatchId?: string }).dispatchId)).toContain(
      request.dispatchId,
    );
  });

  it("honours the CLUB's money switch on the runner's service pool", async () => {
    // FORCE RLS on this table, and the runner holds no tenant scope: its role
    // is BYPASSRLS and `maySend` filters by org_id itself, so the club's own row
    // is read. Were either ever untrue the switch would silently read "on".
    await owner.db.insert(orgMessagingSettings).values({
      id: newId(),
      orgId,
      topic: "money",
      channel: "email",
      enabled: false,
    });
    sentTo.length = 0;
    const result = await deps.delivery("email")?.send(receipt("email"));
    expect(sentTo).toEqual([]);
    expect(result).toEqual({ ok: false, code: "withheld:org_disabled", retryable: false });
    await owner.db.delete(orgMessagingSettings).where(eq(orgMessagingSettings.orgId, orgId));
  });

  it("withholds the email once the owner switches 'Receipts and money' off — a failure, never a delivery", async () => {
    await owner.db.insert(notificationPreferences).values({
      id: newId(),
      personId,
      topic: "money",
      channel: "email",
      allowed: false,
    });
    sentTo.length = 0;
    const result = await deps.delivery("email")?.send(receipt("email"));
    expect(sentTo, "the provider was never asked").toEqual([]);
    expect(result).toEqual({ ok: false, code: "withheld:opted_out", retryable: false });
  });
});
