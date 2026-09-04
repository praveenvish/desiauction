import { createHash, randomBytes } from "node:crypto";

import { newId, people, sessions, type Db } from "@desiauction/db";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";

// DB-backed revocable sessions (IP-2_DESIGN D2). The cookie carries the raw
// token; only its SHA-256 is stored. Token rotates at every login (fixation).

export const SESSION_COOKIE = "da_session";

/**
 * "This device has signed in before" — nothing else. No id, no phone, no
 * session material; it survives sign-out on purpose, because that is the whole
 * point: a returning visitor's fastest route is the passkey they already
 * enrolled, and the gate had no way to know to offer it first. Read only by
 * /login, to decide which door leads. It lives beside SESSION_COOKIE rather
 * than in actions.ts, which is a "use server" module and may export nothing but
 * async server actions.
 */
export const RETURNING_COOKIE = "da_returning";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The ceiling the sliding window never had.
 *
 * `expiresAt` slides forward on every visit, so a handset opened once a month
 * held a session that was thirty days from expiry FOREVER — a token minted in
 * year one still authenticating in year three, on a phone long since sold,
 * lost, or handed to somebody else. The sliding window answers "is this device
 * still in use"; nothing answered "how long may one authentication stand". This
 * is that second question, measured from `created_at` and immune to renewal:
 * ninety days after a person proved who they were, they prove it again.
 *
 * No migration and no forced sign-out: `created_at` is already on every row, so
 * live sessions simply inherit their real age. Only the ones already older than
 * the ceiling — the ones this exists to end — stop working.
 */
const SESSION_MAX_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The oldest `created_at` that may still authenticate. Expressed as a floor in
 * the WHERE rather than a check after the read, so every surface that filters
 * on it — the token lookup AND the device list — refuses the same rows. A
 * session the account page still offered to "sign out" but which no longer
 * opened anything was a lie about state.
 */
function lifetimeFloor(): Date {
  return new Date(Date.now() - SESSION_MAX_LIFETIME_MS);
}

export async function createSession(
  db: Db,
  personId: string,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: newId(),
    personId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent,
  });
  return { token, expiresAt };
}

export interface SessionInfo {
  sessionId: string;
  personId: string;
  phone: string;
  name: string | null;
}

export async function getSessionByToken(db: Db, token: string): Promise<SessionInfo | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      personId: sessions.personId,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      phone: people.phone,
      name: people.name,
    })
    .from(sessions)
    .innerJoin(people, eq(people.id, sessions.personId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        gt(sessions.createdAt, lifetimeFloor()),
      ),
    )
    .limit(1);
  if (row === undefined) {
    return null;
  }
  if (Date.now() - row.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
    // The slide may not push past the ceiling. Without the clamp `expiresAt`
    // would keep advertising thirty more days on a session the WHERE above has
    // already stopped honouring, which reads as a bug in whichever surface
    // shows the date.
    const ceiling = row.createdAt.getTime() + SESSION_MAX_LIFETIME_MS;
    const slid = Math.min(Date.now() + SESSION_TTL_MS, ceiling);
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(slid) })
      .where(eq(sessions.id, row.sessionId));
  }
  return { sessionId: row.sessionId, personId: row.personId, phone: row.phone, name: row.name };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

/**
 * Revoke whatever session a raw cookie token names, if it names a live one.
 *
 * Used when a NEW session replaces an old one on the same device (audit
 * PA-1 §25): the cookie was simply overwritten, leaving the previous token
 * valid in the database for up to thirty days. Silent when the token matches
 * nothing — an expired or already-revoked cookie is the normal case, not an
 * error worth surfacing on a sign-in.
 */
export async function revokeSessionByToken(db: Db, token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}

/**
 * Active sessions for the account security surface (M-IP2-2).
 *
 * ORDERED, because this list is read by a human being deciding which row to
 * kill. Without an ORDER BY Postgres returned them in whatever order the heap
 * happened to hold — measured at 142 rows on one real account, all bearing the
 * same user agent, with "This device" 7,252px down the page. Newest-first is
 * the only order in which "sign out anything you don't recognize" is a
 * followable instruction; the caller pins the current device above it.
 */
export async function listSessions(db: Db, personId: string): Promise<SessionSummary[]> {
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.personId, personId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        gt(sessions.createdAt, lifetimeFloor()),
      ),
    )
    .orderBy(desc(sessions.lastSeenAt), desc(sessions.createdAt));
}

/**
 * "Sign out everywhere else" — every live session for this person except the
 * one making the request. Person-scoped by construction: the WHERE names the
 * personId, so this can never reach another account's rows, and the surviving
 * session is named explicitly rather than inferred.
 *
 * Returns how many were killed so the surface can say something true.
 */
export async function revokeOtherSessions(
  db: Db,
  personId: string,
  keepSessionId: string,
): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.personId, personId),
        ne(sessions.id, keepSessionId),
        isNull(sessions.revokedAt),
      ),
    )
    .returning({ id: sessions.id });
  return revoked.length;
}
