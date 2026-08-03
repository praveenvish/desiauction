import { createHash, randomBytes } from "node:crypto";

import { isCapabilitySet } from "@desiauction/core";
import {
  auditLog,
  grants,
  invites,
  newId,
  organizations,
  orgMembers,
  people,
  type Db,
} from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

// Shareable-link invites (IP-2_DESIGN D9, RC-3): the platform sends nothing —
// the organizer forwards the link. Tokens are one-time, expiring, revocable,
// and stored only as hashes.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvite(
  db: Db,
  orgId: string,
  createdBy: string,
  capabilitySet: string,
): Promise<{ token: string; expiresAt: Date; reference: string }> {
  if (!isCapabilitySet(capabilitySet)) {
    throw new Error("unknown capability set");
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const inviteId = newId();
  await db.insert(invites).values({
    id: inviteId,
    orgId,
    capabilitySet,
    tokenHash: hashToken(token),
    createdBy,
    expiresAt,
  });
  await db.insert(auditLog).values({
    id: newId(),
    actor: createdBy,
    action: "invite.created",
    scopeType: "org",
    scopeId: orgId,
    subject: inviteId,
    meta: { capabilitySet },
  });
  return { token, expiresAt, reference: inviteId.slice(-6).toUpperCase() };
}

export interface InvitePreview {
  orgName: string;
  /** Where acceptance lands — shown so the invitee knows what they're joining. */
  orgSlug: string;
  capabilitySet: string;
  /** ISO. The link dies here; the invitee was never told it had a deadline. */
  expiresAt: string;
  /** Who minted it, when the product knows their name. Null = unnamed account. */
  invitedByName: string | null;
}

/**
 * The /join landing, resolved for ONE viewer.
 *
 * `invalid` is deliberately the same answer for unknown, expired, revoked and
 * already-used-by-somebody-else tokens — that byte-identity is the best
 * property this screen has and nothing here may weaken it.
 *
 * `already-member` is the ONE extra branch, and it is not a disclosure: it is
 * only ever returned when the row was accepted BY THE VIEWER THEMSELVES. They
 * already know they used this link; the product was telling them "no longer
 * valid" for the single most likely repeat interaction in the whole flow —
 * re-opening the message still sitting in their WhatsApp.
 */
export type InviteLanding =
  | { state: "valid"; preview: InvitePreview }
  | { state: "already-member"; orgName: string; orgSlug: string }
  | { state: "invalid" };

export async function inviteLanding(
  db: Db,
  personId: string,
  token: string,
): Promise<InviteLanding> {
  const [row] = await db
    .select({
      capabilitySet: invites.capabilitySet,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      acceptedBy: invites.acceptedBy,
      revokedAt: invites.revokedAt,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      createdBy: invites.createdBy,
    })
    .from(invites)
    .innerJoin(organizations, eq(organizations.id, invites.orgId))
    .where(eq(invites.tokenHash, hashToken(token)))
    .limit(1);
  if (row === undefined) {
    return { state: "invalid" };
  }
  if (row.acceptedBy === personId) {
    return { state: "already-member", orgName: row.orgName, orgSlug: row.orgSlug };
  }
  if (row.acceptedAt !== null || row.revokedAt !== null || row.expiresAt.getTime() < Date.now()) {
    return { state: "invalid" };
  }
  const [inviter] = await db
    .select({ name: people.name })
    .from(people)
    .where(eq(people.id, row.createdBy))
    .limit(1);
  return {
    state: "valid",
    preview: {
      orgName: row.orgName,
      orgSlug: row.orgSlug,
      capabilitySet: row.capabilitySet,
      expiresAt: row.expiresAt.toISOString(),
      invitedByName: inviter?.name ?? null,
    },
  };
}

/** Look up a live invite without consuming it (kept for callers that only
 *  need the shape, e.g. tests; the landing route uses `inviteLanding`). */
export async function previewInvite(db: Db, token: string): Promise<InvitePreview | null> {
  const landing = await inviteLanding(db, "", token);
  return landing.state === "valid" ? landing.preview : null;
}

export type AcceptResult = { ok: true; orgSlug: string; orgName: string } | { ok: false };

/**
 * One-time acceptance: expired, revoked, replayed and unknown tokens are all
 * indistinguishable failures. Membership + grant + audit in one step.
 */
export async function acceptInvite(db: Db, personId: string, token: string): Promise<AcceptResult> {
  const [row] = await db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, hashToken(token)))
    .limit(1);
  if (
    row === undefined ||
    row.acceptedAt !== null ||
    row.revokedAt !== null ||
    row.expiresAt.getTime() < Date.now()
  ) {
    return { ok: false };
  }
  // Claim atomically: only one accept can flip acceptedAt from NULL.
  const claimed = await db
    .update(invites)
    .set({ acceptedBy: personId, acceptedAt: new Date() })
    .where(and(eq(invites.id, row.id), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
    .returning({ id: invites.id });
  if (claimed.length === 0) {
    return { ok: false };
  }
  await db.insert(orgMembers).values({ orgId: row.orgId, personId }).onConflictDoNothing();
  await db.insert(grants).values({
    id: newId(),
    personId,
    scopeType: "org",
    scopeId: row.orgId,
    capabilitySet: row.capabilitySet,
    grantedBy: row.createdBy,
  });
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "invite.accepted",
    scopeType: "org",
    scopeId: row.orgId,
    // WHICH link did this person use? The row carried no subject at all, so the
    // trail could say somebody joined but never which of twelve outstanding
    // links they came through — the one question an audit of an invite exists
    // to answer. `acceptOwnerJoin` has always done this; this copies it.
    subject: row.id,
  });
  const [org] = await db
    .select({ slug: organizations.slug, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, row.orgId))
    .limit(1);
  return { ok: true, orgSlug: org?.slug ?? "", orgName: org?.name ?? "" };
}

