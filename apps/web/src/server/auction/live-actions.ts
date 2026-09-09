"use server";

import { auctionOf, type AuctionRecord } from "@desiauction/auction";
import {
  isAuctionCommandType,
  isTransportCommandId,
  roleOptions,
  type CommandAck,
} from "@desiauction/core";
import {
  auctionOwnerInvites,
  paddleGrants,
  paddles,
  teams,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { canCompetition } from "../competition/authz";
import { resolveCompetition, type CompetitionSummary } from "../competition/competitions";
import { dbHandle, systemDb } from "../db";
import { featureEnabled } from "../feature-settings";
import { storage } from "../media";
import { announceAuctionOutcomes } from "./auction-notify";
import { engineWsUrl, sendEngineCommand } from "./engine-client";
import {
  preSignedPlayers,
  resolvedLots,
  rulesOf,
  type AuctionRules,
  type PreSignedPlayer,
  type ResolvedLot,
  lotMediaOf,
} from "./live-summary";
import { planLots, planRulesOf, targetsOf, toLivePlanLot, type LivePlan } from "./owner-plan";

// Live auction actions (M-IP4-2, extended M-IP4-3). The web tier
// authenticates, resolves the tenant and capabilities, then SUBMITS A COMMAND
// — the engine decides. Claims require an explicit paddle grant (the
// production owner model); conduct commands require auction.conduct; the
// compensating undo additionally requires auction.override.

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

interface LiveGate {
  personId: string;
  competition: CompetitionSummary;
  auction: AuctionRecord;
  canConduct: boolean;
  canOverride: boolean;
  /**
   * The teams this person is actually IN this auction for — an accepted owner
   * invitation, a live paddle grant, or a paddle already in hand. Empty for a
   * plain org member, which is now the difference between being in the room and
   * not being in it.
   */
  myTeamIds: string[];
}

/**
 * Which teams a person is a participant of in THIS auction.
 *
 * Three routes in, all of them explicit acts by an organizer: they accepted an
 * owner invitation for the team, they hold a live paddle grant for it, or they
 * already hold its paddle. Mere org membership is not one of them — which is
 * the whole point of this function existing.
 */
async function participantTeamIds(dbc: Db, auctionId: string, personId: string): Promise<string[]> {
  const [ownedRows, grantRows, paddleRows] = await Promise.all([
    dbc
      .select({ teamId: auctionOwnerInvites.teamId })
      .from(auctionOwnerInvites)
      .where(
        and(
          eq(auctionOwnerInvites.auctionId, auctionId),
          eq(auctionOwnerInvites.acceptedBy, personId),
          isNull(auctionOwnerInvites.revokedAt),
        ),
      ),
    dbc
      .select({ teamId: paddleGrants.teamId })
      .from(paddleGrants)
      .where(
        and(
          eq(paddleGrants.auctionId, auctionId),
          eq(paddleGrants.personId, personId),
          isNull(paddleGrants.revokedAt),
        ),
      ),
    dbc
      .select({ teamId: paddles.teamId })
      .from(paddles)
      .where(
        and(
          eq(paddles.auctionId, auctionId),
          eq(paddles.personId, personId),
          isNull(paddles.releasedAt),
        ),
      ),
  ]);
  return [...new Set([...ownedRows, ...grantRows, ...paddleRows].map((row) => row.teamId))];
}

/**
 * THE LIVE-ROOM GATE.
 *
 * This used to be membership and nothing else: `resolveCompetition` joins
 * `org_members` on the person, and a non-null answer opened the entire room.
 * `acceptOwnerJoin` writes an `org_members` row — correctly commented "grants-
 * not-roles means membership alone confers NO capabilities", which is true
 * about capabilities and was false about DATA. A freshly-accepted owner with
 * zero grants, and equally anyone who had ever accepted any invite link to the
 * club, was served the whole live read model: every rival's paddle numbers,
 * remaining purse, committed spend and squad.
 *
 * The room is now for the people who are IN it: whoever conducts the auction,
 * and whoever an organizer has deliberately put on a team. Everyone else in the
 * club gets `null` — the same 404 `/seasons/…/money` has always correctly
 * given them, and /spectate remains the door for watching.
 */
export async function liveGate(slug: string): Promise<LiveGate | null> {
  const gate = await auctionMemberGate(slug);
  if (gate === null) {
    return null;
  }
  return !gate.canConduct && gate.myTeamIds.length === 0 ? null : gate;
}

/**
 * The MEMBERSHIP gate — resolution only, no participation requirement.
 *
 * This is the old `liveGate` behaviour, kept for exactly one caller:
 * `spectatorView`, the member-only fallback for an UNPUBLISHED auction. A
 * spectator payload is spectator-safe by construction (names and numbers, no
 * owner data, no diagnostics), so membership is the right gate for watching a
 * private season. It is NOT the right gate for the room where money is spent,
 * which is what `liveGate` above now says.
 */
export async function auctionMemberGate(slug: string): Promise<LiveGate | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  return withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    async (db) => {
      const auction = await auctionOf(db, competition.id);
      if (auction === null) {
        return null;
      }
      const scope = { orgId: competition.orgId, competitionId: competition.id };
      const [canConduct, canOverride, myTeamIds] = await Promise.all([
        canCompetition(db, session.personId, scope, "auction.conduct"),
        canCompetition(db, session.personId, scope, "auction.override"),
        participantTeamIds(db, auction.id, session.personId),
      ]);
      return {
        personId: session.personId,
        competition,
        auction,
        canConduct,
        canOverride,
        myTeamIds,
      };
    },
  );
}

