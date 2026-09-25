import { cache } from "react";
import {
  deriveAge,
  describeAttributes,
  isMinor,
  mayPublishPhoto,
  paise,
  type MoneyUnit,
  type Paise,
  slugifyName,
  type PlayerPosterInput,
  type PosterMark,
} from "@desiauction/core";
import {
  auctionEvents,
  auctions,
  competitions,
  lots,
  organizations,
  paddles,
  people,
  registrations,
  teams,
} from "@desiauction/db";
import { and, asc, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";

import { storage } from "../media";
import { systemDb } from "../db";
import { teamsOf, type TeamSummary } from "./competitions";
import { publishedSchedule, type FixtureSnapshot } from "./fixtures";
import { isPreSigned, preSignedKind, type PreSignedKind } from "../../lib/pre-signed";
import { preSignedSql } from "./pre-signed";
import { marksOf, outcomeOf } from "./poster-outcome";
import { shownName, shownPhotoConsentAt, shownPhotoKey } from "./shown-name";
import { containsPattern } from "../../lib/like-pattern";

// PX-5 public reads (PX-1 02 §I thin-wiring class): anonymous, system-pool
// composites over EXISTING queries. Public exposure is governed by the
// platform's own `competitions.visibility` column, and by NOTHING else.
//
// It used to also be governed by `status = 'registration_open'`, on the theory
// that "the shared link already made those public in practice". It had not.
// Opening registration is an operational act — one click on the Overview, no
// publish dialog, no warning — and it was publishing the competition page, the
// complete approved roster, every player's individual profile, four social
// cards and a one-click CSV of the lot. 19 competitions their organizers had
// marked `private` were serving 80-player rosters to anyone with the link.
//
// Two gates on the very same competition already disagreed with this one and
// were right: `/seasons/[slug]/register` (publicRegistrationFacts) and
// `/seasons/[slug]/auction/spectate` both test visibility alone, and the
// register page states the policy in prose — "a private season's very name is
// not a stranger's to read". The surface carrying other people's personal data
// was the permissive one. Publication is now one decision, made in one place,
// by the organizer, deliberately.
//
// Removing the status clause breaks no working flow: registration for a private
// competition never went through here. A signed-in player still registers by
// direct link (`competitionForRegistration`, no visibility test), and a
// signed-out one still gets the login redirect they got before. What is gone is
// the roster, not the door.
//
// Nothing here reads phones, registrations, or any person data.

export interface PublicFixture {
  number: string;
  /** Null on a lobby (0058): a battle royale match names no home and no away. */
  homeTeamName: string | null;
  awayTeamName: string | null;
  /** How many squads are in the lobby. Zero on a duel, which names its two. */
  squadCount: number;
  kickoffAt: string | null;
  groundName: string | null;
  venueName: string | null;
}

export interface PublicCompetitionView {
  name: string;
  slug: string;
  /** The season's sport, so the showcase can name roles the way it does. */
  sport: string;
  status: string;
  /** PI-1: organizer-declared category, for terminology ("Women's") only. */
  entryCategory: "open" | "men" | "women" | "mixed";
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  orgName: string;
  open: boolean;
  /** Always true now that visibility is the only gate — this view does not
   *  exist for an unpublished competition. Kept so callers state the reason
   *  they index a page rather than assuming it. */
  listed: boolean;
  /** Ready-to-render competition crest URL, or null for the monogram fallback. */
  logoUrl: string | null;
  /**
   * The season's cover photo (0082), behind the public hero. Only ever read
   * here, after the visibility gate above: an unpublished season's picture is
   * as absent as the rest of it.
   */
  coverUrl: string | null;
  /** PX-6: the live door on the public page (null until an auction exists). */
  auctionStatus: string | null;
  /**
   * THE TWO AUCTION RULES A STRANGER MAY READ (founder, 2026-09-19).
   *
   * Everything else about the money stays private — no sold price, no bid, no
   * purse SPENT, no dues. These two are the tournament's published terms: what
   * every owner starts with and how many players they must end with. A player
   * deciding whether to register is choosing between tournaments on exactly
   * these numbers, and until now had to ask the organizer for both.
   *
   * Null when no auction exists yet: the rules are not set, so the page says
   * nothing rather than showing a default nobody chose.
   */
  pursePerTeam: Paise | null;
  /**
   * What the purse counts in (0091): a points league's "1,000 pts" is a
   * budget to build a squad with, not money anyone owes.
   */
  auctionUnit: MoneyUnit;
  /** The squad size owners are bidding towards (`squadMax`). */
  squadSize: number | null;
  teams: TeamSummary[];
  fixtures: PublicFixture[];
  /** Every published fixture, including any beyond the rendered bound. */
  fixtureTotal: number;
}

/**
 * The publishable half of an auction's config.
 *
 * The config is a jsonb blob written by the console, so it is READ
 * defensively: a season configured by an older build, or by a sport pack that
 * does not price squads, must not take the public page down. Anything that is
 * not a positive number is simply not published.
 */
function publicAuctionRules(config: unknown): {
  pursePerTeam: Paise | null;
  squadSize: number | null;
} {
  if (config === null || typeof config !== "object") {
    return { pursePerTeam: null, squadSize: null };
  }
  const record = config as Record<string, unknown>;
  const purse = record["pursePerTeam"];
  const squad = record["squadMax"];
  return {
    pursePerTeam:
      typeof purse === "number" && Number.isFinite(purse) && purse > 0 ? paise(purse) : null,
    squadSize: typeof squad === "number" && Number.isInteger(squad) && squad > 0 ? squad : null,
  };
}

function toPublicFixture(row: FixtureSnapshot): PublicFixture {
  return {
    number: row.number,
    // Null on a lobby, which has no home and no away — the public fixture list
    // renders the match without naming two sides it does not have.
    homeTeamName: row.homeTeamName,
    awayTeamName: row.awayTeamName,
    squadCount: row.squadCount,
    kickoffAt: row.kickoffAt,
    groundName: row.groundName,
    venueName: row.venueName,
  };
}

export async function publicCompetitionView(slug: string): Promise<PublicCompetitionView | null> {
  const [row] = await systemDb
    .select({
      id: competitions.id,
      name: competitions.name,
      slug: competitions.slug,
      status: competitions.status,
      entryCategory: competitions.entryCategory,
      visibility: competitions.visibility,
      location: competitions.location,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
      orgName: organizations.name,
      logoKey: competitions.logoUrl,
      coverKey: competitions.coverUrl,
      sport: competitions.sport,
      auctionUnit: competitions.auctionUnit,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  if (row.visibility !== "public") {
    // Not published — structurally absent, indistinguishable from a slug that
    // was never created. Open registration is not publication.
    return null;
  }
  const open = row.status === "registration_open";
  const [auctionRows, teams, fixtures] = await Promise.all([
    systemDb
      .select({ status: auctions.status, config: auctions.config })
      .from(auctions)
      .where(eq(auctions.competitionId, row.id))
      .limit(1),
    teamsOf(systemDb, row.id),
    publishedSchedule(systemDb, row.id),
  ]);
  return {
    name: row.name,
    slug: row.slug,
    sport: row.sport,
    status: row.status,
    entryCategory: row.entryCategory,
    location: row.location,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    orgName: row.orgName,
    open,
    // Not `row.visibility === "public"` — the gate above already refused
    // anything else, and the compiler now says so. The literal is the point:
    // this view cannot exist for an unpublished competition.
    listed: true,
    logoUrl: row.logoKey === null ? null : storage.readUrl(row.logoKey),
    coverUrl: row.coverKey === null ? null : storage.readUrl(row.coverKey),
    auctionStatus: auctionRows[0]?.status ?? null,
    ...publicAuctionRules(auctionRows[0]?.config),
    auctionUnit: row.auctionUnit,
    teams,
    fixtures: fixtures.rows.map(toPublicFixture),
    // Carried so the page can say "showing 500 of 640" rather than presenting a
    // truncated list under a heading that claims to be the whole schedule.
    fixtureTotal: fixtures.total,
  };
}

export interface ShowcasePlayer {
  /**
   * The registration's id — the avatar SEED, so the initials mark this player
   * wears here is the one they wear on the organizer's desk and in the live
   * room. Already public on /spectate (`ResolvedLot.registrationId`); it names
   * a season entry, not a person, and unlocks nothing without a grant.
   */
  registrationId: string;
  number: string;
  name: string;
  role: string | null;
  age: number | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  /**
   * The season's OTHER optional detail, already labelled by its sport pack.
   *
   * Cricket's two styles keep the named fields above — they predate the
   * registry and have consumers of their own. Every sport since writes here,
   * and until now the public card had no way to show a footballer's preferred
   * foot because nothing collected it and nothing read it.
   */
  attributes: { key: string; label: string; value: string }[];
  /** Consent-gated (null unless photo_consent_at is set — DPDP §5). */
  photoUrl: string | null;
  /**
   * DA-17: "retained" is a third outcome, not a flavour of sold. Pre-signed
   * icons were counted as SOLD before a single lot opened, so a public page
   * announced "4 sold" on a competition whose auction had not started.
   */
  status: "available" | "sold" | "retained";
  /** Why a `retained`-status player skipped the auction — the word to print. */
  preSignedAs: PreSignedKind | null;
  teamName: string | null;
  /**
   * What the room paid, in the season's unit ×100 — null for anyone not sold
   * at auction (in the pool, pre-signed, passed). Public since the founder's
   * 2026-09-24 decision that made the price the thing a player card shares;
   * the season page carries it so a squad card can lead with its top buy
   * instead of whoever happened to register first.
   */
  soldPrice: number | null;
}

interface ShowcaseRow {
  registrationId: string;
  number: string;
  name: string | null;
  role: string | null;
  dateOfBirth: string | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  attributes: unknown;
  photoKey: string | null;
  photoConsentAt: Date | null;
  teamId: string | null;
  teamName: string | null;
  preSigned: boolean;
  isIcon: boolean;
  isCaptain: boolean;
  isRetained: boolean;
  soldPrice?: number | null;
}

/**
 * Pre-signed and NOT sold: any of the three marks (`preSignedSql`), minus a
 * captain the room bought and the organizer named afterwards — that player's
 * public outcome is the sale.
 */
const showcasePreSigned = sql<boolean>`(${preSignedSql} and not exists (select 1 from ${lots} where ${lots.registrationId} = ${registrations.id} and ${lots.status} = 'sold'))`;

/**
 * The hammer price, when there was one: the registration's SOLD lot in a
 * season auction that was not abandoned. One sold lot per registration per
 * auction, and a season has one live auction, so `max` only makes the
 * subquery scalar — it never picks between two sales. `::float8` because a
 * raw bigint comes back from the driver as a STRING, and every consumer
 * does arithmetic on it (a ₹2 Cr purse ×100 overflows `int`).
 */
const showcaseSoldPrice = sql<
  number | null
>`(select max(${lots.soldPrice}) from ${lots} inner join ${auctions} on ${auctions.id} = ${lots.auctionId} where ${lots.registrationId} = ${registrations.id} and ${lots.status} = 'sold' and ${auctions.status} <> 'abandoned')::float8`;

/**
 * The stored photo KEY a public surface may render, or null — the same two
 * gates `toShowcasePlayer` applies to `photoUrl` (consent AND a known adult),
 * for the one caller that needs bytes rather than a URL: the share card inlines
 * the image because the rasterizer cannot fetch a relative path.
 *
 * P0-6: `mayPublishPhoto`, not `!isMinor` — an unknown DOB (every CSV import
 * row) withholds the face. The AGE below keeps `isMinor`, which is right for an
 * age: with no date there is none to publish.
 */
function publicPhotoKey(r: ShowcaseRow, now: Date): string | null {
  return mayPublishPhoto(r.dateOfBirth, now) && r.photoConsentAt !== null ? r.photoKey : null;
}

/**
 * Row → public player: consent-gates the photo, derives age, maps squad→status.
 *
 * Status was derived from `team_id` alone, so an APPROVED ICON with no team yet
 * was published as "Available" — on the page, in the <title>, in the meta
 * description and on the share card someone forwards to a WhatsApp group. It is
 * not available: `auctionReady` filters pre-signed players out of the pool
 * (`server/auction/auction-ready.ts`, `isPreSigned`), so no team can bid for
 * them in any auction this platform will ever run. The pre-signed flag is
 * checked FIRST because it is the fact that decides biddability; the team
 * assignment only decides which name to print.
 */
function toShowcasePlayer(r: ShowcaseRow, now: Date, sport: string): ShowcasePlayer {
  // PRR P0-2 (DPDP Act 2023 §9): a minor's personal data may not be published on
  // a public, unauthenticated surface. This is the one chokepoint the public
  // player page AND the OG/Twitter share card both read, so suppressing the
  // derived age and photo here removes a child's data from every public surface
  // at once — regardless of any photo consent an adult would have given. The
  // organizer still sees the full roster on the authenticated, capability-gated
  // review screens; only public exposure is withheld.
  const minor = isMinor(r.dateOfBirth, now);
  const photoKey = publicPhotoKey(r, now);
  return {
    registrationId: r.registrationId,
    number: r.number,
    name: r.name ?? "Unnamed",
    role: r.role,
    age: minor ? null : deriveAge(r.dateOfBirth, now),
    battingStyle: r.battingStyle,
    bowlingStyle: r.bowlingStyle,
    // Nothing here is a minor's data: these are playing facts, not identity,
    // and they sit outside the `minor` gate for the same reason `role` does.
    attributes: describeAttributes(
      sport,
      (r.attributes ?? {}) as Readonly<Record<string, unknown>>,
    ),
    photoUrl: photoKey === null ? null : storage.readUrl(photoKey),
    status: r.preSigned ? "retained" : r.teamId === null ? "available" : "sold",
    preSignedAs: r.preSigned ? preSignedKind(r) : null,
    teamName: r.teamName,
    // A pre-signed player's public outcome is the mark, not a price.
    soldPrice: r.preSigned ? null : (r.soldPrice ?? null),
  };
}

/**
 * How many approved players one public page will carry. A player serialises to
 * ~1.83 KB in the RSC payload, so the unbounded query behind this page shipped
 * ~800 KB for a 400-player pool — the maximum a Pro Pass allows — in a single
 * response, on a surface whose whole audience is on a phone on mobile data.
 *
 * 200 is a budget (~370 KB), not a fact about any tournament, which is exactly
 * why it may never be applied silently. A bare LIMIT does not make the page
 * fast, it makes the page WRONG: the grid would announce "200 players", the
 * filter chips would count 200, the CSV would export 200, and a pool of 412
 * would be misreported to every visitor with no way for them to know. The pool
 * size is therefore fetched alongside the rows and travels with them.
 */
const SHOWCASE_PAGE_LIMIT = 200;

/**
 * The approved pool as one public page can honestly present it: the rows it
 * loaded, the size of the pool they came from, and whether those are the same
 * number. `truncated` is not a nicety — every count, filter and export on the
 * page is computed over `players`, so it is the only thing that stops those
 * numbers being read as statements about the tournament.
 */
export interface ShowcasePool {
  /** Loaded players, registration-number order — at most SHOWCASE_PAGE_LIMIT. */
  players: ShowcasePlayer[];
  /** Approved players in the pool, whether or not they are in `players`. */
  total: number;
  /** `total > players.length` — this page is a prefix of the pool, not the pool. */
  truncated: boolean;
}

/**
 * Public pre-auction showcase (parity §3.3): the APPROVED player pool for a
 * public/open competition. Anonymous, system-pool. Never exposes phones (C-23)
 * or non-approved registrations; photos are consent-gated. `status` reflects
 * persisted squad assignment (assigned = sold); live snapshot status is a P2
 * enhancement.
 */
export async function publicShowcase(slug: string): Promise<ShowcasePool | null> {
  const [comp] = await systemDb
    .select({
      id: competitions.id,
      visibility: competitions.visibility,
      // The season's sport, so its own attributes can be labelled in its own
      // words rather than dropped for want of a dictionary.
      sport: competitions.sport,
    })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (comp === undefined) {
    return null;
  }
  if (comp.visibility !== "public") {
    return null;
  }
  const now = new Date();
  const rows = await systemDb
    .select({
      registrationId: registrations.id,
      number: registrations.registrationNumber,
      name: shownName,
      role: registrations.role,
      dateOfBirth: registrations.dateOfBirth,
      battingStyle: registrations.battingStyle,
      bowlingStyle: registrations.bowlingStyle,
      attributes: registrations.attributes,
      photoKey: shownPhotoKey,
      photoConsentAt: shownPhotoConsentAt,
      teamId: registrations.teamId,
      teamName: teams.name,
      preSigned: showcasePreSigned,
      isIcon: registrations.isIcon,
      isCaptain: registrations.isCaptain,
      isRetained: registrations.isRetained,
      soldPrice: showcaseSoldPrice,
      // The pool size, carried on every row. `count(*) over ()` is evaluated
      // before LIMIT, so it counts the whole approved set — one query rather
      // than a second round trip, and there is no window in which the rows and
      // the count could describe different states of the table.
      poolSize: sql<number>`count(*) over ()::int`,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(and(eq(registrations.competitionId, comp.id), eq(registrations.status, "approved")))
    .orderBy(asc(registrations.registrationNumber), asc(registrations.id))
    .limit(SHOWCASE_PAGE_LIMIT);
  // No rows means an empty pool, not a missing count: `count(*) over ()` has no
  // row to ride on when the set is empty.
  const total = rows[0]?.poolSize ?? 0;
  return {
    players: rows.map((r) => toShowcasePlayer(r, now, comp.sport)),
    total,
    truncated: total > rows.length,
  };
}

export interface PublicPlayer extends ShowcasePlayer {
  competitionName: string;
  competitionSlug: string;
  /**
   * The season's sport, so the page can name this player's role the way the
   * sport does. It called `roleLabel`, which asks cricket and falls back to the
   * key with its underscores swapped — so a footballer's public card, the one
   * a club actually shares, read "midfielder" in a line of Title Case.
   */
  sport: string;
  /** Registration is open on this competition. A stranger who lands on a
   *  friend's card had no way to join the same tournament — this is what lets
   *  the page offer one, and only when the door is actually open. */
  competitionOpen: boolean;
  /**
   * PI-1: the same person's other appearances — SAME ORG, PUBLISHED seasons,
   * approved registrations only. Each season's own publication consent covers
   * its own card (the consent is per-registration), and cross-ORG history
   * stays off public pages entirely (doc 38: that needs the person's consent).
   */
  alsoPlayedIn: { competitionName: string; competitionSlug: string; playerNumber: string }[];
}

/**
 * A single approved player for the public profile + share card
 * (`/c/[slug]/p/[number]`, parity §Phase 2). Same visibility + consent gates as
 * the showcase; returns null when the competition isn't public or `number` is
 * not an approved player. Carries the competition identity for the card + back
 * link.
 */
export async function publicPlayer(slug: string, number: string): Promise<PublicPlayer | null> {
  return (await publicPlayerCard(slug, number))?.player ?? null;
}

/**
 * The player share card's read (`/c/[slug]/p/[number]` OG + Twitter images):
 * the public player, plus the stored photo key ONLY when the public gate
 * passes (consent recorded, not a minor). Server-side only — the key never
 * reaches a page payload; the image route inlines its bytes.
 */
export async function publicPlayerCard(
  slug: string,
  number: string,
): Promise<{ player: PublicPlayer; photoKey: string | null } | null> {
  const [comp] = await systemDb
    .select({
      id: competitions.id,
      orgId: competitions.orgId,
      name: competitions.name,
      slug: competitions.slug,
      sport: competitions.sport,
      status: competitions.status,
      visibility: competitions.visibility,
    })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (comp === undefined) {
    return null;
  }
  if (comp.visibility !== "public") {
    return null;
  }
  const [row] = await systemDb
    .select({
      personId: registrations.personId,
      registrationId: registrations.id,
      number: registrations.registrationNumber,
      name: shownName,
      role: registrations.role,
      dateOfBirth: registrations.dateOfBirth,
      battingStyle: registrations.battingStyle,
      bowlingStyle: registrations.bowlingStyle,
      attributes: registrations.attributes,
      photoKey: shownPhotoKey,
      photoConsentAt: shownPhotoConsentAt,
      teamId: registrations.teamId,
      teamName: teams.name,
      preSigned: showcasePreSigned,
      isIcon: registrations.isIcon,
      isCaptain: registrations.isCaptain,
      isRetained: registrations.isRetained,
      soldPrice: showcaseSoldPrice,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(
      and(
        eq(registrations.competitionId, comp.id),
        eq(registrations.status, "approved"),
        eq(registrations.registrationNumber, number),
      ),
    )
    .limit(1);
  if (row === undefined) {
    return null;
  }
  // PI-1: other published, approved appearances in the SAME org — newest
  // seasons first, capped so a card stays a card.
  const alsoPlayedIn = await systemDb
    .select({
      competitionName: competitions.name,
      competitionSlug: competitions.slug,
      playerNumber: registrations.registrationNumber,
    })
    .from(registrations)
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .where(
      and(
        eq(registrations.personId, row.personId),
        eq(competitions.orgId, comp.orgId),
        eq(competitions.visibility, "public"),
        eq(registrations.status, "approved"),
        ne(registrations.competitionId, comp.id),
      ),
    )
    .orderBy(desc(competitions.startsOn))
    .limit(6);
  const now = new Date();
  return {
    player: {
      ...toShowcasePlayer(row, now, comp.sport),
      competitionName: comp.name,
      competitionSlug: comp.slug,
      sport: comp.sport,
      competitionOpen: comp.status === "registration_open",
      alsoPlayedIn,
    },
    photoKey: publicPhotoKey(row, now),
  };
}

/**
 * What the public player LINK CARD needs beyond the public player: the verdict,
 * the money, the buying team's colour and crest, and the shirt and lot numbers.
 *
 * Behind exactly the gates of `publicPlayerCard` (published season, approved
 * player; the photo key only when consent is recorded and the player is not a
 * minor) — it starts from that read and only adds to it. The price is public by
 * the founder's decision (2026-09-24): the sale is the thing being shared.
 *
 * `version` changes whenever what the card says changes. It rides the
 * `og:image` URL because WhatsApp keeps a link preview for days: without it, a
 * player shared while in the pool went on previewing as "in the pool" after
 * the hammer fell.
 */
export interface PublicPlayerPoster {
  readonly input: Omit<PlayerPosterInput, "photoUrl" | "teamCrestUrl" | "competitionLogoUrl">;
  readonly photoKey: string | null;
  readonly teamCrestKey: string | null;
  readonly logoKey: string | null;
  readonly version: string;
}

export async function publicPlayerPoster(
  slug: string,
  number: string,
): Promise<PublicPlayerPoster | null> {
  const card = await publicPlayerCard(slug, number);
  if (card === null) {
    return null;
  }
  const { player } = card;
  const [comp] = await systemDb
    .select({
      id: competitions.id,
      logoKey: competitions.logoUrl,
      // A points season's card prints "1,250 pts", never rupees (0091).
      unit: competitions.auctionUnit,
    })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  const [reg] = await systemDb
    .select({
      jerseyNumber: registrations.jerseyNumber,
      isIcon: registrations.isIcon,
      isCaptain: registrations.isCaptain,
      isRetained: registrations.isRetained,
      teamId: registrations.teamId,
    })
    .from(registrations)
    .where(eq(registrations.id, player.registrationId))
    .limit(1);
  if (comp === undefined || reg === undefined) {
    return null;
  }
  const [lot] = await systemDb
    .select({
      status: lots.status,
      soldPrice: lots.soldPrice,
      basePrice: lots.basePrice,
      lotNumber: lots.lotNumber,
      buyerTeamId: paddles.teamId,
    })
    .from(lots)
    .innerJoin(auctions, eq(auctions.id, lots.auctionId))
    .leftJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
    .where(
      and(
        eq(lots.registrationId, player.registrationId),
        eq(auctions.competitionId, comp.id),
        ne(auctions.status, "abandoned"),
      ),
    )
    .limit(1);
  const auctionStatus =
    lot === undefined
      ? ((
          await systemDb
            .select({ status: auctions.status })
            .from(auctions)
            .where(and(eq(auctions.competitionId, comp.id), ne(auctions.status, "abandoned")))
            .limit(1)
        )[0]?.status ?? null)
      : null;
  // A lot the room SOLD outranks every mark — the same rule as the poster.
  const preSigned = lot?.status !== "sold" && isPreSigned(reg);
  const outcome = outcomeOf(preSigned ? preSignedKind(reg) : null, lot?.status, auctionStatus);
  if (outcome === null) {
    return null;
  }
  const teamId = outcome === "pool" ? null : preSigned ? reg.teamId : (lot?.buyerTeamId ?? null);
  const team =
    teamId === null
      ? undefined
      : (
          await systemDb
            .select({ name: teams.name, colour: teams.primaryColor, logoKey: teams.logoUrl })
            .from(teams)
            .where(and(eq(teams.id, teamId), eq(teams.competitionId, comp.id)))
            .limit(1)
        )[0];
  const pricePaise = outcome === "sold" ? (lot?.soldPrice ?? null) : null;
  return {
    input: {
      playerName: player.name,
      number: player.number,
      role: player.role ?? "",
      outcome,
      pricePaise,
      basePricePaise: outcome === "pool" ? (lot?.basePrice ?? null) : null,
      lotNumber: lot?.lotNumber ?? null,
      jerseyNumber: reg.jerseyNumber,
      teamName: team?.name ?? null,
      teamColor: team?.colour ?? null,
      competitionName: player.competitionName,
      unit: comp.unit,
    },
    photoKey: card.photoKey,
    teamCrestKey: team?.logoKey ?? null,
    logoKey: comp.logoKey,
    // Short and opaque; only has to CHANGE when the card would.
    version: [outcome, pricePaise ?? "", teamId ?? "", card.photoKey === null ? 0 : 1]
      .join(".")
      .replace(/[^a-z0-9.]/gi, ""),
  };
}

/**
 * WHAT HAPPENED TO ME AT THE AUCTION — the registration page's own read.
 *
 * A player the room had SOLD came back to `/seasons/<slug>/register` and was
 * told "You're in the player pool … team owners bid to sign you", with a
 * withdraw button under it: the page read the registration row, which stays
 * `approved` for life, and knew nothing of the auction. This is the missing
 * half, derived with the share card's own rules (`outcomeOf`, sold outranks
 * every mark) so the two can never tell one player different stories.
 *
 * NOT a public read, and not behind the visibility gate: a private season's
 * player is owed their own result as much as a public one's. It is keyed by
 * the caller's own `personId` (from the session, never a parameter a stranger
 * controls) and returns only that person's row.
 */
export interface MyAuctionOutcome {
  /**
   * `sold` — bought in the room; `captain`/`icon`/`retained` — signed before
   * it; `passed` — the auction finished without them (lot unsold, or never
   * reached); `pool` — still to come.
   */
  outcome: "sold" | "captain" | "icon" | "retained" | "passed" | "pool";
  teamName: string | null;
  /** `/c/<slug>/t/<teamSlug>` segment — only a published season has the page. */
  teamSlug: string | null;
  /** Hammer price ×100 in `unit`, sold only. */
  pricePaise: number | null;
  unit: MoneyUnit;
  /** The club running the season — who to ask about dropping out. */
  orgName: string;
}

export async function myAuctionOutcome(
  slug: string,
  personId: string,
): Promise<MyAuctionOutcome | null> {
  const [row] = await systemDb
    .select({
      competitionId: competitions.id,
      unit: competitions.auctionUnit,
      orgName: organizations.name,
      registrationId: registrations.id,
      teamId: registrations.teamId,
      isIcon: registrations.isIcon,
      isCaptain: registrations.isCaptain,
      isRetained: registrations.isRetained,
    })
    .from(registrations)
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(
      and(
        eq(competitions.slug, slug),
        eq(registrations.personId, personId),
        eq(registrations.status, "approved"),
      ),
    )
    .limit(1);
  if (row === undefined) {
    return null;
  }
  const [auction] = await systemDb
    .select({ id: auctions.id, status: auctions.status })
    .from(auctions)
    .where(and(eq(auctions.competitionId, row.competitionId), ne(auctions.status, "abandoned")))
    .limit(1);
  const [lot] =
    auction === undefined
      ? []
      : await systemDb
          .select({
            status: lots.status,
            soldPrice: lots.soldPrice,
            buyerTeamId: paddles.teamId,
          })
          .from(lots)
          .leftJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
          .where(and(eq(lots.registrationId, row.registrationId), eq(lots.auctionId, auction.id)))
          .limit(1);
  const preSigned = lot?.status !== "sold" && isPreSigned(row);
  const verdict = outcomeOf(
    preSigned ? preSignedKind(row) : null,
    lot?.status,
    auction?.status ?? null,
  );
  // `outcomeOf` answers null for "a finished auction that never reached
  // them" (and for a withdrawn/frozen lot) — for the player that is the same
  // kind sentence as a pass: the night is over and no team took them.
  const outcome: MyAuctionOutcome["outcome"] =
    verdict === null || verdict === "unsold" ? "passed" : verdict;
  const teamId = outcome === "sold" ? (lot?.buyerTeamId ?? null) : preSigned ? row.teamId : null;
  const [team] =
    teamId === null
      ? []
      : await systemDb
          .select({ name: teams.name })
          .from(teams)
          .where(and(eq(teams.id, teamId), eq(teams.competitionId, row.competitionId)))
          .limit(1);
  return {
    // A "sold" with no team row to name is not a sentence we can finish.
    outcome: outcome === "sold" && team === undefined ? "pool" : outcome,
    teamName: team?.name ?? null,
    teamSlug: team === undefined ? null : teamSlugOf(team.name),
    pricePaise: outcome === "sold" ? (lot?.soldPrice ?? null) : null,
    unit: row.unit,
    orgName: row.orgName,
  };
}

/**
 * THE SEASON'S TOP BUYS — the three biggest sales, for the season page.
 *
 * Behind the season-page gate (published, approved players only) and carrying
 * only what the team page and player card already publish: the name, the
 * number that addresses their page, the price and the buying team.
 */
export interface PublicTopBuy {
  registrationId: string;
  number: string;
  name: string;
  pricePaise: number;
  teamName: string | null;
}

export async function publicTopBuys(slug: string, limit = 3): Promise<PublicTopBuy[]> {
  const [comp] = await systemDb
    .select({ id: competitions.id, visibility: competitions.visibility })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (comp === undefined || comp.visibility !== "public") {
    return [];
  }
  const rows = await systemDb
    .select({
      registrationId: registrations.id,
      number: registrations.registrationNumber,
      name: shownName,
      price: lots.soldPrice,
      teamName: teams.name,
    })
    .from(lots)
    .innerJoin(auctions, eq(auctions.id, lots.auctionId))
    .innerJoin(registrations, eq(registrations.id, lots.registrationId))
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
    .leftJoin(teams, eq(teams.id, paddles.teamId))
    .where(
      and(
        eq(auctions.competitionId, comp.id),
        ne(auctions.status, "abandoned"),
        eq(lots.status, "sold"),
        eq(registrations.status, "approved"),
      ),
    )
    .orderBy(desc(lots.soldPrice), asc(registrations.registrationNumber))
    .limit(limit);
  return rows.map((row) => ({
    registrationId: row.registrationId,
    number: row.number,
    name: row.name ?? "Player",
    pricePaise: row.price ?? 0,
    teamName: row.teamName,
  }));
}

/**
 * THE PUBLIC TEAM — one squad, as a page of its own (`/c/[slug]/t/[team]`).
 *
 * The season page shows a team as a card of names; this is the squad an owner
 * forwards the morning after: every player, what each cost, what the team
 * spent, and the season's purse it spent it from. Sale prices are public here
 * by the founder's decision (2026-09-24) — the same decision the player card
 * made; the season page's own team card still shows names only.
 *
 * Behind the same gates as every public read: a published season, approved
 * registrations only, and a face only when consent is recorded and the player
 * is not a minor (`publicPhotoKey`). The team is addressed by its name's slug,
 * because a URL an owner reads aloud should say the team's name; names are
 * unique within a season, and the first match wins on a slug collision.
 */
export interface PublicTeamMember {
  registrationId: string;
  number: string;
  name: string;
  role: string | null;
  /** Integer paise, or null for a player signed before the auction. */
  pricePaise: number | null;
  marks: PosterMark[];
  photoUrl: string | null;
  /** Storage key behind `photoUrl`, for the image routes to inline. */
  photoKey: string | null;
}

export interface PublicTeam {
  competitionId: string;
  competitionName: string;
  competitionSlug: string;
  sport: string;
  competitionLogoKey: string | null;
  team: {
    id: string;
    name: string;
    slug: string;
    shortName: string | null;
    color: string | null;
    crestKey: string | null;
    crestUrl: string | null;
    coachName: string | null;
  };
  members: PublicTeamMember[];
  spentPaise: number;
  /** The season's published purse per team, when the auction states one. */
  pursePaise: number | null;
  /** What the season's auction counts in (0091): "₹…" or "… pts". */
  unit: MoneyUnit;
  auctionStatus: string | null;
}

/** The address segment for a team: its name, as a slug. */
export function teamSlugOf(name: string): string {
  return slugifyName(name);
}

export async function publicTeam(slug: string, teamSlug: string): Promise<PublicTeam | null> {
  const [comp] = await systemDb
    .select({
      id: competitions.id,
      name: competitions.name,
      sport: competitions.sport,
      visibility: competitions.visibility,
      logoKey: competitions.logoUrl,
      unit: competitions.auctionUnit,
    })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (comp === undefined || comp.visibility !== "public") {
    return null;
  }
  const teamRows = await systemDb
    .select({
      id: teams.id,
      name: teams.name,
      shortName: teams.shortName,
      color: teams.primaryColor,
      crestKey: teams.logoUrl,
      coachName: teams.coachName,
    })
    .from(teams)
    .where(eq(teams.competitionId, comp.id))
    .orderBy(asc(teams.name));
  const team = teamRows.find((row) => teamSlugOf(row.name) === teamSlug);
  if (team === undefined) {
    return null;
  }
  const [auction] = await systemDb
    .select({ id: auctions.id, status: auctions.status, config: auctions.config })
    .from(auctions)
    .where(and(eq(auctions.competitionId, comp.id), ne(auctions.status, "abandoned")))
    .limit(1);

  const member = {
    registrationId: registrations.id,
    number: registrations.registrationNumber,
    name: shownName,
    role: registrations.role,
    dateOfBirth: registrations.dateOfBirth,
    photoKey: shownPhotoKey,
    photoConsentAt: shownPhotoConsentAt,
    isIcon: registrations.isIcon,
    isCaptain: registrations.isCaptain,
    isRetained: registrations.isRetained,
  };
  // Signed before the night, and not bought on it — the poster's own split.
  const preSignedRows = await systemDb
    .select(member)
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(registrations.competitionId, comp.id),
        eq(registrations.teamId, team.id),
        eq(registrations.status, "approved"),
        preSignedSql,
        ...(auction === undefined
          ? []
          : [
              sql`not exists (select 1 from ${lots} where ${lots.registrationId} = ${registrations.id} and ${lots.auctionId} = ${auction.id} and ${lots.status} = 'sold')`,
            ]),
      ),
    )
    .orderBy(asc(shownName));
  const boughtRows =
    auction === undefined
      ? []
      : await systemDb
          .select({ ...member, price: lots.soldPrice })
          .from(lots)
          .innerJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
          .innerJoin(registrations, eq(registrations.id, lots.registrationId))
          .innerJoin(people, eq(people.id, registrations.personId))
          .where(
            and(
              eq(lots.auctionId, auction.id),
              eq(lots.status, "sold"),
              eq(paddles.teamId, team.id),
              eq(registrations.status, "approved"),
            ),
          )
          .orderBy(desc(lots.soldPrice));

  const now = new Date();
  const photo = (row: {
    dateOfBirth: string | null;
    photoConsentAt: Date | null;
    photoKey: string | null;
  }) =>
    mayPublishPhoto(row.dateOfBirth, now) && row.photoConsentAt !== null ? row.photoKey : null;
  const toMember = (
    row: (typeof preSignedRows)[number],
    pricePaise: number | null,
    rowMarks: PosterMark[],
  ): PublicTeamMember => {
    const key = photo(row);
    return {
      registrationId: row.registrationId,
      number: row.number,
      name: row.name ?? "Player",
      role: row.role,
      pricePaise,
      marks: rowMarks,
      photoKey: key,
      photoUrl: key === null ? null : storage.readUrl(key),
    };
  };
  const members = [
    ...preSignedRows.map((row) => toMember(row, null, marksOf(row))),
    ...boughtRows
      .filter((row) => !preSignedRows.some((pre) => pre.registrationId === row.registrationId))
      .map((row) => toMember(row, row.price, row.isCaptain ? ["captain"] : [])),
  ];
  return {
    competitionId: comp.id,
    competitionName: comp.name,
    competitionSlug: slug,
    sport: comp.sport,
    competitionLogoKey: comp.logoKey,
    team: {
      id: team.id,
      name: team.name,
      slug: teamSlug,
      shortName: team.shortName,
      color: team.color,
      crestKey: team.crestKey,
      crestUrl: team.crestKey === null ? null : storage.readUrl(team.crestKey),
      coachName: team.coachName,
    },
    members,
    spentPaise: boughtRows.reduce((total, row) => total + (row.price ?? 0), 0),
    pursePaise: publicAuctionRules(auction?.config).pursePerTeam,
    unit: comp.unit,
    auctionStatus: auction?.status ?? null,
  };
}

export interface DirectoryEntry {
  name: string;
  slug: string;
  orgName: string;
  /** PI-1: organizer-declared category ("Women's" badge; `open` renders nothing). */
  entryCategory: "open" | "men" | "women" | "mixed";
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  open: boolean;
  logoUrl: string | null;
  /** The season's cover photo (0082), for the card's banner. */
  coverUrl: string | null;
  /** The season's sport — the card's tag, and which art it falls back to. */
  sport: string;
  /** Teams entered. A card that says "8 teams · 64 players" describes an event;
   *  one that says neither describes a row in a table. */
  teamCount: number;
  /** The auction's lifecycle status, or null when no auction exists yet. */
  auctionStatus: string | null;
  /**
   * Watchable by anyone, right now. The directory could not say this at all
   * before: it never selected auction status, so the single highest-conversion,
   * lowest-commitment action on the platform — watching a live auction with no
   * account — was invisible one click above the page that offers it.
   */
  live: boolean;
  /**
   * Registered players. The directory shows every published season regardless —
   * a new one legitimately has none. It is the LANDING rail that uses this, as
   * a substance bar: an empty season is not evidence that the platform works,
   * and the front page is where that evidence is supposed to be.
   */
  playerCount: number;
}

/** URL-backed facets. Anything else in `?filter=` / `?sort=` falls back to the
 *  default rather than erroring — a hand-typed or stale link still renders. */
export type DirectoryFilter = "all" | "open" | "live" | "upcoming" | "closed";
export type DirectorySort = "opportunity" | "soon" | "name";

export function parseDirectoryFilter(raw: string | undefined): DirectoryFilter {
  return raw === "open" || raw === "live" || raw === "upcoming" || raw === "closed" ? raw : "all";
}

export function parseDirectorySort(raw: string | undefined): DirectorySort {
  return raw === "soon" || raw === "name" ? raw : "opportunity";
}

/** Facet counts over the SEARCH alone, so the chips can say what switching to
 *  them would actually yield (and never advertise an empty filter). */
export interface DirectoryCounts {
  all: number;
  open: number;
  live: number;
  /** Registration is shut and the first day has not arrived: it is coming. */
  upcoming: number;
  /** Shut, and either under way or already run. */
  closed: number;
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  page: number;
  totalPages: number;
  /** Rows matching the search AND the active filter. */
  total: number;
  counts: DirectoryCounts;
  /** Every published competition, search and facet ignored. The empty states
   *  have to offer a way back to the whole directory and say how big it is —
   *  a count taken inside a search that matched nothing would read "all 0". */
  catalogue: number;
  filter: DirectoryFilter;
  sort: DirectorySort;
}

const DIRECTORY_PAGE_SIZE = 12;

/**
 * The competition's auction status as a correlated scalar rather than a LEFT
 * JOIN. Nothing in the schema stops a competition owning more than one auction
 * row, and one duplicated competition row silently corrupts LIMIT/OFFSET
 * paging — page 2 would repeat page 1's tail. This keeps the directory at
 * strictly one row per competition, whatever the auction table holds.
 */
const latestAuctionStatus = sql<string | null>`(
    select ${auctions.status}
    from ${auctions}
    where ${auctions.competitionId} = ${competitions.id}
    order by ${auctions.createdAt} desc
    limit 1
  )`;

/**
 * How long an auction may go silent and still be called LIVE in public.
 *
 * An auction night runs a few hours; a paused one might sit through a dinner
 * break or, at the outside, overnight while the hall is re-booked. Beyond a
 * day, "live" is not a description of anything a visitor could watch.
 */
const LIVE_SILENCE_MS = 24 * 60 * 60 * 1000;

/** When the engine last confirmed anything at all for this competition. */
const latestAuctionEventMs = sql<number | null>`(
    select max(${auctionEvents.atMs})
    from ${auctionEvents}
    join ${auctions} on ${auctions.id} = ${auctionEvents.auctionId}
    where ${auctions.competitionId} = ${competitions.id}
  )`;

/**
 * LIVE MEANS SOMETHING IS HAPPENING, NOT THAT A COLUMN SAYS SO.
 *
 * This was `status in ('live','paused')` and nothing else, so an auction that
 * was opened and never closed — a laptop that died, a night that was abandoned,
 * a test run — announced itself as LIVE NOW on the public directory for ever.
 * Three consequences, all of them public: the badge is a false claim, the
 * "Live now" facet count is a false number, and the default sort puts those
 * seasons ABOVE the ones that really are live, which is the opposite of what
 * that sort exists to do.
 *
 * The event log already knows. Every accepted command appends a row carrying
 * the engine's own timestamp, so the last event IS the last sign of life. A
 * status of live or paused with a day's silence behind it is a stalled auction,
 * and a visitor is told nothing rather than told wrongly.
 *
 * A DISPLAY test and deliberately nothing more: the auction is untouched and a
 * conductor can still resume a three-day-old pause. What changes is that the
 * public stops advertising it as watchable.
 */
const isLive = sql<boolean>`(
    ${latestAuctionStatus} in ('live', 'paused')
    and ${latestAuctionEventMs} is not null
    and ${latestAuctionEventMs} > ${sql.raw(String(Date.now() - LIVE_SILENCE_MS))}
  )`;

/** Competitions whose organizers PUBLISHED them (visibility='public'). */
export async function publicCompetitionsDirectory(params: {
  q?: string;
  page?: number;
  filter?: DirectoryFilter;
  sort?: DirectorySort;
}): Promise<DirectoryPage> {
  const filter = params.filter ?? "all";
  const sort = params.sort ?? "opportunity";
  const published = eq(competitions.visibility, "public");
  const term = params.q?.trim();
  const search =
    term === undefined || term === ""
      ? undefined
      : or(
          ilike(competitions.name, containsPattern(term)),
          ilike(competitions.location, containsPattern(term)),
          ilike(organizations.name, containsPattern(term)),
        );
  // The search predicate WITHOUT the facet: the chip counts have to describe
  // the facets a visitor could switch TO, not the one already applied.
  const searchWhere = search === undefined ? published : and(published, search);
  // Competition dates are bare, IST-implied dates (doc 05). A UTC "today" would
  // still call an Indian tournament upcoming for the first 5½ hours of its
  // opening day.
  const istToday = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  /** Shut to registrations, not being auctioned, and its first day is ahead. */
  const isUpcoming = sql<boolean>`(
    ${competitions.status} <> 'registration_open'
    and not ${isLive}
    and ${competitions.startsOn} is not null
    and ${competitions.startsOn} > ${istToday}
  )`;
  const facet =
    filter === "open"
      ? eq(competitions.status, "registration_open")
      : filter === "live"
        ? isLive
        : filter === "upcoming"
          ? isUpcoming
          : filter === "closed"
            ? sql<boolean>`(${competitions.status} <> 'registration_open' and not ${isLive} and not ${isUpcoming})`
            : undefined;
  const where = facet === undefined ? searchWhere : and(searchWhere, facet);
  // One pass over the published set yields the catalogue size and all three
  // chip counts. FILTER (WHERE …) is parenthesised before the ::int cast —
  // unparenthesised, the cast binds inside the filter clause, not to the
  // aggregate.
  const matches = search ?? sql`true`;
  const [countRow] = await systemDb
    .select({
      catalogue: sql<number>`count(*)::int`,
      all: sql<number>`(count(*) filter (where ${matches}))::int`,
      open: sql<number>`(count(*) filter (where ${matches} and ${competitions.status} = 'registration_open'))::int`,
      live: sql<number>`(count(*) filter (where ${matches} and ${isLive}))::int`,
      upcoming: sql<number>`(count(*) filter (where ${matches} and ${isUpcoming}))::int`,
      closed: sql<number>`(count(*) filter (where ${matches}
        and ${competitions.status} <> 'registration_open'
        and not ${isLive}
        and not ${isUpcoming}))::int`,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(published);
  const counts: DirectoryCounts = {
    all: countRow?.all ?? 0,
    open: countRow?.open ?? 0,
    live: countRow?.live ?? 0,
    upcoming: countRow?.upcoming ?? 0,
    closed: countRow?.closed ?? 0,
  };
  const total = counts[filter];
  const page = Math.max(params.page ?? 1, 1);
  const rows = await systemDb
    .select({
      name: competitions.name,
      slug: competitions.slug,
      status: competitions.status,
      entryCategory: competitions.entryCategory,
      location: competitions.location,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
      orgName: organizations.name,
      logoKey: competitions.logoUrl,
      coverKey: competitions.coverUrl,
      sport: competitions.sport,
      teamCount: sql<number>`(select count(*)::int from ${teams}
        where ${teams.competitionId} = ${competitions.id})`,
      auctionStatus: latestAuctionStatus,
      // The row's own badge must agree with the facet count and the sort that
      // placed it — three renderings of one question, answered once.
      live: isLive,
      playerCount: sql<number>`(select count(*)::int from ${registrations}
        where ${registrations.competitionId} = ${competitions.id})`,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(where)
    .orderBy(...directoryOrder(sort, istToday))
    .limit(DIRECTORY_PAGE_SIZE)
    .offset((page - 1) * DIRECTORY_PAGE_SIZE);
  return {
    entries: rows.map((row) => ({
      name: row.name,
      slug: row.slug,
      orgName: row.orgName,
      entryCategory: row.entryCategory,
      location: row.location,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      open: row.status === "registration_open",
      logoUrl: row.logoKey === null ? null : storage.readUrl(row.logoKey),
      coverUrl: row.coverKey === null ? null : storage.readUrl(row.coverKey),
      sport: row.sport,
      teamCount: row.teamCount,
      auctionStatus: row.auctionStatus,
      live: row.live,
      playerCount: row.playerCount,
    })),
    page,
    totalPages: Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE)),
    total,
    counts,
    catalogue: countRow?.catalogue ?? 0,
    filter,
    sort,
  };
}

/**
 * The default used to be `startsOn ASC` — which leads with the EARLIEST
 * starting, i.e. the oldest and most likely finished, tournaments, and then
 * Postgres's ASC NULLS LAST buries every date-not-yet-announced competition
 * below them. A visitor's first screen was the least actionable half of the
 * directory. "opportunity" buckets by what a guest can do about a row — watch
 * it, join it, wait for it, read about it — and only orders by date inside a
 * bucket. The other two sorts are opt-in and do exactly what their labels say.
 */
function directoryOrder(sort: DirectorySort, istToday: string): SQL[] {
  const byDate = sql`${competitions.startsOn} asc nulls last`;
  const byId = sql`${competitions.id} asc`;
  if (sort === "soon") {
    return [byDate, byId];
  }
  if (sort === "name") {
    return [sql`${competitions.name} asc`, byId];
  }
  return [
    sql`case
          when ${isLive} then 0
          when ${competitions.status} = 'registration_open' then 1
          when ${competitions.startsOn} is null or ${competitions.startsOn} >= ${istToday} then 2
          else 3
        end asc`,
    byDate,
    byId,
  ];
}

export interface MyRegistration {
  /** The subject of this person's own poster — see `posterReady`. */
  registrationId: string;
  competitionName: string;
  competitionSlug: string;
  /** The season's sport — so /home can link to the right career page. */
  sport: string;
  orgName: string;
  status: string;
  role: string | null;
  number: string;
  open: boolean;
  /**
   * Whether a card exists to be made of this registration.
   *
   * The same rule `playerPosterSource` draws by (`outcomeOf`): a verdict once
   * the auction has one, and before it, the "in the pool" card — the one a
   * player posts to bring bidders into the room. Mirrored here so /home offers
   * the link exactly where the route would answer with a picture: not to a
   * pending registration, a withdrawn lot, or a finished auction that never
   * reached them.
   */
  posterReady: boolean;
  /**
   * What the night decided for this person, in the same shape /me reads
   * (`CareerSeason.auction`) so /home can say it with the same words — "Sold ·
   * 50,000 pts" — instead of the registration's bare "approved", which was all
   * a sold player's home told them. The sale wins over a pre-signed mark, as it
   * does on the career page.
   */
  auction:
    { kind: PreSignedKind } | { kind: "sold"; soldPrice: number } | { kind: "unsold" } | null;
  /** What `auction.soldPrice` counts in (0091) — rupees or points. */
  auctionUnit: MoneyUnit;
  /** The team this person plays for — sold to, or named captain/icon of. */
  teamName: string | null;
  /** That team's own colour, for its chip; null when the club set none. */
  teamColor: string | null;
}

/** The person's registrations across every competition — the player lens.
 * Person-scoped cross-org listing on the system pool (PRP-1 documented class).
 *
 * Memoised per request with React `cache`: the root layout, /home and
 * PlayerHome all ask for it in one render, and each used to run it again. */
export const myRegistrations = cache(async function myRegistrations(
  personId: string,
): Promise<MyRegistration[]> {
  const rows = await systemDb
    .select({
      registrationId: registrations.id,
      competitionName: competitions.name,
      competitionSlug: competitions.slug,
      sport: competitions.sport,
      orgName: organizations.name,
      status: registrations.status,
      role: registrations.role,
      number: registrations.registrationNumber,
      competitionStatus: competitions.status,
      isIcon: registrations.isIcon,
      isCaptain: registrations.isCaptain,
      isRetained: registrations.isRetained,
      lotStatus: lots.status,
      soldPrice: lots.soldPrice,
      auctionStatus: auctions.status,
      auctionUnit: competitions.auctionUnit,
      teamName: teams.name,
      teamColor: teams.primaryColor,
    })
    .from(registrations)
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .innerJoin(people, eq(people.id, registrations.personId))
    // The registration's own team: the completed auction writes the buyer here
    // (and a captain/icon is placed here before it), so it is the one answer
    // to "whose am I?" — the same join the career page makes.
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    /*
     * The lot is joined THROUGH its auction and only the one that counts.
     * Migration 0029 permits at most one non-abandoned auction per competition
     * but abandoned ones accumulate without limit, each carrying a lot per
     * registration — so an unscoped join on `lots.registrationId` would list a
     * season twice for anyone whose organizer aborted a night and started
     * again, the second time carrying a verdict from an auction nobody ran to
     * the end. (The poster picker documents the same trap.)
     */
    .leftJoin(
      auctions,
      and(
        eq(auctions.competitionId, registrations.competitionId),
        ne(auctions.status, "abandoned"),
      ),
    )
    .leftJoin(lots, and(eq(lots.registrationId, registrations.id), eq(lots.auctionId, auctions.id)))
    .where(eq(registrations.personId, personId))
    .orderBy(asc(competitions.startsOn), asc(registrations.id));
  return rows.map((row) => ({
    registrationId: row.registrationId,
    competitionName: row.competitionName,
    competitionSlug: row.competitionSlug,
    sport: row.sport,
    orgName: row.orgName,
    status: row.status,
    role: row.role,
    number: row.number,
    open: row.competitionStatus === "registration_open",
    posterReady:
      row.status === "approved" &&
      outcomeOf(
        row.lotStatus !== "sold" && isPreSigned(row) ? preSignedKind(row) : null,
        row.lotStatus ?? undefined,
        row.auctionStatus,
      ) !== null,
    auctionUnit: row.auctionUnit,
    teamName: row.teamName,
    teamColor: row.teamColor,
    auction:
      row.lotStatus === "sold" && row.soldPrice !== null
        ? { kind: "sold", soldPrice: row.soldPrice }
        : isPreSigned(row)
          ? { kind: preSignedKind(row) ?? "icon" }
          : row.lotStatus === "unsold"
            ? { kind: "unsold" }
            : null,
  }));
});

/** PX-6 fix: the sitemap carries EVERY published competition, not one page. */
export async function publicCompetitionSlugs(limit = 5000): Promise<string[]> {
  const rows = await systemDb
    .select({ slug: competitions.slug })
    .from(competitions)
    .where(eq(competitions.visibility, "public"))
    .orderBy(asc(competitions.id))
    .limit(limit);
  return rows.map((row) => row.slug);
}
