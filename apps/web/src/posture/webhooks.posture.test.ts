/**
 * RUNTIME POSTURE — the webhook doors, under the production role recipe.
 *
 * Audit PA-1 §10 found two defects that no existing suite could see, because
 * every existing suite connects as the database owner and Postgres exempts the
 * owner from row-level security:
 *
 *   P0-1  the Razorpay callback loads its payment on the raw app pool with no
 *         `app.org_id` set, so FORCE RLS on `payments` returns zero rows and
 *         every capture answers 404 in production;
 *   P0-2  the SMS-inbound and delivery-status callbacks write `suppressions`
 *         and the finops tables through `desiauction_system`, which holds
 *         SELECT on them and nothing else.
 *
 * Both are invisible locally and certain in production. These tests make them
 * visible, and — once Phase 2 lands — keep them fixed.
 *
 * Read the failures literally: a `permission denied` or a 404 here is the
 * production behaviour, reproduced. It is not a broken test.
 */
import { createDb, suppressions } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Fixtures run as the OWNER: creating and cleaning tenant data is not something
// a tenant-scoped role can do. Only the code under test runs as the app.
const owner = createDb(process.env["OWNER_DATABASE_URL"] ?? "");

/** A number no real person holds, so the suppression row is unambiguously ours. */
const CONTACT = "+919999000451";

async function clearContact(): Promise<void> {
  await owner.db.delete(suppressions).where(eq(suppressions.contact, CONTACT));
}

beforeAll(clearContact);
afterAll(async () => {
  await clearContact();
  await owner.sql.end();
});

describe("POSTURE — the role the app actually runs as", () => {
  it("is neither superuser nor BYPASSRLS, or nothing below proves anything", async () => {
    const rows = (await owner.sql`
      select rolsuper, rolbypassrls from pg_roles where rolname = 'desiauction_app'
    `) as unknown as { rolsuper: boolean; rolbypassrls: boolean }[];
    expect(
      rows[0],
      "desiauction_app does not exist — run ops/db/create-app-role.sql",
    ).toBeDefined();
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });
});

describe("POSTURE — a pool reach with no tenant boundary is blind (PA-1 P0-1)", () => {
  // char(26): Postgres pads a short id, after which a bound parameter never
  // matches it — indistinguishable from RLS refusing. Pad rather than count.
  const pad = (label: string): string => label.padEnd(26, "0");
  const paymentId = pad("01M1POSTUREPAY");
  const orgId = pad("01M1POSTUREORG");

  beforeAll(async () => {
    await owner.sql`delete from payments where id = ${paymentId}`;
    await owner.sql`
      insert into payments (id, org_id, case_id, team_id, method, amount)
      values (${paymentId}, ${orgId}, ${pad("01M1POSTURECASE")},
              ${pad("01M1POSTURETEAM")}, ${"manual:cash"}, ${50000})
    `;
  });
  afterAll(async () => {
    await owner.sql`delete from payments where id = ${paymentId}`;
  });

  /**
   * This is the mechanism behind the Razorpay defect, isolated.
   *
   * `store.loadPayment` selects by id with no org predicate. Called inside
   * `withTenantDb` that is correct, because the RLS policy supplies the org
   * filter. Called on the raw pool — which is what the webhook route does —
   * `current_setting('app.org_id', true)` is NULL, the policy is false for
   * every row, and the payment that plainly exists is invisible. The handler
   * reads that as `unknown_payment` and answers 404 to the gateway.
   *
   * Once Phase 2.2 wraps the webhook, the route stops taking this path. This
   * test keeps asserting the underlying rule, so nobody re-introduces a raw
   * pool read believing it is safe.
   */
  it("cannot see a row that exists, because no app.org_id is set", async () => {
    const { dbHandle } = await import("../server/db");
    const { createSettlementStore } = await import("../server/settlement/store");
    const store = createSettlementStore(dbHandle.db);
    const found = await store.loadPayment(paymentId);
    expect(
      found,
      "the raw app pool could see a tenant row — RLS is not load-bearing in this run, " +
        "so every posture assertion here is meaningless (are you connected as the owner?)",
    ).toBeNull();
  });

  it("sees the same row from inside a tenant boundary", async () => {
    const { withTenantDb } = await import("@desiauction/db");
    const { dbHandle } = await import("../server/db");
    const { createSettlementStore } = await import("../server/settlement/store");
    const found = await withTenantDb(
      dbHandle,
      { personId: pad("01M1POSTUREPERSON"), orgId },
      async (db) => createSettlementStore(db).loadPayment(paymentId),
    );
    expect(found, "the tenant boundary could not see its own row").not.toBeNull();
    expect(found?.orgId).toBe(orgId);
  });
});