export interface LiveAuctionView {
  competition: { name: string; slug: string };
  /** The season's roles as plain {key,label} pairs — see SpectatorView.roles. */
  roles: { key: string; label: string }[];
  auctionId: string;
  wsUrl: string;
  teams: {
    id: string;
    name: string;
    shortName: string | null;
    primaryColor: string | null;
    /** Signed crest URL, or null. Signed HERE, never on the snapshot — see below. */
    logoUrl: string | null;
  }[];
  /**
   * PLAYER FACE AND NUMBER, KEYED BY LOT — and deliberately NOT on the snapshot.
   *
   * The engine's snapshot is hashed and byte-compared across instances to prove
   * the fold is deterministic (`deepVerify`). Media URLs are SIGNED AT READ and
   * carry an expiry, so putting one on the wire would make two honest engines
   * disagree about the same auction and halt it. The room needs a face on the
   * block; the integrity check needs bytes that do not move. Both are satisfied
   * by shipping the media beside the snapshot and joining on `lotId` in the
   * client.
   *
   * `photoUrl` is consent-gated (DPDP §5): null unless the player set
   * `photo_consent_at`. `number` is the REGISTRATION number — the identity a
   * player already sees on their own public page — not the queue position the
   * snapshot calls `lotNumber`.
   */
  lotMedia: Record<string, { photoUrl: string | null; number: string | null }>;
  /** The default paddle (first issued); the room may switch within myPaddles. */
  myPaddle: { paddleId: string; paddleNumber: string; teamId: string; teamName: string } | null;
  /** Every paddle this person holds — one per team they were issued for. */
  myPaddles: { paddleId: string; paddleNumber: string; teamId: string; teamName: string }[];
  /** Teams THIS person holds an active paddle grant for (claim eligibility). */
  myGrantTeamIds: string[];
  /** Every team this person is in the room FOR (owner, grant or paddle). */
  myTeamIds: string[];
  viewer: {
    personId: string;
    canConduct: boolean;
    /**
     * May this viewer read every team's remaining purse and committed spend?
     *
     * TRUE for everyone in the room (founder decision D2, 2026-09-04). The
     * previous default of "bidders see only their own" read as a seal and was
     * not one: purse is `pursePerTeam − Σ soldPrice`, and all three inputs are
     * already on this viewer's payload. See `canSeeAll` above for the full
     * reasoning.
     *
     * If a genuinely sealed auction is ever wanted, this is still the flag that
     * would read it from `auction.config` — but it would have to withhold
     * hammer prices too, and those are the spectacle.
     */
    canSeeAllPurses: boolean;
    /** Whether every squad is readable, or only the viewer's own. Same rule. */
    canSeeAllSquads: boolean;
  };
  // PX-6: the locked rules (display) and the resolved history (late joiners).
  rules: AuctionRules;
  resolved: ResolvedLot[];
  /** Icons and retained players: on a squad, never in the pool. */
  preSigned: PreSignedPlayer[];
  /**
   * WR-1: may this person open /auction/plan here? Holds a team in this
   * auction AND planning is switched on. The door, not the data.
   */
  planAvailable: boolean;
  /**
   * WR-1: THIS PERSON'S plan, for the teams they are in the room for — and
   * nobody else's. Omitted (not nulled) when planning is off, when they hold
   * no team, and when they have added nothing yet, so an owner with no plan
   * receives the room exactly as before. Served beside the snapshot, never in
   * it (see `lotMedia`): the client folds it against each frame.
   */
  plan?: LivePlan;
}

