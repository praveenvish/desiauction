/**
 * RUNTIME POSTURE — the payment callback, under the production role recipe.
 *
 * PA-1 §10 P0-1. `handleRazorpayWebhook` did its org-scoped work on the raw app
 * pool: it verified the signature, then loaded the payment by id with no
 * `app.org_id` set. `payments` carries FORCE ROW LEVEL SECURITY keyed on that
 * setting and `desiauction_app` is NOBYPASSRLS, so the policy was false for
 * every row, `loadPayment` returned null, and every genuine capture answered
 * **404**. Razorpay would retry until it gave up while the organizer's account
 * had already been credited.
 *
 * The handler's own comment marked the spot — "the point at which a withTenant
 * boundary WOULD wrap the work" — and nothing did. Nothing local could see it:
 * every other suite connects as the OWNER, for whom RLS is inert, so the
 * forgery tests all passed against a handler that could not read its own table.
 *
 * This runs the real handler as `desiauction_app`, which is the only way to
 * tell the difference.
 */
import { createHmac } from "node:crypto";

import { createDb, withTenantDb } from "@desiauction/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dbHandle } from "../server/db";
import { settlementDeps } from "../server/settlement/deps";
import { handleRazorpayWebhook } from "../server/settlement/webhook";

const owner = createDb(process.env["OWNER_DATABASE_URL"] ?? "");

/**
 * IDs ARE `char(26)`, AND 25 CHARACTERS IS A SILENT FAILURE.
 *
 * Postgres pads a short value to the column width, so a bound parameter of 25
 * characters never equals the padded row and the query simply finds nothing —
 * no error, just an empty result that reads exactly like RLS refusing. The
 * first draft of this file spent its ids one character short and produced a
 * convincing "the tenant boundary is broken" failure.
 *
 * `id()` pads, so the shape is impossible to get wrong by miscounting.
 */
const id = (label: string): string => label.padEnd(26, "0");

const ORG = id("01M1POSTURERZP1ORG");
const CASE = id("01M1POSTURERZP1CASE");
const TEAM = id("01M1POSTURERZP1TEAM");
const PAYMENT = id("01M1POSTURERZP1PAY");
const AMOUNT = 250_000;
const NOW = Date.now();

/** Must match RAZORPAY_WEBHOOK_SECRET in vitest.posture.config.ts. */
const SECRET = "posture-razorpay-secret-0123456789";

function body(event: string, entity: Record<string, unknown>): string {
  return JSON.stringify({
    event,
    created_at: Math.floor(NOW / 1000),
    payload: {
      payment: {
        entity: { currency: "INR", notes: { paymentId: PAYMENT, orgId: ORG }, ...entity },
      },
    },
  });
}

const sign = (raw: string): string => createHmac("sha256", SECRET).update(raw).digest("hex");

/** The boundary the route supplies in production. */
const withTenant = <T>(
  orgId: string,
  run: (deps: ReturnType<typeof settlementDeps>) => Promise<T>,
) =>
  withTenantDb(dbHandle, { personId: id("0"), orgId }, (tenantDb) => run(settlementDeps(tenantDb)));

beforeAll(async () => {
  await owner.sql`delete from payments where id = ${PAYMENT}`;
  await owner.sql`
    insert into payments (id, org_id, case_id, team_id, method, amount, status)
    values (${PAYMENT}, ${ORG}, ${CASE}, ${TEAM}, 'gateway:razorpay', ${AMOUNT}, 'created')
  `;
});
afterAll(async () => {
  await owner.sql`delete from payments where id = ${PAYMENT}`;
  await owner.sql`delete from settlement_events where org_id = ${ORG}`;
  await owner.sql.end();
});

describe("POSTURE — Razorpay callback under the app role (PA-1 P0-1)", () => {
  it("finds the payment it was sent, instead of answering 404", async () => {
    const raw = body("payment.captured", { amount: AMOUNT, id: "pay_posture_0001" });
    const result = await handleRazorpayWebhook(
      settlementDeps(dbHandle.db),
      { rawBody: raw, signature: sign(raw), receivedAtMs: NOW },
      withTenant,
    );

    expect(
      result.ok ? "found" : `${String(result.status)}:${result.reason}`,
      "the callback could not see its own payment row — under the production " +
        "roles every capture 404s and the gateway retries until it gives up",
    ).toBe("found");
  });

  it("still refuses a forged signature before it looks anything up", async () => {
    const raw = body("payment.captured", { amount: AMOUNT, id: "pay_posture_0002" });
    const result = await handleRazorpayWebhook(
      settlementDeps(dbHandle.db),
      { rawBody: raw, signature: "forged", receivedAtMs: NOW },
      withTenant,
    );
    expect(result).toMatchObject({ ok: false, status: 401, reason: "bad_signature" });
  });

  it("refuses an envelope naming a different org than the payment", async () => {
    // The org selects the tenant, so a forged one must not be able to reach
    // another tenant's payment. Here the signature is VALID and the org is
    // wrong: the boundary opens on the envelope's org, finds no such payment
    // there, and the request dies as unknown rather than crossing tenants.
    const raw = JSON.stringify({
      event: "payment.captured",
      created_at: Math.floor(NOW / 1000),
      payload: {
        payment: {
          entity: {
            currency: "INR",
            notes: { paymentId: PAYMENT, orgId: id("01M1POSTURERZP2ORG") },
            amount: AMOUNT,
            id: "pay_posture_0003",
          },
        },
      },
    });
    const result = await handleRazorpayWebhook(
      settlementDeps(dbHandle.db),
      { rawBody: raw, signature: sign(raw), receivedAtMs: NOW },
      withTenant,
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? 0 : result.status).toBe(404);
  });
});
