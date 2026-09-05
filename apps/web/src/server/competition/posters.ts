import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_AUCTION_CONFIG,
  isTier,
  isValidMediaKey,
  slugifyName,
  type AuctionConfig,
  type PlayerPosterInput,
  type PosterOutcome,
  type PosterSize,
  type PosterTheme,
  type TeamPosterInput,
  type TeamPosterMember,
} from "@desiauction/core";
import {
  auctionOwnerInvites,
  auctions,
  auditLog,
  competitions,
  lots,
  newId,
  paddles,
  people,
  registrations,
  teams,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { storage } from "../media";
import { canCompetition } from "./authz";
import { competitionForRegistration, resolveCompetition } from "./competitions";

/**
 * THE POSTER'S SERVER SIDE — the gate, the join, and the evidence.
 *
 * A poster is a durable file of a civilian's face, name and price. This codebase
 * has already had this argument once and settled it: two anonymous "Download
 * CSV" buttons were DELETED from the public showcase because a public page has
 * no actor to name in an audit row (see `c/[slug]/showcase-grid.tsx`, and
 * `recordRegistrationExport` in `registrations.ts` for the rule it cites —
 * "an export is the one read that produces a durable artefact, and it was the
 * only one that wrote no evidence").
 *
 * A poster is exactly that read. So it lives behind the SAME three gates as the
 * registrant CSV — a session, org membership, and `registration.review` — and
 * writes the same kind of row before the bytes are rendered. The capability is
 * not a new one: `registration.review` is already the permission to take
 * registrant personal data out of the system in a portable form, and a poster
 * is that with better typography.
 */

export interface PosterRefusal {
  readonly ok: false;
  readonly status: number;
  readonly message: string;
}

export interface PosterSource<T> {
  readonly ok: true;
  readonly input: T;
  /** Tier-gated: the free tier carries the DesiAuction strip, paid passes do not. */
  readonly showBranding: boolean;
  /** Filename used when the caller asked for a download. */
  readonly filename: string;
}

export type PosterResult<T> = PosterSource<T> | PosterRefusal;

interface PosterRequest {
  readonly theme: PosterTheme;
  readonly size: PosterSize;
}

/**
 * WHO MAY MAKE WHICH POSTER.
 *
 * Three ways in, and only the first is a capability. The other two are
 * RELATIONSHIPS — the first authorization in this codebase that is not "what key
 * do you hold" but "who are you to this row" — and they exist because the whole
 * point of a poster is that the person on it posts it. `viewer` is the empty
 * capability set (`packages/core/src/capabilities.ts`), so a player and a team
 * owner hold nothing at all; gating posters on `registration.review` alone meant
 * the sharing loop only ever worked if the organizer generated every card by
 * hand and sent it on.
 *
 * A relationship grants ONE subject, never a category. A player earns their own
 * card, an owner earns their own squad sheet, and neither earns anybody else's —
 * which is why this is a list of ids rather than a boolean, and why every source
 * function checks membership of that list rather than re-deriving the rule.
 */
interface PosterGrant {
  /** `registration.review` over this season: every player, every team. */
  readonly organizer: boolean;
  /** Registrations this person IS. Their own card, and no other. */
  readonly ownRegistrationIds: readonly string[];
  /** Teams this person owns. Their own squad sheet, and no other. */
  readonly ownTeamIds: readonly string[];
}

interface Gate {
  readonly personId: string;
  readonly competition: { id: string; orgId: string; slug: string; name: string };
  readonly logoKey: string | null;
  readonly showBranding: boolean;
  readonly grant: PosterGrant;
}

/**
 * THE REGISTRATIONS THIS PERSON IS.
 *
 * Read under a tenant context carrying `personId` and NO org, on purpose. The
 * `registrations_tenant` policy admits a row when `org_id` matches the session's
 * org OR `person_id` matches the session's person; with no org set the first
 * disjunct is NULL and the database itself returns nothing but this person's own
 * rows. The `eq(person_id)` predicate below is therefore the second lock on the
 * same door — if it were ever dropped in a refactor, RLS would still refuse.
 */
async function ownRegistrationsIn(personId: string, competitionId: string): Promise<string[]> {
  const rows = await withTenantDb(dbHandle, { personId }, (db) =>
    db
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.competitionId, competitionId),
          eq(registrations.personId, personId),
          // A poster asserts a verdict about an accepted player. A withdrawn or
          // rejected registration is not one, and its holder is not owed a card
          // saying otherwise.
          eq(registrations.status, "approved"),
        ),
      ),
  );
  return rows.map((row) => row.id);
}

