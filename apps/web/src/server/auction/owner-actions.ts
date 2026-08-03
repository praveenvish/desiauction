"use server";

import { createHash, randomBytes } from "node:crypto";

import {
  auctionOwnerInvites,
  auctions,
  auditLog,
  competitions,
  newId,
  organizations,
  orgMembers,
  people,
  teams,
} from "@desiauction/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { currentSession } from "../auth/actions";
import { systemDb } from "../db";
import { sendEngineCommand } from "./engine-client";
import { liveGate } from "./live-actions";
import { rulesOf } from "./live-summary";

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

/**
 * Auction states in which an invitation is meaningless: the night is over.
 *
 * `inviteOwner` and `grantPaddle` both refuse these (the engine answers
 * `terminal_auction`); the acceptance path checked NOTHING, so a link minted
 * before a completed auction could still be accepted afterwards — enrolling a
 * stranger as an org member of a club whose auction had already been settled.
 */
const TERMINAL_AUCTION_STATUSES = new Set(["completed", "reconciled", "abandoned"]);

export interface OwnerJoinPreview {
  auctionName: string;
  teamName: string;
  competitionName: string;
  competitionSlug: string;
  /** The club the invitee is also being made a member of — never named before. */
  orgName: string;
  /** The auction's own state; `live` means the night has ALREADY started. */
  auctionStatus: string;
  /** Paise. What they will be bidding with — the whole point of accepting. */
  pursePerTeam: number;
  squadMax: number;
  /** ISO — the invitee was never told the link had a deadline. */
  expiresAt: string;
  /** Who minted it. Null when that account has no name. */
  invitedByName: string | null;
}

export type OwnerJoinLanding =
  | { state: "valid"; preview: OwnerJoinPreview }
  | { state: "already-owner"; teamName: string; competitionSlug: string; competitionName: string }
  | { state: "invalid" };

/**
 * The /owner-join landing, resolved for ONE viewer.
 *
 * `invalid` stays the single indistinguishable answer for unknown, expired,
 * revoked, terminal-auction and used-by-somebody-else tokens. `already-owner`
 * is returned ONLY when this viewer is the accepting person — telling somebody
 * a fact about themselves that they already know is not a disclosure, and
 * "no longer valid" was the wrong answer to the most likely repeat visit.
 */
export async function ownerJoinLanding(personId: string, token: string): Promise<OwnerJoinLanding> {
  const [row] = await systemDb
    .select({
      acceptedAt: auctionOwnerInvites.acceptedAt,
      acceptedBy: auctionOwnerInvites.acceptedBy,
      revokedAt: auctionOwnerInvites.revokedAt,
      expiresAt: auctionOwnerInvites.expiresAt,
      createdBy: auctionOwnerInvites.createdBy,
      auctionId: auctionOwnerInvites.auctionId,
      teamId: auctionOwnerInvites.teamId,
      auctionName: auctions.name,
      auctionStatus: auctions.status,
      auctionConfig: auctions.config,
      teamName: teams.name,
      competitionName: competitions.name,
      competitionSlug: competitions.slug,
      orgName: organizations.name,
    })
    .from(auctionOwnerInvites)
    .innerJoin(auctions, eq(auctions.id, auctionOwnerInvites.auctionId))
    .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
    .innerJoin(teams, eq(teams.id, auctionOwnerInvites.teamId))
    .innerJoin(organizations, eq(organizations.id, auctionOwnerInvites.orgId))
    .where(eq(auctionOwnerInvites.tokenHash, hashToken(token)))
    .limit(1);
  if (row === undefined) {
    return { state: "invalid" };
  }
  if (row.acceptedBy !== null && row.acceptedBy === personId) {
    return {
      state: "already-owner",
      teamName: row.teamName,
      competitionSlug: row.competitionSlug,
      competitionName: row.competitionName,
    };
  }
  if (
    row.acceptedAt !== null ||
    row.revokedAt !== null ||
    row.expiresAt.getTime() < Date.now() ||
    TERMINAL_AUCTION_STATUSES.has(row.auctionStatus)
  ) {
    return { state: "invalid" };
  }
  // The team already HAS an owner. `acceptOwnerJoin` refuses this (one owner per
  // team), so previewing it as live would walk somebody through a purse figure,
  // a squad size and an Accept button that cannot succeed. The preview and the
  // acceptance answer the same question, in the same words as every other
  // failure.
  const [existingOwner] = await systemDb
    .select({ id: auctionOwnerInvites.id })
    .from(auctionOwnerInvites)
    .where(
      and(
        eq(auctionOwnerInvites.auctionId, row.auctionId),
        eq(auctionOwnerInvites.teamId, row.teamId),
        isNull(auctionOwnerInvites.revokedAt),
        isNotNull(auctionOwnerInvites.acceptedBy),
      ),
    )
    .limit(1);
  if (existingOwner !== undefined) {
    return { state: "invalid" };
  }
  const [inviter] = await systemDb
    .select({ name: people.name })
    .from(people)
    .where(eq(people.id, row.createdBy))
    .limit(1);
  const rules = rulesOf(row.auctionConfig);
  return {
    state: "valid",
    preview: {
      auctionName: row.auctionName,
      teamName: row.teamName,
      competitionName: row.competitionName,
      competitionSlug: row.competitionSlug,
      orgName: row.orgName,
      auctionStatus: row.auctionStatus,
      pursePerTeam: rules.pursePerTeam,
      squadMax: rules.squadMax,
      expiresAt: row.expiresAt.toISOString(),
      invitedByName: inviter?.name ?? null,
    },
  };
}

