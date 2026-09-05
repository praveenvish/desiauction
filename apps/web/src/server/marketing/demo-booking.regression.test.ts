import {
  createDb,
  demoAvailability,
  demoBlackouts,
  demoBookings,
  demoRequests,
  newId,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { hashToken, tokenForRequest } from "./demo-booking";
import { isThrottled, recordDemoRequest, type ValidDemoRequest } from "./demo-requests";
import { purgeExpiredDemoData } from "./demo-retention";

/**
 * DEMO-1 against a real database.
 *
 * Four properties live here because only Postgres can prove them, and each one
 * is a thing that would fail silently if it were merely written down:
 *
 *   1 · `demo_requests` has NO row level security, deliberately. Every other
 *       tenant table does, so an exception nobody asserted would be
 *       indistinguishable from an exception somebody forgot.
 *   2 · Two people cannot hold the same slot. The partial unique index is the
 *       guard; a check-then-insert would let both through under load.
 *   3 · A cancelled booking returns its slot to the pool AND surrenders its
 *       token, so the same person can book again without colliding with their
 *       own retired row.
 *   4 · The retention promise printed in `/legal/data-retention` is enforced by
 *       code that actually deletes rows.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const MARK = "DEMO1-REGRESSION";
const created: string[] = [];

function request(overrides: Partial<ValidDemoRequest> = {}): ValidDemoRequest {
  return {
    name: `${MARK} Ravi`,
    phone: `+9199${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`,
    email: null,
    orgName: `${MARK} Warriors`,
    sport: "cricket",
    tournamentSize: "8-16",
    auctionOn: null,
    preferredWindow: "any",
    note: null,
    source: "schedule-demo",
    requestIp: null,
    ...overrides,
  };
}

async function newRequest(overrides: Partial<ValidDemoRequest> = {}): Promise<string> {
  const id = await recordDemoRequest(db, request(overrides));
  created.push(id);
  return id;
}

/** A concrete instant that no other test in this file competes for. */
function slotAt(minutesFromNow: number): { start: Date; end: Date } {
  const start = new Date(Date.now() + minutesFromNow * 60_000);
  start.setUTCSeconds(0, 0);
  return { start, end: new Date(start.getTime() + 30 * 60_000) };
}

beforeAll(async () => {
  // Residue from an interrupted run looks exactly like a platform bug here —
  // unique violations on rows this file thinks it is creating fresh.
  await db.delete(demoRequests).where(like(demoRequests.orgName, `%${MARK}%`));
});

afterAll(async () => {
  if (created.length > 0) {
    // Bookings cascade with their request (0032's FK).
    await db.delete(demoRequests).where(inArray(demoRequests.id, created));
  }
  await db.delete(demoRequests).where(like(demoRequests.orgName, `%${MARK}%`));
  await db.delete(demoAvailability).where(like(demoAvailability.createdBy, `${MARK}%`));
  await db.delete(demoBlackouts).where(like(demoBlackouts.createdBy, `${MARK}%`));
  await handle.sql.end({ timeout: 5 });
});

describe("DEMO-1 · the no-RLS decision is deliberate, and asserted", () => {
  it("demo_requests and the scheduling tables carry no policies", async () => {
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(
      sql`select relname, relrowsecurity from pg_class
          where relname in ('demo_requests', 'demo_availability', 'demo_blackouts', 'demo_bookings')`,
    );
    expect(rows.length).toBe(4);
    for (const row of rows) {
      // If somebody "fixes" this by enabling RLS, the public form stops working
      // for a stranger who has no tenant — and it fails here first.
      expect(row.relrowsecurity, `${row.relname} must stay RLS-free`).toBe(false);
    }
  });

  it("the answered-together CHECK refuses an outcome nobody gave", async () => {
    const id = await newRequest();
    await expect(
      db.update(demoRequests).set({ outcome: "showed" }).where(eq(demoRequests.id, id)),
    ).rejects.toThrow();
  });
});

describe("DEMO-1 · one live booking per instant", () => {
  it("the partial unique index refuses the second holder of a slot", async () => {
    const first = await newRequest();
    const second = await newRequest();
    const { start, end } = slotAt(600);

    await db.insert(demoBookings).values({
      id: newId(),
      demoRequestId: first,
      slotStart: start,
      slotEnd: end,
      tokenHash: hashToken(tokenForRequest(first)),
      confirmedAt: new Date(),
    });

    await expect(
      db.insert(demoBookings).values({
        id: newId(),
        demoRequestId: second,
        slotStart: start,
        slotEnd: end,
        tokenHash: hashToken(tokenForRequest(second)),
        confirmedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("a cancelled booking hands the slot back", async () => {
    const first = await newRequest();
    const second = await newRequest();
    const { start, end } = slotAt(700);
    const firstBooking = newId();

    await db.insert(demoBookings).values({
      id: firstBooking,
      demoRequestId: first,
      slotStart: start,
      slotEnd: end,
      tokenHash: hashToken(tokenForRequest(first)),
      confirmedAt: new Date(),
    });
    await db
      .update(demoBookings)
      .set({ cancelledAt: new Date(), cancelledBy: "requester" })
      .where(eq(demoBookings.id, firstBooking));

    // The index only covers live rows, so the slot is genuinely free again.
    await expect(
      db.insert(demoBookings).values({
        id: newId(),
        demoRequestId: second,
        slotStart: start,
        slotEnd: end,
        tokenHash: hashToken(tokenForRequest(second)),
        confirmedAt: new Date(),
      }),
    ).resolves.not.toThrow();
  });

  it("a cancellation must name who did it", async () => {
    const id = await newRequest();
    const { start, end } = slotAt(800);
    const bookingId = newId();
    await db.insert(demoBookings).values({
      id: bookingId,
      demoRequestId: id,
      slotStart: start,
      slotEnd: end,
      tokenHash: hashToken(tokenForRequest(id)),
    });
    await expect(
      db
        .update(demoBookings)
        .set({ cancelledAt: new Date() })
        .where(eq(demoBookings.id, bookingId)),
    ).rejects.toThrow();
  });
});

describe("DEMO-1 · the token is derived, not drawn", () => {
  it("reproduces the same link for the same request, and a different one otherwise", () => {
    const a = tokenForRequest("01JABCDEFGHJKMNPQRSTVWXYZ0");
    expect(tokenForRequest("01JABCDEFGHJKMNPQRSTVWXYZ0")).toBe(a);
    expect(tokenForRequest("01JABCDEFGHJKMNPQRSTVWXYZ1")).not.toBe(a);
    // Long enough that guessing is not a strategy.
    expect(a.length).toBe(32);
  });

  it("never stores the token itself", async () => {
    const id = await newRequest();
    const token = tokenForRequest(id);
    const { start, end } = slotAt(900);
    await db.insert(demoBookings).values({
      id: newId(),
      demoRequestId: id,
      slotStart: start,
      slotEnd: end,
      tokenHash: hashToken(token),
    });
    const [row] = await db
      .select({ tokenHash: demoBookings.tokenHash })
      .from(demoBookings)
      .where(eq(demoBookings.demoRequestId, id));
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.tokenHash).toBe(hashToken(token));
  });
});

describe("DEMO-1 · the throttle", () => {
  it("refuses a fourth request from one phone inside a day, and nothing before it", async () => {
    const phone = `+9199${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await isThrottled(db, phone, null)).toBe(false);
      created.push(await recordDemoRequest(db, request({ phone })));
    }
    expect(await isThrottled(db, phone, null)).toBe(true);
  });

  it("counts a connection separately from a number", async () => {
    const ip = `198.51.100.${String(Math.floor(Math.random() * 200) + 1)}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      created.push(await recordDemoRequest(db, request({ requestIp: ip })));
    }
    // A fresh phone on a burnt connection is still refused.
    expect(await isThrottled(db, "+919000000001", ip)).toBe(true);
    expect(await isThrottled(db, "+919000000001", "198.51.100.254")).toBe(false);
  });
});

describe("DEMO-1 · the retention promise is enforced, not just printed", () => {
  it("deletes a request past twenty-four months and clears an address past ninety days", async () => {
    const old = await newRequest({ requestIp: "203.0.113.9" });
    const middling = await newRequest({ requestIp: "203.0.113.10" });

    await db
      .update(demoRequests)
      .set({ createdAt: new Date(Date.now() - 800 * 24 * 60 * 60 * 1000) })
      .where(eq(demoRequests.id, old));
    await db
      .update(demoRequests)
      .set({ createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000) })
      .where(eq(demoRequests.id, middling));

    await purgeExpiredDemoData();

    const survivors = await db
      .select({ id: demoRequests.id, requestIp: demoRequests.requestIp })
      .from(demoRequests)
      .where(inArray(demoRequests.id, [old, middling]));

    expect(survivors.map((row) => row.id)).toEqual([middling]);
    // Still inside its own window, so the request stays — but the address it
    // arrived from has served its only purpose and is gone.
    expect(survivors[0]?.requestIp).toBeNull();
  });
});