/**
 * THE TEAMS THIS PERSON OWNS.
 *
 * The same rule the Teams workspace prints under `ownerName` (DA-32): the owner
 * of a team is whoever HOLDS ITS PADDLE, else whoever accepted its owner invite.
 * One rule, read in two places — a product that answered "who owns this team"
 * differently for a label and for an access decision would be answering it
 * wrongly in one of them.
 *
 * It differs from the label in one respect, deliberately: a REVOKED invitation
 * grants nothing. The card can afford to keep printing a name that was once
 * real; an authorization cannot.
 *
 * Requires org context, because `paddles` and `auctions` are org-scoped with no
 * person disjunct. That is not a limitation in practice — `acceptOwnerJoin`
 * makes every accepted owner a viewer-level member of the org — and it buys the
 * invariant that org context is never established for a non-member.
 */
export async function ownTeamsIn(
  personId: string,
  competition: { id: string; orgId: string },
): Promise<string[]> {
  return withTenantDb(dbHandle, { personId, orgId: competition.orgId }, (db) =>
    ownedTeamIdsOn(db, personId, competition.id),
  );
}

/**
 * The query, on a connection the caller already holds.
 *
 * Separated because `withTenantDb` opens a TRANSACTION: a caller already inside
 * one — the auction dashboard, deciding whether to offer the poster button —
 * would otherwise hold a second pooled connection nested inside its first for
 * the length of the outer read. The org context such a caller carries is the
 * same one this would have set.
 */
export async function ownedTeamIdsOn(
  db: Db,
  personId: string,
  competitionId: string,
): Promise<string[]> {
  const [held, accepted] = await Promise.all([
    db
      .select({ teamId: paddles.teamId })
      .from(paddles)
      .innerJoin(auctions, eq(auctions.id, paddles.auctionId))
      .where(
        and(
          eq(paddles.personId, personId),
          isNull(paddles.releasedAt),
          eq(auctions.competitionId, competitionId),
          ne(auctions.status, "abandoned"),
        ),
      ),
    db
      .select({ teamId: auctionOwnerInvites.teamId })
      .from(auctionOwnerInvites)
      .innerJoin(auctions, eq(auctions.id, auctionOwnerInvites.auctionId))
      .where(
        and(
          eq(auctionOwnerInvites.acceptedBy, personId),
          isNull(auctionOwnerInvites.revokedAt),
          eq(auctions.competitionId, competitionId),
          ne(auctions.status, "abandoned"),
        ),
      ),
  ]);
  return [...new Set([...held, ...accepted].map((row) => row.teamId))];
}

/**
 * Session → who you are here → what that earns you.
 *
 * The refusals are deliberately unequal. A MEMBER who holds no key and owns
 * nothing gets 403: they can already see this season exists on every other
 * console surface, so a 404 would be a fiction. Everyone else gets 404 — whether
 * this org runs a season called `mumbai-corporate-2026` is not a fact an
 * outsider gets to confirm by reading a status code.
 */
async function gate(slug: string): Promise<Gate | PosterRefusal> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, status: 401, message: "Sign in to generate posters." };
  }
  return posterGateFor(session.personId, slug);
}

/**
 * The decision itself, given a person.
 *
 * Split from `gate` so the whole of it can be exercised without a cookie jar:
 * `currentSession` reads `next/headers`, which exists only inside a request, and
 * an authorization rule that can only be tested through an HTTP round trip is an
 * authorization rule that does not get tested. Everything above this line is
 * "who is asking"; everything below is "what may they have".
 */