/**
 * ULID → the millisecond it was minted.
 *
 * `invites` genuinely has no `created_at` column and this work adds no
 * migration — but every id in this product is a ULID (`newId()`), and a ULID's
 * first ten Crockford-base32 characters ARE its creation timestamp. So "when
 * was this link made?" was recoverable all along; twelve indistinguishable
 * pending rows were indistinguishable for want of decoding a string.
 *
 * Returns null for anything that is not a well-formed ULID rather than
 * inventing a date.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulidTimeMs(id: string): number | null {
  if (id.length !== 26) {
    return null;
  }
  let ms = 0;
  for (const char of id.slice(0, 10).toUpperCase()) {
    const digit = CROCKFORD.indexOf(char);
    if (digit < 0) {
      return null;
    }
    ms = ms * 32 + digit;
  }
  return ms;
}

export interface PendingInvite {
  id: string;
  capabilitySet: string;
  /** When the link dies on its own. */
  expiresAt: string;
  /** When it was minted — decoded from the ULID, not a column. Null if unknown. */
  createdAt: string | null;
  /** Who minted it. Twelve identical rows had no minter on them at all. */
  createdByName: string | null;
  /**
   * A short handle an organizer can match a row to a link by — the last six
   * characters of the invite's id, echoed beside the URL at mint time.
   *
   * NOT the token: only the token's SHA-256 is stored, and a link that could be
   * re-read off the screen would not be a one-time link. The brief asked for
   * the token's last four; that is not recoverable by design, and this is the
   * strongest identity the stored row can honestly carry.
   */
  reference: string;
}

/**
 * Links that have been minted and not yet used.
 *
 * `revokeInvite` has existed since IP-2 with no caller and no surface: an
 * organizer who forwarded a link to the wrong number could see neither that it
 * was outstanding nor any way to kill it, and it stayed live for seven days.
 * The token itself is never returned — only its hash is stored, and a link that
 * could be re-read from the screen would not be one-time.
 */
export async function pendingInvitesOf(db: Db, orgId: string): Promise<PendingInvite[]> {
  const rows = await db
    .select({
      id: invites.id,
      capabilitySet: invites.capabilitySet,
      expiresAt: invites.expiresAt,
      createdByName: people.name,
    })
    .from(invites)
    .leftJoin(people, eq(people.id, invites.createdBy))
    .where(and(eq(invites.orgId, orgId), isNull(invites.acceptedAt), isNull(invites.revokedAt)));
  return rows
    .filter((row) => row.expiresAt.getTime() >= Date.now())
    .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())
    .map((row) => {
      const mintedMs = ulidTimeMs(row.id);
      return {
        id: row.id,
        capabilitySet: row.capabilitySet,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: mintedMs === null ? null : new Date(mintedMs).toISOString(),
        createdByName: row.createdByName,
        reference: row.id.slice(-6).toUpperCase(),
      };
    });
}

export async function revokeInvite(
  db: Db,
  orgId: string,
  inviteId: string,
  revokedBy: string,
): Promise<void> {
  await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.id, inviteId), eq(invites.orgId, orgId)));
  await db.insert(auditLog).values({
    id: newId(),
    actor: revokedBy,
    action: "invite.revoked",
    scopeType: "org",
    scopeId: orgId,
    subject: inviteId,
  });
}