/** Look up a live owner invitation without consuming it (the landing view). */
export async function ownerJoinPreview(token: string): Promise<OwnerJoinPreview | null> {
  const landing = await ownerJoinLanding("", token);
  return landing.state === "valid" ? landing.preview : null;
}

/**
 * The landing plus the viewer's own phone, so the page can say "Signed in as
 * …" — an owner link is an unaddressed bearer token and the handset that opens
 * it is frequently signed in as somebody else.
 */
export async function ownerJoinLandingView(token: string): Promise<{
  landing: OwnerJoinLanding;
  viewerPhone: string;
}> {
  const session = await currentSession();
  if (session === null) {
    return { landing: { state: "invalid" }, viewerPhone: "" };
  }
  return {
    landing: await ownerJoinLanding(session.personId, token),
    viewerPhone: session.phone,
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
      teamId: auctionOwnerInvites.teamId,
      teamName: teams.name,
      competitionSlug: competitions.slug,
      expiresAt: auctionOwnerInvites.expiresAt,
      acceptedAt: auctionOwnerInvites.acceptedAt,
      auctionStatus: auctions.status,
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
  // The auction is over. `inviteOwner` and `grantPaddle` both refuse a terminal
  // auction; acceptance did not, so a link minted before the night could still
  // enrol a stranger into the club days after settlement. Same refusal, and
  // deliberately indistinguishable from every other failure.
  if (TERMINAL_AUCTION_STATUSES.has(row.auctionStatus)) {
    return { ok: false };
  }
  // ONE OWNER PER TEAM. Nothing anywhere checked this: `inviteOwner` will mint
  // a second link for a team that already has an owner, and acceptance would
  // take it — Demo Wolves currently carries two accepted owners, one of whom
  // opened a forwarded link. The cockpit then lists two identical rows and the
  // organizer has no way to tell which is the real one. Refused here, in the
  // web tier, because it needs no aggregate change; the same rule belongs in
  // `packages/auction`'s AcceptOwnerInvite handler as a hard invariant, which
  // is FENCED for this work and is reported as a flagged item.
  const [existingOwner] = await systemDb
    .select({ id: auctionOwnerInvites.id })
    .from(auctionOwnerInvites)
    .where(
      and(
        eq(auctionOwnerInvites.auctionId, row.auctionId),
        eq(auctionOwnerInvites.teamId, row.teamId),
        isNull(auctionOwnerInvites.revokedAt),
        isNotNull(auctionOwnerInvites.acceptedBy),
      ),
    )
    .limit(1);
  if (existingOwner !== undefined) {
    return { ok: false };
  }
  // Auction side FIRST: the acceptance travels the command path, and the engine
  // is the authority on whether it happened.
  //
  // The order used to be the other way round — membership row, audit row, THEN
  // the command. An unreachable engine left the person permanently an org
  // member of a club they had never joined, holding an audit row asserting an
  // acceptance that never occurred, and `{ok:false}` on their screen. Nothing
  // is written on the identity side until the engine has said yes.
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
  // Identity side: the owner becomes an org member (viewer-level; grants-not-
  // roles means membership alone confers NO capabilities — and, since this
  // work, membership alone no longer opens the live room's read model either).
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