export async function posterGateFor(personId: string, slug: string): Promise<Gate | PosterRefusal> {
  /*
   * A player need not be a member of the club whose season they played in, and
   * most are not — `resolveCompetition` joins `org_members` and would 404 them
   * out of their own card. So membership is looked up as a FACT here rather
   * than used as the gate, and the slug is resolved without it when it is
   * absent. `competitionForRegistration` is the existing no-membership lookup
   * (it is what the public registration link already uses); nothing personal
   * comes back from it, and what does is what /c/[slug] prints in public.
   */
  const member = await resolveCompetition(systemDb, personId, slug);
  const open = member === null ? await competitionForRegistration(systemDb, slug) : null;
  // Four fields, named one at a time. The two sources have different shapes and
  // a spread-plus-cast would have compiled just as well the day one of them
  // stopped carrying `orgId`.
  const source = member ?? open;
  if (source === null) {
    return { ok: false, status: 404, message: "Not available." };
  }
  const competition = { id: source.id, orgId: source.orgId, slug, name: source.name };

  const organizer =
    member !== null &&
    (await withTenantDb(dbHandle, { personId, orgId: competition.orgId }, (db) =>
      canCompetition(
        db,
        personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "registration.review",
      ),
    ));

  // An organizer's grant already covers every subject, so the two relationship
  // reads are skipped rather than computed and discarded.
  const [ownRegistrationIds, ownTeamIds] = organizer
    ? [[] as string[], [] as string[]]
    : await Promise.all([
        ownRegistrationsIn(personId, competition.id),
        member === null ? Promise.resolve<string[]>([]) : ownTeamsIn(personId, competition),
      ]);

  if (!organizer && ownRegistrationIds.length === 0 && ownTeamIds.length === 0) {
    return member !== null
      ? { ok: false, status: 403, message: "You can't generate posters for this season." }
      : { ok: false, status: 404, message: "Not available." };
  }

  const [row] = await withTenantDb(dbHandle, { personId, orgId: competition.orgId }, (db) =>
    db
      .select({ tier: competitions.tier, logoKey: competitions.logoUrl })
      .from(competitions)
      .where(eq(competitions.id, competition.id))
      .limit(1),
  );
  return {
    personId,
    competition,
    logoKey: row?.logoKey ?? null,
    // An unreadable tier falls back to `free`, which is the branded behaviour.
    // Failing the other way would let one bad row silently strip the platform's
    // own mark off every poster a season produces.
    showBranding: row !== undefined && isTier(row.tier) ? row.tier === "free" : true,
    grant: { organizer, ownRegistrationIds, ownTeamIds },
  };
}

/**
 * Does this grant cover THIS subject, and under which authority?
 *
 * Returns the provenance the audit row records, or null for a refusal. Written
 * once so the player route and the team route cannot drift into two different
 * answers — the shape of bug where one subject is checked and the other is
 * merely assumed to have been.
 */
function posterVia(
  grant: PosterGrant,
  own: readonly string[],
  subjectId: string,
  mine: "self" | "owner",
): "organizer" | "self" | "owner" | null {
  if (grant.organizer) {
    return "organizer";
  }
  return own.includes(subjectId) ? mine : null;
}

/**
 * Record that a face and a name left the system as a file.
 *
 * Subject is the REGISTRATION, not the competition — and that is the one place
 * this deliberately differs from `recordRegistrationExport`, whose subject is
 * the whole intake because an export is an act on the intake. A poster is an act
 * on one person, so it belongs on that person's timeline, which is precisely
 * where somebody exercising a DPDP access request would go looking for it.
 *
 * `photo` is on the row because it is the fact that matters most later: whether
 * this artefact carried the person's image, or the monogram their withheld
 * consent earned them.
 */
async function recordPosterGenerated(
  db: Db,
  gated: Gate,
  detail: {
    action: "registration.poster_generated" | "team.poster_generated";
    subject: string;
    theme: PosterTheme;
    size: PosterSize;
    photo?: "included" | "withheld";
    squadSize?: number;
    /** How the actor earned it — see `PosterGrant`. */
    via: "organizer" | "self" | "owner";
  },
): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    actor: gated.personId,
    action: detail.action,
    scopeType: "org",
    scopeId: gated.competition.orgId,
    subject: detail.subject,
    meta: {
      competitionId: gated.competition.id,
      theme: detail.theme,
      size: detail.size,
      // An officer taking a copy of a civilian's face and a civilian taking a
      // copy of their own are the same row shape and NOT the same event. The
      // audit trail says which, because the whole reason this row exists is for
      // somebody reading it back later to be able to tell.
      via: detail.via,
      ...(detail.photo !== undefined ? { photo: detail.photo } : {}),
      ...(detail.squadSize !== undefined ? { squadSize: String(detail.squadSize) } : {}),
    },
  });
}

