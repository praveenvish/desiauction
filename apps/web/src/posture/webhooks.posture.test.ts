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

  const caseId = pad("01M1POSTURECASE");
  beforeAll(async () => {
    await owner.sql`delete from payments where id = ${paymentId}`;
    await owner.sql`delete from settlement_cases where id = ${caseId}`;
    // `payments.case_id` gained a foreign key in migration 0043 — a payment
    // whose case does not exist is a number nobody can explain, so the fixture
    // creates the case rather than naming one that was never there.
    await owner.sql`
      insert into settlement_cases (id, org_id, auction_id, competition_id, basis,
                                    source_event_count, source_digest, created_by)
      values (${caseId}, ${orgId}, ${pad("01M1POSTUREAUC")}, ${pad("01M1POSTURECOMP")},
              'committed', 0, 'posture', ${pad("01M1POSTUREBY")})
    `;
    await owner.sql`
      insert into payments (id, org_id, case_id, team_id, method, amount)
      values (${paymentId}, ${orgId}, ${pad("01M1POSTURECASE")},
              ${pad("01M1POSTURETEAM")}, ${"manual:cash"}, ${50000})
    `;
  });
  afterAll(async () => {
    await owner.sql`delete from payments where id = ${paymentId}`;
    await owner.sql`delete from settlement_cases where id = ${caseId}`;
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
   * THE PROOF THIS TEST DID NOT USED TO CARRY.
   *
   * Its first version posted a bounce for an address matching no dispatch and
   * asserted only that the response was not a 5xx. That passed for the wrong
   * reason: `parseEmailCallback` requires the provider reference to be
   * `email:{dispatchId}`, and the payload carried a bare id — so the callback
   * was refused as unparseable before a single row was touched, and a route
   * that could not write would have looked exactly as healthy.
   *
   * Which is the failure mode this whole suite exists to end, sitting inside
   * the suite. So the chain is seeded for real: a `DispatchRequested` event and
   * its projection, then a genuine bounce for that dispatch. Reaching
   * `DispatchFailed` means the app role appended to `finops_events` from inside
   * the tenant boundary the route opens — the two things PA-1 §10 P0-2 found
   * broken, asserted rather than assumed.
   */
  const pad = (label: string): string => label.padEnd(26, "0");
  const dispatchOrg = pad("01M1POSTUREDLVORG");
  const dispatchId = pad("01M1POSTUREDLVDSP");
  const eventId = pad("01M1POSTUREDLVEVT");

  beforeAll(async () => {
    await owner.sql`delete from finops_events where org_id = ${dispatchOrg}`;
    await owner.sql`delete from finops_dispatches where id = ${dispatchId}`;
    // seq 1 must be DispatchRequested, and its payload dispatchId must equal
    // the stream id — the reducer refuses `malformed_dispatch` otherwise.
    await owner.sql`
      insert into finops_events
        (id, org_id, stream_type, stream_id, seq, type, payload, at_ms, actor, command_id, correlation_id)
      values (${eventId}, ${dispatchOrg}, 'dispatch', ${dispatchId}, 1, 'DispatchRequested',
        ${JSON.stringify({
          dispatchId,
          orgId: dispatchOrg,
          channel: "email",
          recipientRef: "owner:posture-team",
          templateId: "document.issued",
          templateVersion: "1",
          subjectRef: pad("01M1POSTUREDLVDOC"),
        })}::jsonb,
        1, ${pad("01M1POSTUREDLVACT")}, ${pad("01M1POSTUREDLVCMD")}, ${pad("01M1POSTUREDLVCOR")})
    `;
    await owner.sql`
      insert into finops_dispatches
        (id, org_id, status, channel, recipient_ref, template_id, template_version, subject_ref, requested_by)
      values (${dispatchId}, ${dispatchOrg}, 'requested', 'email', 'owner:posture-team',
        'document.issued', '1', ${pad("01M1POSTUREDLVDOC")}, ${pad("01M1POSTUREDLVACT")})
    `;
  });

  afterAll(async () => {
    await owner.sql`delete from finops_events where org_id = ${dispatchOrg}`;
    await owner.sql`delete from finops_dispatches where id = ${dispatchId}`;
  });

  it("writes DispatchFailed for a real bounce, under the app role", async () => {
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
          // The reference the adapter actually reads — `email:` prefixed, or the
          // callback is unparseable and nothing below is exercised.
          messageId: `email:${dispatchId}`,
          eventId: "posture-provider-event-1",
          recipient: "posture-bounce@example.test",
        }),
      }),
    );
    expect(response.status).toBeLessThan(500);

    const events = (await owner.sql`
      select type from finops_events
       where stream_id = ${dispatchId} and type = 'DispatchFailed'
    `) as unknown as { type: string }[];
    expect(
      events.length,
      "the bounce did not append DispatchFailed — the delivery callback cannot " +
        "write finops truth under the production roles, so a bounced document " +
        "stays 'requested' for ever and the sending domain keeps being used",
    ).toBe(1);
  });

  it("is idempotent — the provider retrying does not append twice", async () => {
    const { POST } = await import("../app/api/webhooks/delivery-status/route");
    const body = JSON.stringify({
      event: "bounce",
      messageId: `email:${dispatchId}`,
      eventId: "posture-provider-event-1",
      recipient: "posture-bounce@example.test",
    });
    const send = async (): Promise<void> => {
      await POST(
        new Request("https://example.test/api/webhooks/delivery-status", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-callback-secret": process.env["DELIVERY_CALLBACK_SECRET"] ?? "",
          },
          body,
        }),
      );
    };
    await send();
    await send();

    const events = (await owner.sql`
      select type from finops_events
       where stream_id = ${dispatchId} and type = 'DispatchFailed'
    `) as unknown as { type: string }[];
    expect(events.length, "a retried provider callback appended a second event").toBe(1);
  });
});
