import { sportPackFor } from "@desiauction/core";
import {
  auctionOwnerInvites,
  auctions,
  paddles,
  people,
  registrations,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { formatPhone } from "../../lib/format-phone";
import { resolvedLots, rulesOf } from "../auction/live-summary";
import { registrationStats } from "./registrations";
import { teamsOf, type CompetitionSummary } from "./competitions";

/**
 * The Team Workspace (PX "Season Workspace" → Teams): the rich grid of franchise
 * cards and, for one team, the roster detail — squad, purse burndown and every
 * buy price. Derived entirely from read models that already exist: the team
 * list, the resolved auction lots (the source of truth for a buy price), the
 * approved-registration roster, and the paddle actually held for each team.
 *
 * A season with no auction yet is normal: buy prices come back null, purse spent
 * is zero, and the cards read as "nothing bought yet" rather than erroring.
 *
 * DA-30 — WHAT THIS READ MODEL WILL AND WILL NOT SAY:
 *
 * `acceptOwnerJoin` makes every accepted team owner a viewer-level org member,
 * so "a member of this org" includes the rival bidders. Membership therefore
 * buys identity and counts and nothing else:
 *
 *   always      team id, name, short name, colour, crest, owner name,
 *               squad size, approved-player count
 *   `money`     purse total, spend, remaining, purse %, every hammer price,
 *               the squad cap and the top buy
 *   `roster`    the squad itself — player names, phone numbers, roles, marks
 *
 * Gated keys are OMITTED, not nulled: an absent key cannot be read out of the
 * RSC payload, and CSS cannot un-hide what was never serialized.
 */

export interface TeamsWorkspaceOptions {
  /**
   * Money sight: `competition.manage` (running the season is money authority
   * over its auction) or `settlement.view` (the books). Mirrors DA-13 on the
   * season overview so one season cannot answer the question two ways.
   */
  money: boolean;
  /**
   * Roster sight: `competition.manage` or `registration.review` — the same
   * capability that governs /registrations, which is where these names and
   * phone numbers otherwise live.
   */
  roster: boolean;
}

export interface TeamRosterRow {
  registrationId: string;
  name: string | null;
  phone: string;
  role: string | null;
  /** Paise paid at auction; null for a pre-signed/icon slot with no hammer price. ABSENT without money sight. */
  buyPrice?: number | null;
  isIcon: boolean;
  isCaptain: boolean;
}

export interface TeamCard {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  logoUrl: string | null;
  /** The non-bidding staff name the organizer saved, or null. */
  coachName: string | null;
  /** Whoever holds this team's paddle, else whoever accepted its owner invite. */
  ownerName: string | null;
  squadFilled: number;
  /** Squad cap — auction configuration, gated with the money it belongs to. */
  squadMax?: number | null;
  /** Paise spent across the roster. Money-gated. */
  spent?: number;
  /** Paise the team started with (purse per team). Money-gated. */
  purseTotal?: number;
  /** 0–100, or null when no purse is configured. Money-gated. */
  usedPct?: number | null;
  /** Money-gated: naming the dearest buy names a hammer outcome. */
  topBuyName?: string | null;
  /** Sorted by buy price, dearest first; pre-signed (null price) last. Roster-gated. */
  roster?: TeamRosterRow[];
}

export interface TeamsWorkspace {
  competitionName: string;
  /**
   * The season's roles, in the pack's order, as plain {key,label} pairs.
   *
   * The roster's role tally sorted by `REGISTRATION_ROLES` and labelled with
   * `roleLabel`, both of which are cricket's — a comment beside the sort even
   * said "the pack declares the order" while using the wrong pack's.
   */
  roles: { key: string; label: string }[];
  teams: TeamCard[];
  /** Purse per team (paise); 0 when no auction is configured. Money-gated. */
  purseTotal?: number;
  squadMax?: number | null;
  approvedPlayers: number;
  /**
   * Where the purse and squad rules were set, so the figure has a provenance
   * the screen can link to. Null before an auction exists.
   */
  rulesSource: {
    auctionExists: boolean;
    locked: boolean;
    /**
     * The night is over (completed / reconciled / abandoned).
     *
     * The Teams tab derived "no auction" and "not allowed" and never asked what
     * STATE the auction was in, so it kept offering "Invite owner" after
     * settlement — the click then failed with the engine's "This auction has
     * ended." A blocked state, derived like the other two.
     */
    finished: boolean;
  } | null;
}

export async function teamsWorkspace(
  db: Db,
  competition: CompetitionSummary,
  options: TeamsWorkspaceOptions,
): Promise<TeamsWorkspace> {
  const [teams, stats, auctionRows, rosterRows] = await Promise.all([
    teamsOf(db, competition.id),
    registrationStats(db, competition.id),
    db
      .select({ id: auctions.id, status: auctions.status, config: auctions.config })
      .from(auctions)
      .where(eq(auctions.competitionId, competition.id))
      .limit(1),
    // Everyone approved and placed on a squad. The names and phones are read
    // here but only LEAVE this function when `options.roster` says they may.
    db
      .select({
        registrationId: registrations.id,
        teamId: registrations.teamId,
        role: registrations.role,
        isIcon: registrations.isIcon,
        isCaptain: registrations.isCaptain,
        name: people.name,
        phone: people.phone,
      })
      .from(registrations)
      .innerJoin(people, eq(people.id, registrations.personId))
      .where(
        and(
          eq(registrations.competitionId, competition.id),
          eq(registrations.status, "approved"),
          isNotNull(registrations.teamId),
        ),
      ),
  ]);

  const auction = auctionRows[0];
  const rules = auction !== undefined ? rulesOf(auction.config) : null;
  const purseTotal = rules?.pursePerTeam ?? 0;
  const squadMax = rules?.squadMax ?? null;

  // registrationId → buy price, from the resolved lots (the only place a hammer
  // price lives). Pre-signed players never appear here and stay priceless.
  const priceByReg = new Map<string, number>();
  const ownerByTeam = new Map<string, string>();
  if (auction !== undefined) {
    const [lots, paddleHolders, invited] = await Promise.all([
      resolvedLots(db, auction.id),
      // DA-32: the owner of a team is whoever HOLDS ITS PADDLE. The card used to
      // ask `auction_owner_invites` only, so a season whose owners had already
      // claimed their paddles — the normal end state, and what the demo data is
      // — rendered every card as ownerless while two people were bidding.
      db
        .select({ teamId: paddles.teamId, name: people.name, phone: people.phone })
        .from(paddles)
        .innerJoin(people, eq(people.id, paddles.personId))
        .where(and(eq(paddles.auctionId, auction.id), isNull(paddles.releasedAt)))
        .orderBy(asc(paddles.paddleNumber)),
      db
        .select({ teamId: auctionOwnerInvites.teamId, name: people.name, phone: people.phone })
        .from(auctionOwnerInvites)
        .innerJoin(people, eq(people.id, auctionOwnerInvites.acceptedBy))
        .where(
          and(
            eq(auctionOwnerInvites.auctionId, auction.id),
            isNotNull(auctionOwnerInvites.acceptedBy),
          ),
        ),
    ]);
    for (const lot of lots) {
      if (lot.status === "sold" && lot.registrationId !== null && lot.soldPrice !== null) {
        priceByReg.set(lot.registrationId, lot.soldPrice);
      }
    }
    // Invites first, paddles second — the paddle wins where both exist.
    //
    // THE NAME IS NOT THE OWNERSHIP. The name gate fires AFTER an invitation is
    // accepted (the acceptance redirects into /onboarding), so there is a real
    // window — and for anyone who closes the tab there, a permanent one — in
    // which a team has an accepted owner holding a ₹20L purse and no name. This
    // loop used to drop those rows, and the card then read "No owner yet",
    // which is the one sentence that makes an organizer mint a second link on
    // auction night. The cockpit has always shown the phone; this now agrees.
    for (const owner of [...invited, ...paddleHolders]) {
      const label = owner.name ?? formatPhone(owner.phone);
      ownerByTeam.set(owner.teamId, label);
    }
  }

  const rosterByTeam = new Map<string, TeamRosterRow[]>();
  for (const row of rosterRows) {
    if (row.teamId === null) {
      continue;
    }
    const list = rosterByTeam.get(row.teamId) ?? [];
    list.push({
      registrationId: row.registrationId,
      name: row.name,
      phone: row.phone,
      role: row.role,
      ...(options.money ? { buyPrice: priceByReg.get(row.registrationId) ?? null } : {}),
      isIcon: row.isIcon,
      isCaptain: row.isCaptain,
    });
    rosterByTeam.set(row.teamId, list);
  }

  const cards: TeamCard[] = teams.map((team) => {
    // Sorted from `priceByReg`, never from the (possibly omitted) `buyPrice`
    // key — the order must not depend on what this viewer is allowed to see.
    const roster = (rosterByTeam.get(team.id) ?? []).sort(
      (a, b) => (priceByReg.get(b.registrationId) ?? -1) - (priceByReg.get(a.registrationId) ?? -1),
    );
    const spent = roster.reduce((sum, row) => sum + (priceByReg.get(row.registrationId) ?? 0), 0);
    const topBuy = roster.find((row) => priceByReg.has(row.registrationId)) ?? null;
    return {
      id: team.id,
      name: team.name,
      shortName: team.shortName,
      color: team.primaryColor,
      logoUrl: team.logoUrl,
      coachName: team.coachName,
      ownerName: ownerByTeam.get(team.id) ?? null,
      squadFilled: roster.length,
      ...(options.money
        ? {
            squadMax,
            spent,
            purseTotal,
            usedPct: purseTotal > 0 ? Math.round((spent / purseTotal) * 100) : null,
            topBuyName: topBuy?.name ?? null,
          }
        : {}),
      ...(options.roster ? { roster } : {}),
    };
  });

  // Dearest squads first — the same "purse used" order the design sorts by.
  // Without money sight there is no spend to rank by, so the grid is
  // alphabetical. Either way the name breaks every tie, so the order is total
  // and the grid renders the same on every load.
  cards.sort((a, b) =>
    options.money && (b.spent ?? 0) !== (a.spent ?? 0)
      ? (b.spent ?? 0) - (a.spent ?? 0)
      : a.name.localeCompare(b.name),
  );

  return {
    competitionName: competition.name,
    roles: sportPackFor(competition.sport).roles.values.map((value) => ({
      key: value.key,
      label: value.label,
    })),
    teams: cards,
    ...(options.money ? { purseTotal, squadMax } : {}),
    approvedPlayers: stats.approved,
    // `createTeamAction` locks the team set the moment the auction leaves
    // `scheduled` (DA-07). The Teams tab now says so BEFORE the form, instead
    // of the server's refusal arriving as an error on the name field.
    rulesSource:
      auction === undefined
        ? null
        : {
            auctionExists: true,
            locked: auction.status !== "scheduled",
            finished:
              auction.status === "completed" ||
              auction.status === "reconciled" ||
              auction.status === "abandoned",
          },
  };
}