// --- Player -----------------------------------------------------------------

export async function playerPosterSource(
  slug: string,
  registrationId: string,
  request: PosterRequest,
): Promise<PosterResult<PlayerPosterInput>> {
  const gated = await gate(slug);
  if ("ok" in gated) {
    return gated;
  }
  return playerPosterFrom(gated, registrationId, request);
}

/** The gated half, reachable from a test — see `posterGateFor`. */
export async function playerPosterFor(
  personId: string,
  slug: string,
  registrationId: string,
  request: PosterRequest,
): Promise<PosterResult<PlayerPosterInput>> {
  const gated = await posterGateFor(personId, slug);
  return "ok" in gated ? gated : playerPosterFrom(gated, registrationId, request);
}

async function playerPosterFrom(
  gated: Gate,
  registrationId: string,
  request: PosterRequest,
): Promise<PosterResult<PlayerPosterInput>> {
  /*
   * THE SUBJECT, CHECKED AGAINST THE GRANT.
   *
   * The gate proves the caller may make SOME poster here; this proves it is
   * this one. A player who holds a card of their own must not be able to walk
   * the registration ids of everyone else in the season — the id is in their
   * own URL, and the next id is a guess away.
   *
   * 404, not 403: to a player, another player's registration id is a row they
   * have no business knowing exists, and the refusal reads the same as one for
   * an id that never existed.
   */
  const via = posterVia(gated.grant, gated.grant.ownRegistrationIds, registrationId, "self");
  if (via === null) {
    return { ok: false, status: 404, message: "Not available." };
  }

  const read = await withTenantDb(
    dbHandle,
    { personId: gated.personId, orgId: gated.competition.orgId },
    async (db) => {
      const [row] = await db
        .select({
          playerName: people.name,
          photoKey: people.photoUrl,
          photoConsentAt: people.photoConsentAt,
          role: registrations.role,
          number: registrations.registrationNumber,
          status: registrations.status,
          isIcon: registrations.isIcon,
          isRetained: registrations.isRetained,
          preSignedTeamId: registrations.teamId,
        })
        .from(registrations)
        .innerJoin(people, eq(people.id, registrations.personId))
        // The competition predicate is the tenant binding, not a filter: a
        // registration id lifted from another season must not resolve here even
        // for a member of this org.
        .where(
          and(
            eq(registrations.id, registrationId),
            eq(registrations.competitionId, gated.competition.id),
          ),
        )
        .limit(1);
      if (row === undefined || row.status !== "approved") {
        return null;
      }

      const [lot] = await db
        .select({
          status: lots.status,
          soldPrice: lots.soldPrice,
          buyerTeamId: paddles.teamId,
        })
        .from(lots)
        .innerJoin(auctions, eq(auctions.id, lots.auctionId))
        .leftJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
        .where(
          and(
            eq(lots.registrationId, registrationId),
            eq(auctions.competitionId, gated.competition.id),
            ne(auctions.status, "abandoned"),
          ),
        )
        .limit(1);

      const preSigned = row.isIcon || row.isRetained;
      const teamId = preSigned ? row.preSignedTeamId : (lot?.buyerTeamId ?? null);
      const team =
        teamId === null
          ? undefined
          : (
              await db
                .select({ name: teams.name, logoKey: teams.logoUrl })
                .from(teams)
                .where(and(eq(teams.id, teamId), eq(teams.competitionId, gated.competition.id)))
                .limit(1)
            )[0];

      const outcome = outcomeOf(row.isIcon, row.isRetained, lot?.status);
      if (outcome === null || row.playerName === null) {
        return null;
      }

      /*
       * DPDP §5: `photoConsentAt` is what makes `photoUrl` renderable, and a
       * poster is the most durable, most forwarded thing this product makes. A
       * photo without a timestamp beside it never reaches the renderer — the
       * model already draws a monogram for exactly this case, so the withheld
       * answer is a designed one rather than a hole.
       */
      const photoKey = row.photoConsentAt === null ? null : row.photoKey;

      await recordPosterGenerated(db, gated, {
        action: "registration.poster_generated",
        subject: registrationId,
        theme: request.theme,
        size: request.size,
        photo: photoKey === null ? "withheld" : "included",
        via,
      });

      return {
        playerName: row.playerName,
        number: row.number,
        role: row.role ?? "",
        photoKey,
        outcome,
        pricePaise: outcome === "sold" ? (lot?.soldPrice ?? null) : null,
        teamName: team?.name ?? null,
        teamCrestKey: team?.logoKey ?? null,
      };
    },
  );

  if (read === null) {
    return {
      ok: false,
      status: 404,
      message:
        "There is no poster for this player yet — a poster needs a settled outcome: sold, unsold, retained or icon.",
    };
  }

  // Media resolution is IO against the object store, so it happens after the
  // transaction has committed rather than holding a tenant connection open
  // while a file is read.
  const [photoUrl, teamCrestUrl, competitionLogoUrl] = await Promise.all([
    inlineStoredImage(read.photoKey),
    inlineStoredImage(read.teamCrestKey),
    inlineStoredImage(gated.logoKey),
  ]);

  return {
    ok: true,
    showBranding: gated.showBranding,
    filename: posterFilename(gated.competition.slug, read.playerName, request.size),
    input: {
      playerName: read.playerName,
      number: read.number,
      role: read.role,
      photoUrl,
      outcome: read.outcome,
      pricePaise: read.pricePaise,
      teamName: read.teamName,
      teamCrestUrl,
      competitionName: gated.competition.name,
      competitionLogoUrl,
    },
  };
}

