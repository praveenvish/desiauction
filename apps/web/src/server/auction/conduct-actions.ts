"use server";

import { auctionView, ledgerOf, loadEvents, ownerBoard, snapshotRefs } from "@desiauction/auction";
import type { AuctionView, OwnerBoard } from "@desiauction/auction";
import { engineDiagnosticsSchema, type EngineDiagnostics } from "@desiauction/contracts";
import type {
  AuctionEventEnvelope,
  AuctionLedgerRow,
  AuctionStatus,
  SnapshotRefs,
} from "@desiauction/core";
import { auctionOf } from "@desiauction/auction";
import {
  auctionOwnerInvites,
  competitions,
  organizations,
  orgMembers,
  people,
  teams,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { dbHandle, systemDb } from "../db";
import { engineWsUrl, fetchEngineDiagnostics, fetchEngineSnapshot } from "./engine-client";
import { auctionMemberGate, liveGate } from "./live-actions";
import {
  preSignedPlayers,
  resolvedLots,
  rulesOf,
  type AuctionRules,
  type PreSignedPlayer,
  type ResolvedLot,
} from "./live-summary";

function inGateOrg<T>(
  gate: { personId: string; competition: { orgId: string } },
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return withTenantDb(dbHandle, { personId: gate.personId, orgId: gate.competition.orgId }, fn);
}

// Conduct & ceremony read surfaces (M-IP4-3). Every view here is READ-ONLY:
// the cockpit seed, the AuctionLedger, the replay viewer's event feed, and the
// engine diagnostics proxy. Spectators get spectatorView and NOTHING else —
// no diagnostics, no audit, no owner data, no events.

/** The franchise identity columns, selected identically on every live surface. */
const TEAM_IDENTITY = {
  id: teams.id,
  name: teams.name,
  shortName: teams.shortName,
  primaryColor: teams.primaryColor,
};

export interface OwnerAcceptance {
  /** `auction_owner_invites.id` — the key back onto `owners.invites`. */
  inviteId: string;
  personId: string;
  name: string | null;
  /** E.164 as stored; the panel formats it. Never blank for a real account. */
  phone: string;
  /** ISO. */
  acceptedAt: string | null;
  /**
   * Still a member of this organization?
   *
   * `removeMember` revokes grants and deletes the membership row, and leaves
   * `auction_owner_invites.accepted_by` and `paddle_grants` exactly where they
   * were — both are auction-aggregate state that only the engine may write, and
   * there is no command to withdraw either. So the cockpit went on listing an
   * offboarded person as an owner ready to be handed a paddle. It cannot be
   * unwound here; it CAN be told the truth about, and the grant refused.
   */
  stillMember: boolean;
}

/** Identity for every accepted owner invitation on this auction. */
async function ownerAcceptancesOf(auctionId: string, orgId: string): Promise<OwnerAcceptance[]> {
  const rows = await systemDb
    .select({
      inviteId: auctionOwnerInvites.id,
      personId: auctionOwnerInvites.acceptedBy,
      acceptedAt: auctionOwnerInvites.acceptedAt,
      name: people.name,
      phone: people.phone,
      memberOrgId: orgMembers.orgId,
    })
    .from(auctionOwnerInvites)
    .innerJoin(people, eq(people.id, auctionOwnerInvites.acceptedBy))
    .leftJoin(
      orgMembers,
      and(eq(orgMembers.personId, auctionOwnerInvites.acceptedBy), eq(orgMembers.orgId, orgId)),
    )
    .where(
      and(
        eq(auctionOwnerInvites.auctionId, auctionId),
        isNull(auctionOwnerInvites.revokedAt),
        isNotNull(auctionOwnerInvites.acceptedBy),
      ),
    );
  return rows.map((row) => ({
    inviteId: row.inviteId,
    personId: row.personId ?? "",
    name: row.name,
    phone: row.phone,
    acceptedAt: row.acceptedAt === null ? null : row.acceptedAt.toISOString(),
    stillMember: row.memberOrgId !== null,
  }));
}

export interface CockpitView {
  competition: { name: string; slug: string };
  auctionId: string;
  auctionName: string;
  wsUrl: string;
  view: AuctionView;
  owners: OwnerBoard;
  /**
   * WHO actually accepted each owner link, and when.
   *
   * `ownerBoard` (packages/auction) returns `acceptedByName`, which the cockpit
   * rendered as the literal string "Owner" whenever the account had no name.
   * A stranger who opened a forwarded link therefore appeared as a row reading
   * "Owner" — indistinguishable from the legitimate owner of the same team,
   * with no phone number anywhere on the screen. The organizer is about to hand
   * one of them a paddle and money authority.
   *
   * The phone lives on `people` and is a web-tier read; the aggregate's view is
   * FENCED for this work, so the identity is joined on here and matched by
   * invite id.
   */
  ownerAcceptances: OwnerAcceptance[];
  teams: { id: string; name: string; shortName: string | null; primaryColor: string | null }[];
  viewer: { personId: string; canConduct: boolean; canOverride: boolean };
  /** Icons and retained players: on a squad, never in the pool. */
  preSigned: PreSignedPlayer[];
  resolved: ResolvedLot[];
  rules: AuctionRules;
}

/** The cockpit seed — conductors only (the organizer's control room). */
export async function cockpitView(slug: string): Promise<CockpitView | null> {
  const gate = await liveGate(slug);
  if (gate === null || !gate.canConduct) {
    return null;
  }
  const [view, owners, teamRows, preSigned, resolved] = await inGateOrg(gate, (db) =>
    Promise.all([
      auctionView(db, gate.auction),
      ownerBoard(db, gate.auction),
      db
        .select(TEAM_IDENTITY)
        .from(teams)
        .where(eq(teams.competitionId, gate.competition.id))
        .orderBy(asc(teams.name)),
      preSignedPlayers(db, gate.competition.id),
      resolvedLots(db, gate.auction.id),
    ]),
  );
  const ownerAcceptances = await ownerAcceptancesOf(gate.auction.id, gate.competition.orgId);
  return {
    competition: { name: gate.competition.name, slug: gate.competition.slug },
    auctionId: gate.auction.id,
    auctionName: gate.auction.name,
    // The conductor's board is the one audience that sees every purse.
    wsUrl: engineWsUrl(gate.auction.id, null),
    view,
    owners,
    ownerAcceptances,
    teams: teamRows,
    viewer: {
      personId: gate.personId,
      canConduct: gate.canConduct,
      canOverride: gate.canOverride,
    },
    preSigned,
    resolved,
    rules: rulesOf(gate.auction.config),
  };
}

export interface SpectatorView {
  competitionName: string;
  competitionSlug: string;
  auctionName: string;
  /**
   * DA-20: the auction's OWN state, so the surfaces above the socket stop
   * asserting "live". The document title on a settled auction read "Demo Cup
   * (settled) Auction — live"; the OG card, the WhatsApp share text and the
   * spectator's identity line all said the same thing on scheduled, completed
   * and abandoned nights. Every one of them was a constant, and the fact was
   * already sitting on the auction row this read already loads.
   */
  auctionStatus: AuctionStatus;
  /**
   * Who is running this and where. Already public on `/c/<slug>` — the stage
   * says "Watching live · <organizer> · <city>" so a guest arriving from a
   * forwarded link knows whose night this is, which the auction's own name
   * (usually "<Competition> Auction") does not tell them.
   */
  orgName: string | null;
  location: string | null;
  wsUrl: string;
  /** PX-6: resolved history for late joiners (spectator-safe by construction). */
  resolved: ResolvedLot[];
  /**
   * Franchise identity for the purse board — name, crest letters, colour.
   * Spectator-safe by the same argument as the snapshot: team names are already
   * broadcast on every lot, and a short name and a hex are published branding.
   * No person, no contact, no grant is reachable from here.
   */
  teams: { id: string; name: string; shortName: string | null; primaryColor: string | null }[];
  /**
   * The locked rules. Already public — the auction lobby prints them as "Rules
   * of the night" — and the spectator needs the lot window to draw a countdown
   * that means anything.
   */
  rules: AuctionRules;
  /** Icons and retained players: on a squad, never in the pool. */
  preSigned: PreSignedPlayer[];
}

/**
 * Spectator mode (M-IP4-3): the AuctionSnapshot stream and NOTHING else. No
 * conduct flags, no teams-for-claiming, no diagnostics, no owner data — the
 * snapshot itself is already spectator-safe (names and numbers only).
 */
export async function spectatorView(slug: string): Promise<SpectatorView | null> {
  // MEMBERSHIP, not participation. This is the fallback for an UNPUBLISHED
  // auction, and watching your own club's private season is exactly what a
  // member should be able to do — the payload here carries no owner data,
  // no diagnostics and no commands. The live ROOM is gated harder (liveGate).
  const gate = await auctionMemberGate(slug);
  if (gate === null) {
    return null;
  }
  const [resolved, teamRows, preSigned] = await inGateOrg(gate, (db) =>
    Promise.all([
      resolvedLots(db, gate.auction.id),
      db
        .select(TEAM_IDENTITY)
        .from(teams)
        .where(eq(teams.competitionId, gate.competition.id))
        .orderBy(asc(teams.name)),
      preSignedPlayers(db, gate.competition.id),
    ]),
  );
  const [org] = await systemDb
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, gate.competition.orgId))
    .limit(1);
  return {
    competitionName: gate.competition.name,
    competitionSlug: gate.competition.slug,
    auctionName: gate.auction.name,
    auctionStatus: gate.auction.status,
    orgName: org?.name ?? null,
    location: gate.competition.location,
    // A member watching is not a conductor: they receive their own teams'
    // money and nobody else's (P1-6).
    wsUrl: engineWsUrl(gate.auction.id, gate.canConduct ? null : gate.myTeamIds),
    resolved,
    teams: teamRows,
    rules: rulesOf(gate.auction.config),
    preSigned,
  };
}

