import { createHmac, timingSafeEqual } from "node:crypto";

import { newId, newsletterSubscribers, type Db } from "@desiauction/db";
import { and, count, desc, eq, gt, isNotNull, lt } from "drizzle-orm";

import { env } from "../../env";

/**
 * THE NEWSLETTER LIST — collected honestly, kept for a stated time, removable.
 *
 * The footer asks for an address "for product news". Nothing sends yet, so the
 * least this list owes the people on it is what every other personal datum on
 * this platform already has: a limit on who can fill it, a retention period that
 * is enforced rather than written down, a way off it, and an owner who can see
 * it. Platform-level and tenant-free (no org column, no RLS), so these functions
 * take the app pool from their callers, as the rest of `server/marketing` does.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The same ceiling the in-memory bucket enforced, now counted in the table. */
export const SUBSCRIBE_MAX_PER_IP_PER_HOUR = 5;
/** Consistent with demo requests: kept twenty-four months, then deleted. */
export const SUBSCRIBER_RETENTION_MS = 24 * 30 * DAY_MS;
/** The network address exists only for the throttle; it goes after ninety days. */
export const SUBSCRIBER_IP_RETENTION_MS = 90 * DAY_MS;

/**
 * Has this address already signed up enough in the last hour?
 *
 * Counted in the table, like `requestOtp` and `isThrottled` — so a restart does
 * not forget and a second instance is not a second allowance. An unknown address
 * (no proxy header) is not throttled, matching those two.
 */
export async function isSubscribeThrottled(
  db: Db,
  requestIp: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  if (requestIp === null) {
    return false;
  }
  const [row] = await db
    .select({ n: count() })
    .from(newsletterSubscribers)
    .where(
      and(
        eq(newsletterSubscribers.requestIp, requestIp),
        gt(newsletterSubscribers.createdAt, new Date(now.getTime() - HOUR_MS)),
      ),
    );
  return (row?.n ?? 0) >= SUBSCRIBE_MAX_PER_IP_PER_HOUR;
}

/** Idempotent on the address: signing up twice is being subscribed once. */
export async function subscribe(db: Db, email: string, requestIp: string | null): Promise<void> {
  await db
    .insert(newsletterSubscribers)
    .values({ id: newId(), email: email.trim().toLowerCase(), requestIp })
    .onConflictDoNothing({ target: newsletterSubscribers.email });
}

/**
 * THE LINK EVERY NEWSLETTER MUST CARRY (gate P3).
 *
 * Nothing sends to this list yet. When something does, each mail carries a
 * link that removes exactly its own recipient and nobody else: the address
 * plus an HMAC of it, under the marketing key in its own namespace (the demo
 * pick handle's shape, demo-booking.ts), so no other token of ours can stand in
 * for it and it cannot be forged for an address you do not receive mail at.
 * Derived, not stored, for the demo key's reason — a leaked backup holds no
 * working links.
 *
 * The page also still takes a TYPED address, and that is deliberate. The list
 * is single opt-in: anybody can type anybody's address into the footer to JOIN
 * it, so demanding proof of the mailbox to LEAVE would make leaving harder
 * than joining — backwards for consent, and the DPDP Act asks withdrawal to be
 * as easy as giving it. The worst a typed removal can do is take somebody off
 * a list that has never sent them anything, which they can undo in one step.
 * The token is for the mail, where one click has to be enough.
 */
export function unsubscribeToken(email: string): string {
  return createHmac("sha256", env.DEMO_TOKEN_SECRET)
    .update(`newsletter-unsubscribe:${email.trim().toLowerCase()}`)
    .digest("base64url")
    .slice(0, 22);
}

/** Does this token belong to this address? Constant-time; anything malformed is no. */
export function unsubscribeTokenMatches(email: unknown, token: unknown): boolean {
  if (typeof email !== "string" || typeof token !== "string" || email.trim() === "") {
    return false;
  }
  const expected = Buffer.from(unsubscribeToken(email));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The one-click removal link for a newsletter mail's footer (and its List-Unsubscribe header). */
export function unsubscribeUrl(email: string): string {
  const address = email.trim().toLowerCase();
  const query = new URLSearchParams({ address, token: unsubscribeToken(address) });
  return `${env.PUBLIC_BASE_URL}/newsletter/unsubscribe?${query.toString()}`;
}

/** Remove an address. Says nothing about whether it was there. */
export async function unsubscribe(db: Db, email: string): Promise<void> {
  await db
    .delete(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email.trim().toLowerCase()));
}

export interface NewsletterPurge {
  readonly subscribersDeleted: number;
  readonly addressesCleared: number;
}

/** The retention the data-retention policy states, enforced. Idempotent. */
export async function purgeExpiredNewsletter(
  db: Db,
  now: Date = new Date(),
): Promise<NewsletterPurge> {
  const deleted = await db
    .delete(newsletterSubscribers)
    .where(lt(newsletterSubscribers.createdAt, new Date(now.getTime() - SUBSCRIBER_RETENTION_MS)))
    .returning({ id: newsletterSubscribers.id });
  const cleared = await db
    .update(newsletterSubscribers)
    .set({ requestIp: null })
    .where(
      and(
        isNotNull(newsletterSubscribers.requestIp),
        lt(newsletterSubscribers.createdAt, new Date(now.getTime() - SUBSCRIBER_IP_RETENTION_MS)),
      ),
    )
    .returning({ id: newsletterSubscribers.id });
  return { subscribersDeleted: deleted.length, addressesCleared: cleared.length };
}

export interface NewsletterSummary {
  readonly total: number;
  readonly lastThirtyDays: number;
}

export async function newsletterSummary(
  db: Db,
  now: Date = new Date(),
): Promise<NewsletterSummary> {
  const [all] = await db.select({ n: count() }).from(newsletterSubscribers);
  const [recent] = await db
    .select({ n: count() })
    .from(newsletterSubscribers)
    .where(gt(newsletterSubscribers.createdAt, new Date(now.getTime() - 30 * DAY_MS)));
  return { total: all?.n ?? 0, lastThirtyDays: recent?.n ?? 0 };
}

/** Every address and when it arrived, newest first — for the export. */
export async function newsletterAddresses(db: Db): Promise<{ email: string; createdAt: Date }[]> {
  return db
    .select({ email: newsletterSubscribers.email, createdAt: newsletterSubscribers.createdAt })
    .from(newsletterSubscribers)
    .orderBy(desc(newsletterSubscribers.createdAt));
}