/**
 * EVERY paddle this person holds, in issue order (DA-02).
 *
 * This used to return the first one and stop. A conductor running the night
 * from one laptop — the small-club case, and what our own seed does — holds
 * several, and the live room silently bound them to P01 with no way to switch
 * and no way to hand one back. Three of four teams simply could not bid, and
 * Abort was the only exit. The room now picks from this list.
 */
/**
 * The viewer's plan and whether the door to it exists. One feature read, one
 * pool read, one targets read per team the viewer holds (usually one).
 */
async function livePlanFor(
  db: Db,
  gate: LiveGate,
): Promise<{ available: boolean; plan: LivePlan | null }> {
  if (gate.myTeamIds.length === 0) {
    return { available: false, plan: null };
  }
  const feature = await featureEnabled(db, "my_plan", {
    orgId: gate.competition.orgId,
    auctionId: gate.auction.id,
  });
  if (!feature.enabled) {
    return { available: false, plan: null };
  }
  const [lotRows, ...targetLists] = await Promise.all([
    planLots(db, gate.auction.id),
    ...gate.myTeamIds.map((teamId) => targetsOf(db, gate.auction.id, teamId)),
  ]);
  const targetsByTeam = Object.fromEntries(
    gate.myTeamIds.map((teamId, index) => [teamId, targetLists[index] ?? []]),
  );
  const anyTargets = Object.values(targetsByTeam).some((list) => list.length > 0);
  return {
    available: true,
    plan: anyTargets
      ? {
          lots: lotRows.map(toLivePlanLot),
          planRules: planRulesOf(rulesOf(gate.auction.config)),
          targetsByTeam,
        }
      : null,
  };
}

async function myPaddles(dbc: Db, auctionId: string, personId: string) {
  const rows = await dbc
    .select({
      paddleId: paddles.id,
      paddleNumber: paddles.paddleNumber,
      teamId: paddles.teamId,
      teamName: teams.name,
    })
    .from(paddles)
    .leftJoin(teams, eq(teams.id, paddles.teamId))
    .where(
      and(
        eq(paddles.auctionId, auctionId),
        eq(paddles.personId, personId),
        isNull(paddles.releasedAt),
      ),
    )
    .orderBy(asc(paddles.paddleNumber));
  return rows.map((row) => ({ ...row, teamName: row.teamName ?? "Unknown" }));
}

