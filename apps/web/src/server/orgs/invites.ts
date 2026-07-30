import { createHash, randomBytes } from "node:crypto";

import { isCapabilitySet } from "@desiauction/core";
import {
  auditLog,
  grants,
  invites,
  newId,
  organizations,
  orgMembers,
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
): Promise<{ token: string; expiresAt: Date }> {
  if (!isCapabilitySet(capabilitySet)) {
    throw new Error("unknown capability set");
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.insert(invites).values({
    id: newId(),
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
    meta: { capabilitySet },
  });
  return { token, expiresAt };
}

export interface InvitePreview {
  orgName: string;
  capabilitySet: string;
}

/** Look up a live invite without consuming it (the /join landing view). */
export async function previewInvite(db: Db, token: string): Promise<InvitePreview | null> {
  const [row] = await db
    .select({
      capabilitySet: invites.capabilitySet,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      revokedAt: invites.revokedAt,
      orgName: organizations.name,
    })
    .from(invites)
    .innerJoin(organizations, eq(organizations.id, invites.orgId))
    .where(eq(invites.tokenHash, hashToken(token)))
    .limit(1);
  if (
    row === undefined ||
    row.acceptedAt !== null ||
    row.revokedAt !== null ||
    row.expiresAt.getTime() < Date.now()
  ) {
    return null;
  }
  return { orgName: row.orgName, capabilitySet: row.capabilitySet };
}

export type AcceptResult = { ok: true; orgSlug: string } | { ok: false };

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
  });
  const [org] = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, row.orgId))
    .limit(1);
  return { ok: true, orgSlug: org?.slug ?? "" };
}

export interface PendingInvite {
  id: string;
  capabilitySet: string;
  /** When the link dies on its own. `invites` records no creation time and this
   * work adds no column, so expiry is the only honest date to show. */
  expiresAt: string;
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
    })
    .from(invites)
    .where(and(eq(invites.orgId, orgId), isNull(invites.acceptedAt), isNull(invites.revokedAt)));
  return rows
    .filter((row) => row.expiresAt.getTime() >= Date.now())
    .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())
    .map((row) => ({
      id: row.id,
      capabilitySet: row.capabilitySet,
      expiresAt: row.expiresAt.toISOString(),
    }));
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
  });
}