/**
 * A poster asserts a verdict, so there has to be one. A player still in the
 * queue has no outcome the auction has reached, and "UNSOLD" is not a neutral
 * default to fall back on — it is a claim about a night that has not finished.
 */
function outcomeOf(
  isIcon: boolean,
  isRetained: boolean,
  lotStatus: string | undefined,
): PosterOutcome | null {
  if (isIcon) {
    return "icon";
  }
  if (isRetained) {
    return "retained";
  }
  if (lotStatus === "sold") {
    return "sold";
  }
  if (lotStatus === "unsold") {
    return "unsold";
  }
  return null;
}

// --- Team -------------------------------------------------------------------

/**
 * A squad row for a person with no name on file. The player poster refuses that
 * record outright — a poster OF somebody has to be able to say who — but a
 * squad sheet is a list, and quietly dropping a row from a list is how a team
 * poster ends up missing a player nobody notices is missing.
 */
const UNNAMED = "Unnamed player";

export async function teamPosterSource(
  slug: string,
  teamId: string,
  request: PosterRequest,
): Promise<PosterResult<TeamPosterInput>> {
  const gated = await gate(slug);
  if ("ok" in gated) {
    return gated;
  }
  return teamPosterFrom(gated, teamId, request);
}

/** The gated half, reachable from a test — see `posterGateFor`. */
export async function teamPosterFor(
  personId: string,
  slug: string,
  teamId: string,
  request: PosterRequest,
): Promise<PosterResult<TeamPosterInput>> {
  const gated = await posterGateFor(personId, slug);
  return "ok" in gated ? gated : teamPosterFrom(gated, teamId, request);
}