export async function liveAuctionView(slug: string): Promise<LiveAuctionView | null> {
  const gate = await liveGate(slug);
  if (gate === null) {
    return null;
  }
  const [teamRows, paddleRows, grantRows, resolved, preSigned, lotMedia, planning] =
    await withTenantDb(dbHandle, { personId: gate.personId, orgId: gate.competition.orgId }, (db) =>
      Promise.all([
        db
          // shortName/primaryColor are franchise IDENTITY, not decoration: the
          // owner room tells four purses apart by colour at a glance, which is
          // the whole point of a paddle board.
          .select({
            id: teams.id,
            name: teams.name,
            shortName: teams.shortName,
            primaryColor: teams.primaryColor,
            logoKey: teams.logoUrl,
          })
          .from(teams)
          .where(eq(teams.competitionId, gate.competition.id))
          .orderBy(asc(teams.name)),
        myPaddles(db, gate.auction.id, gate.personId),
        db
          .select({ teamId: paddleGrants.teamId })
          .from(paddleGrants)
          .where(
            and(
              eq(paddleGrants.auctionId, gate.auction.id),
              eq(paddleGrants.personId, gate.personId),
              isNull(paddleGrants.revokedAt),
            ),
          ),
        resolvedLots(db, gate.auction.id),
        preSignedPlayers(db, gate.competition.id),
        lotMediaOf(db, gate.auction.id, (key) => storage.readUrl(key)),
        livePlanFor(db, gate),
      ]),
    );
  // THE PARTITION. Everything below the gate is decided HERE, before the read
  // leaves the server — the payload gate that /seasons/…/money has always had
  // and this room never did. Hiding a rival's squad in the markup does not hide
  // it: it is in the RSC payload, in view-source, in the network tab.
  /**
   * PURSES ARE PUBLIC TO THE ROOM (founder decision D2, 2026-09-04).
   *
   * This was `gate.canConduct` — bidders saw only their own money — and the
   * TODO on `canSeeAllPurses` below said the choice was "NOT decided here".
   * It is now, and the reason is that the seal never existed.
   *
   * A rival's remaining purse is `pursePerTeam − Σ soldPrice`. Every one of
   * those three is already on a payload this same viewer receives: the purse is
   * a single uniform number told to every owner in their join preview and
   * printed in the public rules, and the hammer prices and the paddle→team
   * mapping are the auction's public record — /spectate publishes them lot by
   * lot. Anyone who could read the screen could do the arithmetic (audit PA-1
   * §10 P1-3).
   *
   * So the gate was not protecting the money; it was protecting the APPEARANCE
   * of protecting it, and telling organizers their auction was sealed when it
   * was not. Between a real seal — which would mean withholding hammer prices
   * from the room, and that is the spectacle — and an honest open board, the
   * open board is the product this is.
   *
   * What stays: the engine's ticket-scope redaction, which still refuses purses
   * to an ANONYMOUS spectator ticket (scope `[]` in publicSpectatorView). That
   * one is not theatre — it keeps a scraped ticket from becoming a money feed —
   * and it is defence in depth for the room, not the room's rule.
   */
  const canSeeAll = true;
  return {
    competition: { name: gate.competition.name, slug: gate.competition.slug },
    roles: roleOptions(gate.competition.sport),
    auctionId: gate.auction.id,
    /*
     * The room's socket carries every purse (D2).
     *
     * This used to scope a bidder's ticket to their own teams and call that the
     * seal. It was not one — see `canSeeAll` above — so the scope now matches
     * what the room can already work out. `null` means "no redaction" to the
     * engine; the ANONYMOUS spectator ticket still passes `[]`
     * (publicSpectatorView), and that remains a real restriction.
     *
     * If a genuinely sealed auction is ever built, this is one of the two
     * places it lives: pass `gate.myTeamIds` here and withhold hammer prices
     * from `resolved` below. Withholding one without the other is the mistake
     * that was here.
     */
    wsUrl: engineWsUrl(gate.auction.id, null),
    teams: teamRows.map(({ logoKey, ...team }) => ({
      ...team,
      logoUrl: logoKey === null ? null : storage.readUrl(logoKey),
    })),
    lotMedia,
    myPaddle: paddleRows[0] ?? null,
    myPaddles: paddleRows,
    myGrantTeamIds: grantRows.map((row) => row.teamId),
    myTeamIds: gate.myTeamIds,
    viewer: {
      personId: gate.personId,
      canConduct: gate.canConduct,
      canSeeAllPurses: canSeeAll,
      canSeeAllSquads: canSeeAll,
    },
    rules: rulesOf(gate.auction.config),
    // A sold lot's price and buyer are the room's own public record — the
    // auctioneer calls them out and /spectate publishes them. An UNSOLD or
    // WITHDRAWN lot is the same. So the resolved history stays whole; what a
    // bidder must not receive is the pre-signed roster, which is nowhere
    // announced, and the aggregated purse figures (see the client).
    resolved,
    // Pre-signed players are part of the same open board (D2): who is already
    // on a roster is visible to the room, as the roster itself is.
    preSigned,
    planAvailable: planning.available,
    ...(planning.plan === null ? {} : { plan: planning.plan }),
  };
}

