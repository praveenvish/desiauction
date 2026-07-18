"use server";

import { createHash, randomBytes } from "node:crypto";

import {
  auctionOwnerInvites,
  auctions,
  auditLog,
  competitions,
  newId,
  orgMembers,
  teams,
} from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

import { currentSession } from "../auth/actions";
import { systemDb } from "../db";
import { sendEngineCommand } from "./engine-client";
import { liveGate } from "./live-actions";

// The owner invitation workflow (M-IP4-3). Tokens follow the IP-2 invite
// discipline: one-time, expiring, stored only as hashes, and the platform
// sends nothing — the organizer forwards the link. PRP-1 §1: the token
// lookups are the documented pre-tenant reads (the token is the capability)
// and run on the system pool, exactly like org invites. The auction-side state
// (invite row + OwnerInvited/OwnerAccepted events) mutates ONLY through
// engine commands; the identity-side membership insert is the one
// identity-domain step, audited separately.

const OWNER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type InviteOwnerActionResult =
  { ok: true; joinPath: string; teamId: string } | { ok: false; error: string };

/** Mint an owner invitation for a team; returns the join path to forward. */
export async function inviteOwnerAction(
  slug: string,
  teamId: string,
): Promise<InviteOwnerActionResult> {
  const gate = await liveGate(slug);
  if (gate === null || !gate.canConduct) {
    return { ok: false, error: "You can't conduct auctions here." };
  }
  const token = randomBytes(24).toString("base64url");
  const ack = await sendEngineCommand({
    auctionId: gate.auction.id,
    type: "InviteOwner",
    actor: gate.personId,
    conduct: true,
    payload: {
      teamId,
      tokenHash: hashToken(token),
      expiresAtMs: Date.now() + OWNER_INVITE_TTL_MS,
    },
  });
  if (!ack.accepted) {
    const message: Record<string, string> = {
      terminal_auction: "This auction has ended.",
      unknown_team: "Pick a team from this competition.",
      engine_unreachable: "The auction engine is offline.",
    };
    return { ok: false, error: message[ack.reason ?? ""] ?? "Refused." };
  }
  return { ok: true, joinPath: `/owner-join/${token}`, teamId };
}

export interface OwnerJoinPreview {
  auctionName: string;
  teamName: string;
  competitionName: string;
  competitionSlug: string;
}

/** Look up a live owner invitation without consuming it (the landing view). */
export async function ownerJoinPreview(token: string): Promise<OwnerJoinPreview | null> {
  const [row] = await systemDb
    .select({
      acceptedAt: auctionOwnerInvites.acceptedAt,
      revokedAt: auctionOwnerInvites.revokedAt,
      expiresAt: auctionOwnerInvites.expiresAt,
      auctionName: auctions.name,
      teamName: teams.name,
      competitionName: competitions.name,
      competitionSlug: competitions.slug,
    })
    .from(auctionOwnerInvites)
    .innerJoin(auctions, eq(auctions.id, auctionOwnerInvites.auctionId))
    .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
    .innerJoin(teams, eq(teams.id, auctionOwnerInvites.teamId))
    .where(eq(auctionOwnerInvites.tokenHash, hashToken(token)))
    .limit(1);
  if (
    row === undefined ||
    row.acceptedAt !== null ||
    row.revokedAt !== null ||
    row.expiresAt.getTime() < Date.now()
  ) {
    return null;
  }
  return {
    auctionName: row.auctionName,
    teamName: row.teamName,
    competitionName: row.competitionName,
    competitionSlug: row.competitionSlug,
  };
}

export type AcceptOwnerJoinResult =
  { ok: true; competitionSlug: string; teamName: string } | { ok: false };

/**
 * Accept an owner invitation: identity-side membership (so the owner can see
 * the competition) + the AcceptOwnerInvite COMMAND (the auction-side truth).
 * Unknown, expired, revoked and replayed tokens are indistinguishable.
 */
export async function acceptOwnerJoin(token: string): Promise<AcceptOwnerJoinResult> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false };
  }
  const [row] = await systemDb
    .select({
      id: auctionOwnerInvites.id,
      orgId: auctionOwnerInvites.orgId,
      auctionId: auctionOwnerInvites.auctionId,
      teamName: teams.name,
      competitionSlug: competitions.slug,
      expiresAt: auctionOwnerInvites.expiresAt,
      acceptedAt: auctionOwnerInvites.acceptedAt,
    })
    .from(auctionOwnerInvites)
    .innerJoin(auctions, eq(auctions.id, auctionOwnerInvites.auctionId))
    .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
    .innerJoin(teams, eq(teams.id, auctionOwnerInvites.teamId))
    .where(
      and(
        eq(auctionOwnerInvites.tokenHash, hashToken(token)),
        isNull(auctionOwnerInvites.revokedAt),
      ),
    )
    .limit(1);
  if (row === undefined || row.acceptedAt !== null || row.expiresAt.getTime() < Date.now()) {
    return { ok: false };
  }
  // Identity side: the owner becomes an org member (viewer-level; grants-not-
  // roles means membership alone confers NO capabilities).
  await systemDb
    .insert(orgMembers)
    .values({ orgId: row.orgId, personId: session.personId })
    .onConflictDoNothing();
  await systemDb.insert(auditLog).values({
    id: newId(),
    actor: session.personId,
    action: "auction.owner_join",
    scopeType: "org",
    scopeId: row.orgId,
    subject: row.id,
  });
  // Auction side: the acceptance travels the command path.
  const ack = await sendEngineCommand({
    auctionId: row.auctionId,
    type: "AcceptOwnerInvite",
    actor: session.personId,
    conduct: false,
    payload: { inviteId: row.id },
  });
  if (!ack.accepted) {
    return { ok: false };
  }
  return { ok: true, competitionSlug: row.competitionSlug, teamName: row.teamName };
}

export type GrantPaddleActionResult = { ok: true } | { ok: false; error: string };

/** Grant a paddle to an ACCEPTED owner — the explicit authorization to claim. */
export async function grantPaddleAction(
  slug: string,
  teamId: string,
  personId: string,
): Promise<GrantPaddleActionResult> {
  const gate = await liveGate(slug);
  if (gate === null || !gate.canConduct) {
    return { ok: false, error: "You can't conduct auctions here." };
  }
  const ack = await sendEngineCommand({
    auctionId: gate.auction.id,
    type: "GrantPaddle",
    actor: gate.personId,
    conduct: true,
    payload: { teamId, personId },
  });
  if (!ack.accepted) {
    const message: Record<string, string> = {
      not_an_owner: "That person hasn't accepted an owner invitation for this team.",
      terminal_auction: "This auction has ended.",
      unknown_team: "Pick a team from this competition.",
      engine_unreachable: "The auction engine is offline.",
    };
    return { ok: false, error: message[ack.reason ?? ""] ?? "Refused." };
  }
  return { ok: true };
}