async function teamPosterFrom(
  gated: Gate,
  teamId: string,
  request: PosterRequest,
): Promise<PosterResult<TeamPosterInput>> {
  // An owner earns their own squad sheet. A rival's roster and every price in
  // it is exactly what DA-30 withholds from them everywhere else, and a poster
  // route would hand it over rendered.
  const via = posterVia(gated.grant, gated.grant.ownTeamIds, teamId, "owner");
  if (via === null) {
    return { ok: false, status: 404, message: "Not available." };
  }

  const read = await withTenantDb(
    dbHandle,
    { personId: gated.personId, orgId: gated.competition.orgId },
    async (db) => {
      const [team] = await db
        .select({ name: teams.name, logoKey: teams.logoUrl })
        .from(teams)
        .where(and(eq(teams.id, teamId), eq(teams.competitionId, gated.competition.id)))
        .limit(1);
      if (team === undefined) {
        return null;
      }
      const [auction] = await db
        .select({ id: auctions.id, config: auctions.config })
        .from(auctions)
        .where(
          and(eq(auctions.competitionId, gated.competition.id), ne(auctions.status, "abandoned")),
        )
        .limit(1);
      if (auction === undefined) {
        return null;
      }

      /*
       * The pre-signed half of the squad. Icons and retained players never went
       * to the block, so they have no lot and no price — and a squad poster that
       * showed only the auctioned players would leave the two best-known names
       * in the franchise off the image the owner posts.
       */
      const preSigned = await db
        .select({
          registrationId: registrations.id,
          name: people.name,
          role: registrations.role,
          isIcon: registrations.isIcon,
          // No captain flag here on purpose: a marker slot holds one label, and
          // on a squad sheet "ICON" is the one people are looking for.
          isRetained: registrations.isRetained,
        })
        .from(registrations)
        .innerJoin(people, eq(people.id, registrations.personId))
        .where(
          and(
            eq(registrations.competitionId, gated.competition.id),
            eq(registrations.teamId, teamId),
            eq(registrations.status, "approved"),
            or(eq(registrations.isIcon, true), eq(registrations.isRetained, true)),
          ),
        )
        .orderBy(asc(people.name));

      const bought = await db
        .select({
          registrationId: registrations.id,
          name: people.name,
          role: registrations.role,
          price: lots.soldPrice,
          isCaptain: registrations.isCaptain,
        })
        .from(lots)
        .innerJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
        .innerJoin(registrations, eq(registrations.id, lots.registrationId))
        .innerJoin(people, eq(people.id, registrations.personId))
        .where(
          and(eq(lots.auctionId, auction.id), eq(lots.status, "sold"), eq(paddles.teamId, teamId)),
        )
        .orderBy(desc(lots.soldPrice));

      const members: TeamPosterMember[] = [
        ...preSigned.map((row): TeamPosterMember => ({
          name: row.name ?? UNNAMED,
          role: row.role ?? "",
          pricePaise: null,
          marker: row.isIcon ? "icon" : "retained",
        })),
        ...bought
          // A pre-signed player is excluded from the pool, so this should never
          // fire — but a duplicate would put somebody on their own squad sheet
          // twice, and dropping it costs one Set.
          .filter((row) => !preSigned.some((pre) => pre.registrationId === row.registrationId))
          .map((row): TeamPosterMember => ({
            name: row.name ?? UNNAMED,
            role: row.role ?? "",
            pricePaise: row.price,
            marker: row.isCaptain ? "captain" : null,
          })),
      ];
      const spentPaise = bought.reduce((total, row) => total + (row.price ?? 0), 0);

      await recordPosterGenerated(db, gated, {
        action: "team.poster_generated",
        subject: teamId,
        theme: request.theme,
        size: request.size,
        squadSize: members.length,
        via,
      });

      return {
        teamName: team.name,
        teamCrestKey: team.logoKey,
        members,
        spentPaise,
        pursePaise: pursePerTeamOf(auction.config),
      };
    },
  );

  if (read === null) {
    return {
      ok: false,
      status: 404,
      message:
        "There is no squad poster for this team yet — a squad and a purse only exist once the season has an auction.",
    };
  }

  const [teamCrestUrl, competitionLogoUrl] = await Promise.all([
    inlineStoredImage(read.teamCrestKey),
    inlineStoredImage(gated.logoKey),
  ]);

  return {
    ok: true,
    showBranding: gated.showBranding,
    filename: posterFilename(gated.competition.slug, `${read.teamName} squad`, request.size),
    input: {
      teamName: read.teamName,
      teamCrestUrl,
      competitionName: gated.competition.name,
      competitionLogoUrl,
      members: read.members,
      spentPaise: read.spentPaise,
      pursePaise: read.pursePaise,
    },
  };
}

