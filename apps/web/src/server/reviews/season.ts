import { newId, reviewReports, reviewRequests, reviews } from "@desiauction/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { db, systemDb } from "../db";
import { maySend } from "../messaging/consent";
import { transactionalMailer } from "../messaging/transactional-mail";
import { seasonAskMail } from "./review-mail";
import { ageOn, askForSeasonReview, isKnownMinor, markAskSent, type SeasonRole } from "./reviews";

/**
 * TOURNAMENT REVIEWS (FR-1 Phase 4) — who is asked about a season, what the
 * public sees, how an organizer answers, and how a reader objects.
 *
 * WHO IS ASKED. Players whose registration was APPROVED, and everyone who held
 * a paddle in the season's auction. Nobody else took part.
 *
 *   · A player must have a KNOWN date of birth, and be an adult on it
 *     (founder decision 2026-09-17: unknown means no). Players are the one
 *     group here that routinely includes minors, and "we didn't know" is not
 *     an answer we want to give about mailing a fifteen-year-old.
 *   · An owner is refused only when KNOWN to be a minor — owners are the adults
 *     who paid for a team; the platform has no reason to hold their birth date.
 *   · Somebody who both played and bid is asked once, as an owner.
 *   · Organizers are NOT asked about their own season. A club reviewing itself
 *     is not a review.
 *
 * WHAT THE PUBLIC SEES. Published reviews of a PUBLIC season, and only once
 * there are at least three — below that, "a team owner" on a six-team season is
 * as good as a name, and the anonymity the review promised is not real.
 *
 * Reads that cross into tenant tables (registrations, paddles, competitions)
 * run on the SYSTEM pool, the way the public season page already does; review
 * rows themselves carry no RLS.
 */

export const PUBLIC_MIN_REVIEWS = 3;
export const ORG_ASK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const REPLY_LIMIT = 1000;
const REPORTS_PER_IP_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

export interface SeasonRef {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly slug: string;
  readonly orgName: string;
  readonly visibility: "private" | "public";
}

/** A season's names, for mail and the review page — tenant rows, system pool. */
export async function seasonRef(competitionId: string): Promise<SeasonRef | null> {
  const rows = await systemDb.execute<{
    id: string;
    org_id: string;
    name: string;
    slug: string;
    org_name: string;
    visibility: "private" | "public";
  }>(sql`
    select c.id, c.org_id, c.name, c.slug, o.name as org_name, c.visibility
    from competitions c join organizations o on o.id = c.org_id
    where c.id = ${competitionId}
    limit 1
  `);
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id.trim(),
        orgId: row.org_id.trim(),
        name: row.name,
        slug: row.slug,
        orgName: row.org_name,
        visibility: row.visibility,
      };
}

// --- who is owed an ask ------------------------------------------------------

export interface SeasonParticipant {
  readonly personId: string;
  readonly name: string | null;
  readonly email: string;
  readonly role: SeasonRole;
  readonly dateOfBirth: string | null;
}

/** The adult-and-known rule for players; the not-known-minor rule for owners. */
export function mayAskParticipant(participant: SeasonParticipant, now: Date): boolean {
  if (participant.role === "player") {
    const age = ageOn(participant.dateOfBirth, now);
    return age !== null && age >= 18;
  }
  return !isKnownMinor(participant, now);
}

/**
 * Everyone who took part and has not yet been asked about this season.
 * `roles` narrows it: an auction closing owes the OWNERS an ask; the players'
 * season is not over until the fixtures are.
 */
export async function unaskedParticipants(
  competitionId: string,
  roles: readonly SeasonRole[],
): Promise<readonly SeasonParticipant[]> {
  const wantPlayers = roles.includes("player");
  const wantOwners = roles.includes("owner");
  const rows = await systemDb.execute<{
    person_id: string;
    name: string | null;
    email: string;
    role: SeasonRole;
    date_of_birth: string | null;
  }>(sql`
    with players as (
      select r.person_id, 'player' as role, r.date_of_birth as reg_dob
      from registrations r
      where ${wantPlayers} and r.competition_id = ${competitionId}
        and r.status = 'approved' and r.person_id is not null
    ),
    owners as (
      select distinct pd.person_id, 'owner' as role, null::text as reg_dob
      from paddles pd
      join auctions a on a.id = pd.auction_id
      where ${wantOwners} and a.competition_id = ${competitionId}
    ),
    everyone as (
      -- Somebody who played AND bid is asked once, as the owner.
      select distinct on (person_id) person_id, role, reg_dob
      from (select * from owners union all select * from players) x
      order by person_id, (role = 'owner') desc
    )
    select e.person_id, pe.name, pe.email, e.role,
      coalesce(pp.date_of_birth, e.reg_dob,
        (select rg.date_of_birth from registrations rg
          where rg.person_id = pe.id and rg.date_of_birth is not null
          order by rg.created_at desc limit 1)) as date_of_birth
    from everyone e
    join people pe on pe.id = e.person_id
    left join player_profiles pp on pp.person_id = pe.id
    where pe.email is not null
      and not exists (
        select 1 from review_requests rr
        where rr.person_id = e.person_id and rr.subject_type = 'competition'
          and rr.competition_id = ${competitionId}
      )
      -- A club does not review itself: anybody who runs the season — an active
      -- organizer grant on its org, or on the season itself — is left out even
      -- when they also held a paddle or registered to play.
      and not exists (
        select 1 from grants g
        join competitions c on c.id = ${competitionId}
        where g.person_id = e.person_id and g.revoked_at is null
          and g.capability_set in ('org:owner', 'org:staff')
          and ((g.scope_type = 'org' and g.scope_id = c.org_id)
            or (g.scope_type = 'tournament' and g.scope_id = c.id))
      )
    order by e.person_id
  `);
  return rows.map((row) => ({
    personId: row.person_id.trim(),
    name: row.name,
    email: row.email,
    role: row.role,
    dateOfBirth: row.date_of_birth,
  }));
}

