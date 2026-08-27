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
import { and, asc, desc, eq, ne, or, sql } from "drizzle-orm";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { storage } from "../media";
import { ForbiddenError } from "../orgs/authz";
import { requireCompetitionCapability } from "./authz";
import { resolveCompetition } from "./competitions";

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

interface Gate {
  readonly personId: string;
  readonly competition: { id: string; orgId: string; slug: string; name: string };
  readonly logoKey: string | null;
  readonly showBranding: boolean;
}

/**
 * Session → membership → capability, in that order, and each one refuses
 * differently on purpose. A non-member gets 404 rather than 403: whether this
 * org runs a season called `mumbai-corporate-2026` is not a fact an outsider
 * gets to confirm by reading a status code.
 */
async function gate(slug: string): Promise<Gate | PosterRefusal> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, status: 401, message: "Sign in to generate posters." };
  }
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return { ok: false, status: 404, message: "Not available." };
  }
  try {
    return await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: competition.orgId },
      async (db) => {
        await requireCompetitionCapability(
          db,
          session.personId,
          { orgId: competition.orgId, competitionId: competition.id },
          "registration.review",
        );
        const [row] = await db
          .select({ tier: competitions.tier, logoKey: competitions.logoUrl })
          .from(competitions)
          .where(eq(competitions.id, competition.id))
          .limit(1);
        return {
          personId: session.personId,
          competition,
          logoKey: row?.logoKey ?? null,
          // An unreadable tier falls back to `free`, which is the branded
          // behaviour. Failing the other way would let one bad row silently
          // strip the platform's own mark off every poster a season produces.
          showBranding: row !== undefined && isTier(row.tier) ? row.tier === "free" : true,
        };
      },
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, status: 403, message: "You can't generate posters for this season." };
    }
    throw error;
  }
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
      });

      return {
        playerName: row.playerName,
        number: row.number,
        role: row.role,
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
          role: row.role,
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
            role: row.role,
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
}

/**
 * WHAT THERE IS TO MAKE A POSTER OF.
 *
 * The picker screen's only read. It reuses the SAME gate as the image routes —
 * a screen that listed players the routes would refuse to draw would be a menu
 * of 403s, and `registration.review` is the capability that governs seeing a
 * registration at all.
 *
 * Sold players lead, because the hour after the gavel is when anyone opens this
 * screen and the sale is the thing they came to post. Everyone approved is
 * still offered: a squad list is not only its purchases, and an organizer
 * announcing a pool before auction night has the same reason to want a card.
 */
export async function posterPicker(slug: string): Promise<PosterPicker | PosterRefusal> {
  const gated = await gate(slug);
  if ("ok" in gated) {
    return gated;
  }
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
      const [playerRows, teamRows] = await Promise.all([
        db
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
              : and(eq(lots.registrationId, registrations.id), eq(lots.auctionId, liveAuctionId)),
          )
          .leftJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
          .leftJoin(teams, eq(teams.id, paddles.teamId))
          .where(
            and(
              eq(registrations.competitionId, gated.competition.id),
              eq(registrations.status, "approved"),
            ),
          )
          // Sold first, then by the number the player already knows themselves by.
          .orderBy(desc(lots.soldPrice), asc(registrations.registrationNumber)),
        db
          .select({ id: teams.id, name: teams.name, shortName: teams.shortName })
          .from(teams)
          .where(eq(teams.competitionId, gated.competition.id))
          .orderBy(asc(teams.name)),
      ]);
      return {
        competitionName: gated.competition.name,
        showBranding: gated.showBranding,
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