const CONDUCT_ONLY = new Set([
  "QueueLots",
  "OpenLot",
  "CloseLot",
  "PauseAuction",
  "ResumeAuction",
  "CompleteAuction",
  "AbortAuction",
  "RecoverAuction",
  // M-IP4-3: the full conduct surface.
  "OpenAuction",
  "IssuePaddle",
  "WithdrawLot",
  "HoldLot",
  "RequeueLot",
  "GrantPaddle",
  "UndoLastAction",
]);

// Token-flow commands never travel the generic gateway: invitations mint
// secrets (dedicated action returns the URL) and acceptance must present the
// TOKEN, not an invite id (owner-actions.ts owns both).
const GATEWAY_BLOCKED = new Set(["InviteOwner", "AcceptOwnerInvite"]);

/**
 * The single command gateway. `commandId` comes from the CLIENT so retries
 * (double-click, network replay) are idempotent end to end — the engine
 * returns the original ack for a repeated id.
 */
export async function submitAuctionCommand(
  slug: string,
  commandId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<CommandAck> {
  // The id is the idempotency key and it comes from the browser, so its SHAPE
  // is part of the trust boundary: the engine keys its cache on it, and its own
  // timer commands live in the same map (P0-2). The engine pins this too — this
  // is the near end of the same fence, and it answers before a round trip.
  if (!isTransportCommandId(commandId)) {
    return { commandId, accepted: false, reason: "invalid_command_id", version: 0 };
  }
  const gate = await liveGate(slug);
  if (gate === null) {
    return { commandId, accepted: false, reason: "unknown_auction", version: 0 };
  }
  if (!isAuctionCommandType(type) || GATEWAY_BLOCKED.has(type)) {
    return { commandId, accepted: false, reason: "unknown_command", version: 0 };
  }
  if (CONDUCT_ONLY.has(type) && !gate.canConduct) {
    return { commandId, accepted: false, reason: "not_authorized", version: 0 };
  }
  // The highest-friction action: undo demands the override capability too.
  if (type === "UndoLastAction" && !gate.canOverride) {
    return { commandId, accepted: false, reason: "not_authorized", version: 0 };
  }
  const ack = await sendEngineCommand({
    commandId,
    auctionId: gate.auction.id,
    type,
    actor: gate.personId,
    conduct: gate.canConduct,
    override: gate.canOverride,
    payload,
  });
  /*
   * THE ONE MESSAGE THE PLAYER WAS NEVER SENT.
   *
   * Announced only on an ACCEPTED completion, and only from here: the engine
   * owns the auction but cannot reach the messaging adapters (`apps/*` may not
   * import `apps/*`), and this is the single path a completion takes. A refused
   * command must announce nothing — a short-squad close that DA-06 rejects has
   * not ended anybody's night.
   *
   * Awaited rather than fired and forgotten, so the conductor's screen does not
   * refresh into a finished auction before the inbox rows exist; it is bounded
   * by one query plus a row per player, and it swallows its own failures so a
   * completed auction can never be undone by a notification.
   */
  if (type === "CompleteAuction" && ack.accepted) {
    await announceAuctionOutcomes({
      personId: gate.personId,
      orgId: gate.competition.orgId,
      auctionId: gate.auction.id,
      competition: { id: gate.competition.id, name: gate.competition.name },
    });
  }
  return ack;
}