/**
 * PX-6 PUBLIC spectating (PX-1 S3 charter: the Stage is for the public).
 * Anonymous, visibility-gated exactly like the PX-5 public pages: an organizer
 * who PUBLISHED the competition has published its auction night. Unpublished
 * auctions keep the member-gated path. The snapshot stream itself is
 * spectator-safe by construction (auction-snapshot.ts); this read adds only
 * the same resolved history the snapshot's lastOutcome exposes lot by lot.
 */
export async function publicSpectatorView(slug: string): Promise<SpectatorView | null> {
  const [competition] = await systemDb
    .select({
      id: competitions.id,
      name: competitions.name,
      slug: competitions.slug,
      visibility: competitions.visibility,
      location: competitions.location,
      orgName: organizations.name,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (competition === undefined || competition.visibility !== "public") {
    return null;
  }
  const auction = await auctionOf(systemDb, competition.id);
  if (auction === null) {
    return null;
  }
  const [resolved, teamRows, preSigned] = await Promise.all([
    resolvedLots(systemDb, auction.id),
    systemDb
      .select(TEAM_IDENTITY)
      .from(teams)
      .where(eq(teams.competitionId, competition.id))
      .orderBy(asc(teams.name)),
    preSignedPlayers(systemDb, competition.id),
  ]);
  return {
    competitionName: competition.name,
    competitionSlug: competition.slug,
    auctionName: auction.name,
    auctionStatus: auction.status,
    orgName: competition.orgName,
    location: competition.location,
    // Anonymous spectators get the spectacle, never the money.
    wsUrl: engineWsUrl(auction.id, []),
    teams: teamRows,
    resolved,
    rules: rulesOf(auction.config),
    preSigned,
  };
}

export interface LedgerView {
  competition: { name: string; slug: string };
  auctionName: string;
  rows: readonly AuctionLedgerRow[];
  /** Every row the fold produced; `rows` is the current page (DA-30). */
  totalRows: number;
  page: number;
  totalPages: number;
  generationMs: number;
}

/**
 * The AuctionLedger — the canonical operational record, regenerated from the
 * immutable event log on every read (a projection can never diverge from
 * history). Conduct-gated: the ledger is the audit/dispute surface.
 */
/** DA-30: 214 rows served 900 KB of HTML, and it grows with the auction.
 * Not exported: a "use server" module may only export async functions. */
const LEDGER_PAGE_SIZE = 100;

export async function ledgerView(slug: string, page = 1): Promise<LedgerView | null> {
  const gate = await liveGate(slug);
  if (gate === null || !gate.canConduct) {
    return null;
  }
  const start = performance.now();
  const all = await inGateOrg(gate, (db) => ledgerOf(db, gate.auction));
  // The fold stays whole — the ledger's guarantee is that it regenerates from
  // the event log — and only the RENDER is bounded. A 500-lot auction would
  // otherwise ship several megabytes to a browser that shows thirty rows.
  const totalPages = Math.max(1, Math.ceil(all.length / LEDGER_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const offset = (current - 1) * LEDGER_PAGE_SIZE;
  return {
    competition: { name: gate.competition.name, slug: gate.competition.slug },
    auctionName: gate.auction.name,
    rows: all.slice(offset, offset + LEDGER_PAGE_SIZE),
    totalRows: all.length,
    page: current,
    totalPages,
    generationMs: performance.now() - start,
  };
}

export interface ReplayViewerData {
  competition: { name: string; slug: string };
  auctionName: string;
  events: AuctionEventEnvelope[];
  refs: SnapshotRefs;
  /** The engine's CURRENT canonical snapshot bytes (comparison target). */
  engineSerialized: string | null;
}

/** The replay viewer's feed — pure inputs for a client-side visual fold. */
export async function replayViewerData(slug: string): Promise<ReplayViewerData | null> {
  const gate = await liveGate(slug);
  if (gate === null || !gate.canConduct) {
    return null;
  }
  const [events, refs, engineSerialized] = await inGateOrg(gate, (db) =>
    Promise.all([
      loadEvents(db, gate.auction.id),
      snapshotRefs(db, gate.auction),
      fetchEngineSnapshot(gate.auction.id),
    ]),
  );
  return {
    competition: { name: gate.competition.name, slug: gate.competition.slug },
    auctionName: gate.auction.name,
    events,
    refs,
    engineSerialized,
  };
}

export type DiagnosticsResult =
  | { ok: true; diagnostics: EngineDiagnostics }
  | { ok: false; reason: "engine_unreachable" | "not_authorized" | "invalid_response" };

/** The recovery dashboard's feed — a conduct-gated proxy to the engine. */
export async function engineDiagnosticsAction(slug: string): Promise<DiagnosticsResult> {
  const gate = await liveGate(slug);
  if (gate === null || !gate.canConduct) {
    return { ok: false, reason: "not_authorized" };
  }
  const raw = await fetchEngineDiagnostics(gate.auction.id);
  if (raw === null) {
    return { ok: false, reason: "engine_unreachable" };
  }
  const parsed = engineDiagnosticsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_response" };
  }
  return { ok: true, diagnostics: parsed.data };
}