export interface SeasonAskResult {
  readonly asked: number;
  readonly mailed: number;
  readonly optedOut: number;
  readonly notEligible: number;
  readonly mailFailed: number;
}

/**
 * Ask everyone owed an ask about a season, up to `budget`. Each ask is made
 * once (the partial unique index decides a race), mailed only through the
 * consent gate, and recorded even when not mailed so it is never reconsidered.
 */
export async function askSeason(
  season: { id: string; orgId: string; name: string; orgName: string },
  input: {
    roles: readonly SeasonRole[];
    source: "manual_org" | "auction_completed" | "season_completed";
    requestedBy: string | null;
    now?: Date;
    budget?: number;
  },
): Promise<SeasonAskResult> {
  const now = input.now ?? new Date();
  const budget = input.budget ?? Number.POSITIVE_INFINITY;
  const participants = await unaskedParticipants(season.id, input.roles);
  const mailer = transactionalMailer();
  let asked = 0;
  let mailed = 0;
  let optedOut = 0;
  let notEligible = 0;
  let mailFailed = 0;

  for (const participant of participants) {
    if (asked >= budget) {
      break;
    }
    if (!mayAskParticipant(participant, now)) {
      notEligible += 1;
      continue;
    }
    const ask = await askForSeasonReview(db, {
      personId: participant.personId,
      competitionId: season.id,
      orgId: season.orgId,
      role: participant.role,
      source: input.source,
      requestedBy: input.requestedBy,
      now,
    });
    if (!ask.created || ask.requestId === null || ask.link === null) {
      continue;
    }
    asked += 1;
    const decision = await maySend(db, {
      contact: participant.email,
      channel: "email",
      category: "transactional",
      scope: "feedback",
      personId: participant.personId,
      now,
    });
    if (!decision.send) {
      optedOut += 1;
      continue;
    }
    const outcome = await mailer.send({
      to: participant.email,
      ...seasonAskMail({
        name: participant.name,
        seasonName: season.name,
        orgName: season.orgName,
        role: participant.role,
        link: ask.link,
      }),
    });
    if (outcome === "sent") {
      await markAskSent(db, ask.requestId, participant.email, now);
      mailed += 1;
    } else {
      mailFailed += 1;
    }
  }
  return { asked, mailed, optedOut, notEligible, mailFailed };
}

/** When the club last pressed "Ask", or null. The button waits a week between presses. */
export async function lastOrgAsk(competitionId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: reviewRequests.createdAt })
    .from(reviewRequests)
    .where(
      and(eq(reviewRequests.competitionId, competitionId), eq(reviewRequests.source, "manual_org")),
    )
    .orderBy(desc(reviewRequests.createdAt))
    .limit(1);
  return row?.at ?? null;
}

// --- what is shown ---------------------------------------------------------

export interface PublishedReview {
  readonly id: string;
  readonly rating: number;
  readonly text: string | null;
  readonly role: SeasonRole;
  /** Only when the author asked to be named. */
  readonly signedName: string | null;
  readonly reply: string | null;
  readonly repliedAt: Date | null;
  readonly createdAt: Date;
}

export interface SeasonReviews {
  readonly count: number;
  /** One decimal place; null when there are none. */
  readonly average: number | null;
  readonly reviews: readonly PublishedReview[];
}

export async function publishedSeasonReviews(
  competitionId: string,
  limit = 20,
): Promise<SeasonReviews> {
  const [summary] = await db
    .select({
      count: sql<number>`count(*)::int`,
      average: sql<string | null>`round(avg(${reviews.rating})::numeric, 1)::text`,
    })
    .from(reviews)
    .where(and(eq(reviews.competitionId, competitionId), eq(reviews.status, "published")));
  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      text: reviews.wentWell,
      role: reviews.role,
      mayQuote: reviews.mayQuote,
      displayName: reviews.displayName,
      reply: reviews.organizerReply,
      repliedAt: reviews.organizerReplyAt,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(and(eq(reviews.competitionId, competitionId), eq(reviews.status, "published")))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
  return {
    count: summary?.count ?? 0,
    average: summary?.average === null || summary === undefined ? null : Number(summary.average),
    reviews: rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      text: row.text,
      role: row.role ?? "player",
      signedName: row.mayQuote ? row.displayName : null,
      reply: row.reply,
      repliedAt: row.repliedAt,
      createdAt: row.createdAt,
    })),
  };
}

