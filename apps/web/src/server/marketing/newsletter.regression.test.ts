/**
 * The product-news list: limited per network address in the table (not in
 * process memory), deleted on the schedule the retention policy states, and
 * removable by whoever holds the address.
 */
import { createDb, newsletterSubscribers, newsletterUnsubscribes } from "@desiauction/db";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import {
  SUBSCRIBE_MAX_PER_IP_PER_HOUR,
  SUBSCRIBER_IP_RETENTION_MS,
  SUBSCRIBER_RETENTION_MS,
  UNSUBSCRIBE_MAX_PER_IP_PER_HOUR,
  isSubscribeThrottled,
  isUnsubscribeThrottled,
  purgeExpiredNewsletter,
  recordTypedUnsubscribe,
  subscribe,
  unsubscribe,
  unsubscribeTokenMatches,
  unsubscribeUrl,
} from "./newsletter";

const handle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-8);
const address = (n: number): string => `news.${RUN}.${String(n)}@example.test`;
// An address from the documentation range, never a real client.
const IP = `192.0.2.${String(Number(RUN.slice(-2)) % 250)}`;
// Its own address for the removal limit, so the two ceilings never share rows.
const UNSUB_IP = `198.51.100.${String(Number(RUN.slice(-2)) % 250)}`;

afterAll(async () => {
  await db.delete(newsletterSubscribers).where(like(newsletterSubscribers.email, `news.${RUN}.%`));
  await db.delete(newsletterUnsubscribes).where(eq(newsletterUnsubscribes.requestIp, UNSUB_IP));
  await handle.sql.end();
});

describe("NEWSLETTER — limited, retained, removable", () => {
  it("counts sign-ups per address in the table, and stops at the ceiling", async () => {
    for (let i = 0; i < SUBSCRIBE_MAX_PER_IP_PER_HOUR; i++) {
      expect(await isSubscribeThrottled(db, IP)).toBe(false);
      await subscribe(db, address(i), IP);
    }
    // The limit survives anything a process restart would forget: it is rows.
    expect(await isSubscribeThrottled(db, IP)).toBe(true);
    // A caller behind no proxy header is not throttled, as with OTP and demos.
    expect(await isSubscribeThrottled(db, null)).toBe(false);
  });

  it("is idempotent on the address, whatever its case", async () => {
    await subscribe(db, address(100).toUpperCase(), null);
    await subscribe(db, address(100), null);
    const rows = await db
      .select({ email: newsletterSubscribers.email })
      .from(newsletterSubscribers)
      .where(inArray(newsletterSubscribers.email, [address(100)]));
    expect(rows).toHaveLength(1);
  });

  it("removes an address on request, and says nothing either way", async () => {
    await subscribe(db, address(200), null);
    await unsubscribe(db, ` ${address(200).toUpperCase()} `);
    // An address that was never there is not an error.
    await expect(unsubscribe(db, address(201))).resolves.toBeUndefined();
    const rows = await db
      .select({ email: newsletterSubscribers.email })
      .from(newsletterSubscribers)
      .where(inArray(newsletterSubscribers.email, [address(200)]));
    expect(rows).toHaveLength(0);
  });

  it("limits TYPED removals per address like sign-ups, storing no email (gate leftover)", async () => {
    for (let i = 0; i < UNSUBSCRIBE_MAX_PER_IP_PER_HOUR; i++) {
      expect(await isUnsubscribeThrottled(db, UNSUB_IP)).toBe(false);
      await recordTypedUnsubscribe(db, UNSUB_IP);
    }
    expect(await isUnsubscribeThrottled(db, UNSUB_IP)).toBe(true);
    // No known address, nothing to count by — same as joining.
    expect(await isUnsubscribeThrottled(db, null)).toBe(false);
    // The row is an address and a time; there is no column an email could sit in.
    const [row] = await handle.sql<Record<string, unknown>[]>`
      select * from newsletter_unsubscribes where request_ip = ${UNSUB_IP} limit 1`;
    expect(Object.keys(row ?? {}).sort()).toEqual(["created_at", "id", "request_ip"]);
    // And the retention sweep takes them at ninety days.
    await handle.sql`update newsletter_unsubscribes
      set created_at = ${new Date(Date.now() - SUBSCRIBER_IP_RETENTION_MS - 60_000).toISOString()}
      where request_ip = ${UNSUB_IP}`;
    const purged = await purgeExpiredNewsletter(db);
    expect(purged.unsubscribeRowsDeleted).toBeGreaterThanOrEqual(UNSUBSCRIBE_MAX_PER_IP_PER_HOUR);
    expect(await isUnsubscribeThrottled(db, UNSUB_IP)).toBe(false);
  });

  it("deletes addresses past twenty-four months and clears network addresses past ninety days", async () => {
    await subscribe(db, address(300), IP);
    await subscribe(db, address(301), IP);
    const now = Date.now();
    await handle.sql`update newsletter_subscribers
      set created_at = ${new Date(now - SUBSCRIBER_RETENTION_MS - 60_000).toISOString()}
      where email = ${address(300)}`;
    await handle.sql`update newsletter_subscribers
      set created_at = ${new Date(now - SUBSCRIBER_IP_RETENTION_MS - 60_000).toISOString()}
      where email = ${address(301)}`;

    const purged = await purgeExpiredNewsletter(db, new Date(now));
    expect(purged.subscribersDeleted).toBeGreaterThanOrEqual(1);
    expect(purged.addressesCleared).toBeGreaterThanOrEqual(1);

    const left = await handle.sql<{ email: string; request_ip: string | null }[]>`
      select email, request_ip from newsletter_subscribers
      where email in (${address(300)}, ${address(301)})`;
    expect(left).toEqual([{ email: address(301), request_ip: null }]);
    // And a second run finds nothing left to do.
    const again = await purgeExpiredNewsletter(db, new Date(now));
    expect(again.addressesCleared).toBe(0);
  });
});

describe("NEWSLETTER — the link a mail carries (gate P3)", () => {
  it("names one address and cannot be moved to another", () => {
    const url = new URL(unsubscribeUrl(` ${address(300).toUpperCase()} `));
    expect(url.pathname).toBe("/newsletter/unsubscribe");
    const token = url.searchParams.get("token");
    expect(url.searchParams.get("address")).toBe(address(300));
    expect(unsubscribeTokenMatches(address(300), token)).toBe(true);
    expect(unsubscribeTokenMatches(address(301), token)).toBe(false);
    expect(unsubscribeTokenMatches(address(300), `${token ?? ""}x`)).toBe(false);
    expect(unsubscribeTokenMatches(address(300), null)).toBe(false);
  });
});