/**
 * The purse the franchise started with, from the config locked at auction
 * creation. The default is a guard against a partial row, not a stand-in for a
 * missing auction — a team with no auction gets no poster at all, because
 * "spent" and "remaining" against an invented purse are two numbers the
 * organizer would have no way to know were fiction.
 */
function pursePerTeamOf(config: unknown): number {
  const parsed = (config ?? {}) as Partial<AuctionConfig>;
  return Number(parsed.pursePerTeam ?? DEFAULT_AUCTION_CONFIG.pursePerTeam);
}

// --- Media ------------------------------------------------------------------

/**
 * Satori cannot use `next/image`, cannot resolve a relative public path, and has
 * no notion of this app's storage port — so every picture on a poster arrives as
 * bytes, inlined here.
 *
 * WebP is deliberately dropped. It is an allowed upload type, but the rasterizer
 * behind `ImageResponse` decodes PNG and JPEG only; handing it a WebP produces a
 * failed render rather than a missing photo. Returning null instead routes the
 * poster through the monogram the model already designs for, which is a poster
 * that looks intentional rather than a 500.
 */
async function inlineStoredImage(key: string | null): Promise<string | null> {
  if (key === null || !isValidMediaKey(key)) {
    return null;
  }
  const contentType = imageTypeOf(key);
  if (contentType === null) {
    return null;
  }
  const url = storage.readUrl(key);
  try {
    const bytes = url.startsWith("http")
      ? Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(5_000) })).arrayBuffer())
      : // The local adapter's read URL is a path under `public/`, which is where
        // it wrote the bytes. Deriving the path from the port's own answer keeps
        // one source of truth for the layout instead of two.
        await readFile(join(process.cwd(), "public", url));
    return dataUri(contentType, bytes);
  } catch {
    // A missing object is a monogram, never a failed poster.
    return null;
  }
}

function imageTypeOf(key: string): string | null {
  if (key.endsWith(".png")) {
    return "image/png";
  }
  return key.endsWith(".jpg") || key.endsWith(".jpeg") ? "image/jpeg" : null;
}

function dataUri(contentType: string, bytes: Buffer): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

/**
 * The brand mark, read once per process. It is on every free-tier poster, so
 * re-reading and re-encoding 190KB on each request would be the most repeated
 * pointless work in the product.
 */
let brandMark: Promise<string | null> | null = null;

export function posterBrandMark(): Promise<string | null> {
  brandMark ??= readFile(join(process.cwd(), "public", "brand", "mark.png"))
    .then((bytes) => dataUri("image/png", bytes))
    // The wordmark alone still says DesiAuction; a footer with a hole in it does
    // not, and neither does a poster that failed to render over a logo.
    .catch(() => null);
  return brandMark;
}

// --- Filenames --------------------------------------------------------------

function posterFilename(slug: string, subject: string, size: PosterSize): string {
  return `${slug}-${slugifyName(subject)}-${size}.png`;
}

export interface PosterSubject {
  readonly id: string;
  readonly label: string;
  readonly sublabel: string;
}

export interface PosterPicker {
  readonly competitionName: string;
  readonly showBranding: boolean;
  readonly players: readonly PosterSubject[];
  readonly teams: readonly PosterSubject[];
  /**
   * WHY a list is empty, which is not a detail the screen can infer.
   *
   * `season` — these are all of them, and an empty side means the season has
   * none yet ("add a franchise and its squad card appears here").
   * `mine` — these are the subjects THIS person may make, and an empty side
   * means it is not theirs to make. Telling a player to go add a franchise
   * would be wrong about the season and impossible advice besides.
   */
  readonly scope: "season" | "mine";
}

/**
 * WHAT THERE IS TO MAKE A POSTER OF.
 *
 * The picker screen's only read. It reuses the SAME gate as the image routes,
 * and — since a relationship grants one subject rather than a category — the
 * SAME grant narrows the lists. A screen that offered a player the whole season
 * would be a menu of 404s, and one that offered an owner the rival squads would
 * be a menu of 404s that also named every rival's roster in its sublabels.
 *
 * Sold players lead, because the hour after the gavel is when anyone opens this
 * screen and the sale is the thing they came to post. Everyone approved is
 * still offered: a squad list is not only its purchases, and an organizer
 * announcing a pool before auction night has the same reason to want a card.
 */