/**
 * The public page's read: a PUBLIC season with at least three published
 * reviews, or nothing at all. Nothing means the section is absent, not empty —
 * "no reviews yet" on a season nobody was asked about reads as a verdict.
 */
export async function publicSeasonReviews(competitionId: string): Promise<SeasonReviews | null> {
  const season = await seasonRef(competitionId);
  if (season === null || season.visibility !== "public") {
    return null;
  }
  const shown = await publishedSeasonReviews(competitionId, 10);
  return shown.count >= PUBLIC_MIN_REVIEWS ? shown : null;
}

/** The same read, keyed the way the public page is: by slug. */
export async function publicSeasonReviewsBySlug(slug: string): Promise<SeasonReviews | null> {
  const rows = await systemDb.execute<{ id: string }>(
    sql`select c.id from competitions c where c.slug = ${slug} limit 1`,
  );
  const row = rows[0];
  return row === undefined ? null : publicSeasonReviews(row.id.trim());
}

// --- the organizer's answer ---------------------------------------------------

export type ReplyResult =
  { readonly ok: true; readonly summary: string } | { readonly ok: false; readonly error: string };

/**
 * Answer a published review of THIS season. The caller has proven
 * `competition.manage`; this proves the review belongs to the season, so a
 * reply cannot be aimed at another club's review by changing an id.
 * Empty text removes the reply. The review's own words are never touched.
 */
export async function replyToReview(
  competitionId: string,
  reviewId: string,
  text: string,
  actorId: string,
  now: Date = new Date(),
): Promise<ReplyResult> {
  const reply = text.trim();
  if (reply.length > REPLY_LIMIT) {
    return { ok: false, error: `Keep the reply under ${String(REPLY_LIMIT)} characters.` };
  }
  const updated = await db
    .update(reviews)
    .set(
      reply === ""
        ? { organizerReply: null, organizerReplyAt: null, organizerReplyBy: null }
        : { organizerReply: reply, organizerReplyAt: now, organizerReplyBy: actorId },
    )
    .where(
      and(
        eq(reviews.id, reviewId),
        eq(reviews.competitionId, competitionId),
        eq(reviews.status, "published"),
      ),
    )
    .returning({ id: reviews.id });
  if (updated[0] === undefined) {
    return { ok: false, error: "That review isn't published on this season." };
  }
  return { ok: true, summary: reply === "" ? "Reply removed." : "Reply posted." };
}

// --- a reader objects -------------------------------------------------------

export const REPORT_REASONS = ["abusive", "false", "personal_info", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Report a review that is on show. Only a published review of a public season
 * can be reported — anything else is not on show, and saying so would confirm
 * it exists. The throttle is silent like the others: a flood gets "thanks".
 */
export async function reportReview(input: {
  reviewId: string;
  reason: string;
  note: string;
  ip: string | null;
  personId: string | null;
  now?: Date;
}): Promise<ReportResult> {
  const now = input.now ?? new Date();
  const reason = REPORT_REASONS.find((candidate) => candidate === input.reason);
  if (reason === undefined) {
    return { ok: false, error: "Pick a reason." };
  }
  const note = input.note.trim().slice(0, 500);

  const [review] = await db
    .select({ competitionId: reviews.competitionId })
    .from(reviews)
    .where(and(eq(reviews.id, input.reviewId), eq(reviews.status, "published")))
    .limit(1);
  if (review?.competitionId === null || review === undefined) {
    return { ok: false, error: "That review isn't available." };
  }
  const season = await seasonRef(review.competitionId);
  if (season === null || season.visibility !== "public") {
    return { ok: false, error: "That review isn't available." };
  }

  if (input.ip !== null) {
    const [recent] = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviewReports)
      .where(
        and(
          eq(reviewReports.reporterIp, input.ip),
          gt(reviewReports.createdAt, new Date(now.getTime() - HOUR_MS)),
        ),
      )) as [{ count: number }];
    if (recent.count >= REPORTS_PER_IP_PER_HOUR) {
      return { ok: true };
    }
  }

  await db.insert(reviewReports).values({
    id: newId(),
    reviewId: input.reviewId,
    reason,
    note: note === "" ? null : note,
    reporterIp: input.ip,
    reporterPersonId: input.personId,
    createdAt: now,
  });
  return { ok: true };
}

/** An operator's answer to the reports on one review: hidden, or dismissed. */
export async function resolveReports(
  reviewId: string,
  actorId: string,
  now: Date = new Date(),
): Promise<number> {
  const resolved = await db
    .update(reviewReports)
    .set({ resolvedAt: now, resolvedBy: actorId })
    .where(and(eq(reviewReports.reviewId, reviewId), isNull(reviewReports.resolvedAt)))
    .returning({ id: reviewReports.id });
  return resolved.length;
}
