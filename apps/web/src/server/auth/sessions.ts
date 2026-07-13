import { createHash, randomBytes } from "node:crypto";

import { newId, people, sessions, type Db } from "@desiauction/db";
import { and, eq, gt, isNull } from "drizzle-orm";

// DB-backed revocable sessions (IP-2_DESIGN D2). The cookie carries the raw
// token; only its SHA-256 is stored. Token rotates at every login (fixation).

export const SESSION_COOKIE = "da_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
      ),
    )
    .limit(1);
  if (row === undefined) {
    return null;
  }
  if (Date.now() - row.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessions.id, row.sessionId));
  }
  return { sessionId: row.sessionId, personId: row.personId, phone: row.phone, name: row.name };
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}

/** Active sessions for the account security surface (M-IP2-2). */
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
      ),
    );
}