export async function posterPicker(slug: string): Promise<PosterPicker | PosterRefusal> {
  const gated = await gate(slug);
  return "ok" in gated ? gated : pickerFrom(gated);
}

/** The gated half, reachable from a test — see `posterGateFor`. */
export async function posterPickerFor(
  personId: string,
  slug: string,
): Promise<PosterPicker | PosterRefusal> {
  const gated = await posterGateFor(personId, slug);
  return "ok" in gated ? gated : pickerFrom(gated);
}

async function pickerFrom(gated: Gate): Promise<PosterPicker> {
  return withTenantDb(
    dbHandle,
    { personId: gated.personId, orgId: gated.competition.orgId },
    async (db) => {
      /*
       * SCOPE THE LOTS TO THE AUCTION THAT COUNTS.
       *
       * Migration 0029 permits at most one NON-abandoned auction per
       * competition, but abandoned ones accumulate without limit — and each
       * carries a lot per registration. An unscoped join on
       * `lots.registrationId` therefore returns one row per auction the player
       * was ever listed in, so a season that aborted a night and started again
       * would list every player twice, the second time at a price from an
       * auction nobody ran to the end.
       */
      const [live] = await db
        .select({ id: auctions.id })
        .from(auctions)
        .where(
          and(eq(auctions.competitionId, gated.competition.id), ne(auctions.status, "abandoned")),
        )
        .limit(1);
      const liveAuctionId = live?.id ?? null;
      /*
       * The narrowing is a PREDICATE, not a filter applied to the results.
       * Reading every registration in the season and then dropping the ones
       * that are not yours still reads them — into a query plan, a log, and the
       * memory of a process serving somebody who may see exactly one row.
       */
      const mine = gated.grant.organizer
        ? undefined
        : {
            players: gated.grant.ownRegistrationIds,
            teams: gated.grant.ownTeamIds,
          };
      const [playerRows, teamRows] = await Promise.all([
        mine !== undefined && mine.players.length === 0
          ? []
          : db
              .select({
                registrationId: registrations.id,
                name: people.name,
                number: registrations.registrationNumber,
                soldPrice: lots.soldPrice,
                teamName: teams.name,
              })
              .from(registrations)
              .innerJoin(people, eq(people.id, registrations.personId))
              .leftJoin(
                lots,
                liveAuctionId === null
                  ? // No auction has been created yet: every player is simply
                    // unsold, and a join that could match nothing says so.
                    sql`false`
                  : and(
                      eq(lots.registrationId, registrations.id),
                      eq(lots.auctionId, liveAuctionId),
                    ),
              )
              .leftJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
              .leftJoin(teams, eq(teams.id, paddles.teamId))
              .where(
                and(
                  eq(registrations.competitionId, gated.competition.id),
                  eq(registrations.status, "approved"),
                  ...(mine === undefined ? [] : [inArray(registrations.id, mine.players)]),
                ),
              )
              // Sold first, then by the number the player already knows themselves by.
              .orderBy(desc(lots.soldPrice), asc(registrations.registrationNumber)),
        mine !== undefined && mine.teams.length === 0
          ? []
          : db
              .select({ id: teams.id, name: teams.name, shortName: teams.shortName })
              .from(teams)
              .where(
                and(
                  eq(teams.competitionId, gated.competition.id),
                  ...(mine === undefined ? [] : [inArray(teams.id, mine.teams)]),
                ),
              )
              .orderBy(asc(teams.name)),
      ]);
      return {
        competitionName: gated.competition.name,
        showBranding: gated.showBranding,
        scope: gated.grant.organizer ? ("season" as const) : ("mine" as const),
        players: playerRows.map((row) => ({
          id: row.registrationId,
          label: row.name ?? "Unnamed",
          sublabel:
            row.teamName !== null && row.soldPrice !== null
              ? `#${row.number} · ${row.teamName}`
              : `#${row.number} · not sold`,
        })),
        teams: teamRows.map((row) => ({
          id: row.id,
          label: row.name,
          sublabel: row.shortName ?? "Squad poster",
        })),
      };
    },
  );
}