describe("POSTURE — inbound SMS: a STOP must actually suppress (PA-1 P0-2)", () => {
  /**
   * FIXED IN PA-1R PHASE 2.1, and the ratchet is how we know.
   *
   * This was written as `it.fails` on 2026-09-04, recording a real defect
   * without painting CI red: the route wrote through `systemDb`, which holds
   * SELECT on `suppressions` and nothing more, so in production every STOP
   * answered 500 and nobody was unsubscribed. When the route moved to the app
   * pool the test began passing — and `it.fails` therefore FAILED, with "Expect
   * test to fail", forcing this marker and this note to be rewritten by whoever
   * landed the fix. A known bug could not quietly become an unknown one, and
   * the fix could not quietly go unrecorded.
   *
   * It is now an ordinary assertion, and it stays: it is the only thing in the
   * repository that proves a STOP is honoured under the production roles.
   */
  it("records the suppression instead of failing on grants", async () => {
    const { POST } = await import("../app/api/webhooks/sms-inbound/route");
    const response = await POST(
      new Request("https://example.test/api/webhooks/sms-inbound", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-inbound-secret": process.env["SMS_INBOUND_SECRET"] ?? "",
        },
        body: JSON.stringify({ from: CONTACT, text: "STOP" }),
      }),
    );

    expect(response.status).toBe(200);

    // The status alone proves nothing — the point is whether the write landed.
    const rows = await owner.db
      .select({ id: suppressions.id })
      .from(suppressions)
      .where(and(eq(suppressions.contact, CONTACT), eq(suppressions.channel, "sms")));
    expect(
      rows.length,
      "STOP answered 200 but wrote no suppression row — the DPDP opt-out was lost",
    ).toBe(1);
  });
});

describe("POSTURE — delivery callbacks reach their tables (PA-1 P0-2)", () => {
  /**
   * Passes today, and is weaker than it looks — say so rather than bank it.
   *
   * A bounce for an address matching no dispatch is refused before any write,
   * so this currently proves only that the door opens, not that the write role
   * can write. Reaching `ingestDeliveryCallback`'s finops insert needs a seeded
   * dispatch, which needs an org, a series and a document.
   *
   * Phase 2.1 must strengthen this to seed that chain, or the sibling defect
   * ships unproven behind a green test — the exact failure mode this whole
   * suite exists to end.
   */
  it("accepts a bounce without a grants failure", async () => {
    const { POST } = await import("../app/api/webhooks/delivery-status/route");
    const response = await POST(
      new Request("https://example.test/api/webhooks/delivery-status", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-callback-secret": process.env["DELIVERY_CALLBACK_SECRET"] ?? "",
        },
        body: JSON.stringify({
          event: "bounce",
          email: "posture-bounce@example.test",
          messageId: "posture-delivery-0001",
        }),
      }),
    );

    // The route's own contract is that it never answers 5xx: it either accepts
    // the report or refuses it deliberately. A 500 here is the grants failure.
    expect(
      response.status,
      "delivery callback returned 5xx — the write role lacks the grant",
    ).toBeLessThan(500);
  });
});
