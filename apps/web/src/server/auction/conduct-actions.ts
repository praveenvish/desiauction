"use server";

import { auctionView, ledgerOf, loadEvents, ownerBoard, snapshotRefs } from "@desiauction/auction";
import type { AuctionView, OwnerBoard } from "@desiauction/auction";
import { engineDiagnosticsSchema, type EngineDiagnostics } from "@desiauction/contracts";
import type { AuctionEventEnvelope, AuctionLedgerRow, SnapshotRefs } from "@desiauction/core";
import { auctionOf } from "@desiauction/auction";
import { competitions, teams, withTenantDb, type Db } from "@desiauction/db";
import { asc, eq } from "drizzle-orm";

import { dbHandle, systemDb } from "../db";
import { engineWsUrl, fetchEngineDiagnostics, fetchEngineSnapshot } from "./engine-client";
import { liveGate } from "./live-actions";
import { resolvedLots, type ResolvedLot } from "./live-summary";

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

export interface CockpitView {
  competition: { name: string; slug: string };
  auctionId: string;
  auctionName: string;
  wsUrl: string;
  view: AuctionView;
  owners: OwnerBoard;
  teams: { id: string; name: string }[];
  viewer: { personId: string; canConduct: boolean; canOverride: boolean };
}

/** The cockpit seed — conductors only (the organizer's control room). */
export async function cockpitView(slug: string): Promise<CockpitView | null> {
  const gate = await liveGate(slug);
  if (gate === null || !gate.canConduct) {
    return null;
  }
  const [view, owners, teamRows] = await inGateOrg(gate, (db) =>
    Promise.all([
      auctionView(db, gate.auction),
      ownerBoard(db, gate.auction),
      db
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(eq(teams.competitionId, gate.competition.id))
        .orderBy(asc(teams.name)),
    ]),
  );
  return {
    competition: { name: gate.competition.name, slug: gate.competition.slug },
    auctionId: gate.auction.id,
    auctionName: gate.auction.name,
    wsUrl: engineWsUrl(gate.auction.id),
    view,
    owners,
    teams: teamRows,
    viewer: {
      personId: gate.personId,
      canConduct: gate.canConduct,
      canOverride: gate.canOverride,
    },
  };
}

export interface SpectatorView {
  competitionName: string;
  competitionSlug: string;
  auctionName: string;
  wsUrl: string;
  /** PX-6: resolved history for late joiners (spectator-safe by construction). */
  resolved: ResolvedLot[];
}

/**
 * Spectator mode (M-IP4-3): the AuctionSnapshot stream and NOTHING else. No
 * conduct flags, no teams-for-claiming, no diagnostics, no owner data — the
 * snapshot itself is already spectator-safe (names and numbers only).
 */
export async function spectatorView(slug: string): Promise<SpectatorView | null> {
  const gate = await liveGate(slug);
  if (gate === null) {
    return null;
  }
  const resolved = await inGateOrg(gate, (db) => resolvedLots(db, gate.auction.id));
  return {
    competitionName: gate.competition.name,
    competitionSlug: gate.competition.slug,
    auctionName: gate.auction.name,
    wsUrl: engineWsUrl(gate.auction.id),
    resolved,
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
    })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (competition === undefined || competition.visibility !== "public") {
    return null;
  }
  const auction = await auctionOf(systemDb, competition.id);
  if (auction === null) {
    return null;
  }
  const resolved = await resolvedLots(systemDb, auction.id);
  return {
    competitionName: competition.name,
    competitionSlug: competition.slug,
    auctionName: auction.name,
    wsUrl: engineWsUrl(auction.id),
    resolved,
  };
}

export interface LedgerView {
  competition: { name: string; slug: string };
  auctionName: string;
  rows: readonly AuctionLedgerRow[];
  generationMs: number;
}

/**
 * The AuctionLedger — the canonical operational record, regenerated from the
 * immutable event log on every read (a projection can never diverge from
 * history). Conduct-gated: the ledger is the audit/dispute surface.
 */
export async function ledgerView(slug: string): Promise<LedgerView | null> {
  const gate = await liveGate(slug);
  if (gate === null || !gate.canConduct) {
    return null;
  }
  const start = performance.now();
  const rows = await inGateOrg(gate, (db) => ledgerOf(db, gate.auction));
  return {
    competition: { name: gate.competition.name, slug: gate.competition.slug },
    auctionName: gate.auction.name,
    rows,
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
