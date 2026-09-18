import { createHash, createHmac } from "node:crypto";

import { normalizePhone } from "@desiauction/core";
import { newId, people, reviewRequests, reviews, type Db } from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";

import { env } from "../../env";

/**
 * PLATFORM REVIEWS — asking, answering, publishing (FR-1 Phase 2).
 *
 * THE LINK IS THE PRINCIPAL. The review page has no session and no tenant; what
 * lets somebody write the review they were asked for is a token in the URL
 * path, stored only as a SHA-256 digest. Like DEMO-1's booking link, the token
 * is an HMAC of the REQUEST id under an environment key, so asking again can
 * rebuild the same link without the database ever holding one.
 *
 * ONE ASK PER PERSON (unique index, 0065). Asking again re-sends the same link
 * and pushes its expiry out; it never mints a second request.
 *
 * NOTHING IS SHOWN UNTIL AN OPERATOR PUBLISHES IT, and nothing is ever QUOTED
 * unless its author ticked the box and signed it (CHECK in 0065). This is what
 * lets the no-fabrication rule on the landing page bend without breaking.
 */

export const REVIEW_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TEXT_LIMIT = 2000;
export const NAME_LIMIT = 80;
export const ORG_LIMIT = 120;

export function tokenForReviewRequest(requestId: string): string {
  return createHmac("sha256", env.REVIEW_TOKEN_SECRET)
    .update(`review-request:${requestId}`)
    .digest("base64url")
    .slice(0, 32);
}

export function hashReviewToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function reviewLink(requestId: string): string {
  return `${env.PUBLIC_BASE_URL}/review/${tokenForReviewRequest(requestId)}`;
}

// --- who may be asked ------------------------------------------------------

export interface AskablePerson {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly dateOfBirth: string | null;
}

/** Whole years between a `YYYY-MM-DD` birth date and `now`; null if unreadable. */
export function ageOn(dateOfBirth: string | null, now: Date): number | null {
  if (dateOfBirth === null || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return null;
  }
  const [year, month, day] = dateOfBirth.split("-").map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - year;
  const beforeBirthday =
    now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
  if (beforeBirthday) {
    age -= 1;
  }
  return age;
}

/**
 * A known minor is never asked. (Founder decision 2026-09-17: for PLAYERS an
 * unknown date of birth is also a no — that rule belongs to Phase 3's tournament
 * requests. A platform review is asked of organizers and owners, whose date of
 * birth the platform has no reason to hold.)
 */
export function isKnownMinor(person: Pick<AskablePerson, "dateOfBirth">, now: Date): boolean {
  const age = ageOn(person.dateOfBirth, now);
  return age !== null && age < 18;
}

/**
 * Find a person by the address or number an operator typed.
 *
 * Date of birth has no single home: the profile holds the person's own answer,
 * and every registration snapshots what they gave that season. The profile
 * wins; otherwise the most recent registration that recorded one. Run this on
 * the SYSTEM pool — registrations are tenant rows, and a platform operator is a
 * member of no tenant, so under the app role the fallback would read nothing
 * and a minor would look like an adult with no date on file.
 */
export async function findPersonByContact(db: Db, query: string): Promise<AskablePerson | null> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return null;
  }
  let where;
  if (trimmed.includes("@")) {
    where = sql`lower(p.email) = ${trimmed.toLowerCase()}`;
  } else {
    const normalized = normalizePhone(trimmed);
    if (!normalized.ok) {
      return null;
    }
    where = sql`p.phone = ${normalized.phone}`;
  }
  // Hand-written with explicit aliases: drizzle's column interpolation in raw
  // SQL emits unqualified names, which bind to the wrong table in a subquery.
  const rows = await db.execute<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    date_of_birth: string | null;
  }>(sql`
    select p.id, p.name, p.email, p.phone,
      coalesce(
        pp.date_of_birth,
        (select r.date_of_birth from registrations r
          where r.person_id = p.id and r.date_of_birth is not null
          order by r.created_at desc limit 1)
      ) as date_of_birth
    from people p
    left join player_profiles pp on pp.person_id = p.id
    where ${where}
    limit 1
  `);
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id.trim(),
    name: row.name,
    email: row.email,
    phone: row.phone,
    dateOfBirth: row.date_of_birth,
  };
}

// --- asking ----------------------------------------------------------------

export interface IssuedAsk {
  readonly requestId: string;
  readonly link: string;
  /** False when this person had already been asked and the link was re-issued. */
  readonly created: boolean;
  /** True when a review already exists — the operator should not nag. */
  readonly alreadyReviewed: boolean;
}

/**
 * Ask a person for a platform review, or re-issue the ask they already have.
 *
 * The insert races safely: two operators pressing at once both reach
 * ON CONFLICT, and both get the one row. A re-issue pushes the expiry out so
 * the link in the new mail works for the full thirty days.
 *
 * `reissue: false` is the automatic sweep's mode: somebody already asked is
 * left alone entirely — no new expiry, and `created: false` tells the caller
 * not to mail them again. Only a person pressing Ask on the desk re-issues.
 */
export async function askForPlatformReview(
  db: Db,
  input: {
    personId: string;
    source: "manual_admin" | "manual_org" | "auction_completed" | "season_completed";
    requestedBy: string | null;
    now?: Date;
    reissue?: boolean;
  },
): Promise<IssuedAsk> {
  const now = input.now ?? new Date();
  const id = newId();
  const expiresAt = new Date(now.getTime() + REVIEW_LINK_TTL_MS);
  const insert = db.insert(reviewRequests).values({
    id,
    personId: input.personId,
    subjectType: "platform",
    source: input.source,
    requestedBy: input.requestedBy,
    tokenHash: hashReviewToken(tokenForReviewRequest(id)),
    expiresAt,
  });
  // 0070 split the unique index in two partial ones; ON CONFLICT must name the
  // same predicate or Postgres cannot match it to an index.
  const target = [reviewRequests.personId];
  const where = sql`${reviewRequests.subjectType} = 'platform'`;
  let requestId: string;
  if (input.reissue === false) {
    const [row] = await insert
      .onConflictDoNothing({ target, where })
      .returning({ id: reviewRequests.id });
    if (row === undefined) {
      const [existing] = await db
        .select({ id: reviewRequests.id })
        .from(reviewRequests)
        .where(
          and(
            eq(reviewRequests.personId, input.personId),
            eq(reviewRequests.subjectType, "platform"),
          ),
        )
        .limit(1);
      requestId = existing?.id ?? id;
    } else {
      requestId = row.id;
    }
  } else {
    const [row] = await insert
      .onConflictDoUpdate({ target, targetWhere: where, set: { expiresAt } })
      .returning({ id: reviewRequests.id });
    requestId = row?.id ?? id;
  }
  const [existing] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.requestId, requestId))
    .limit(1);
  return {
    requestId,
    link: reviewLink(requestId),
    created: requestId === id,
    alreadyReviewed: existing !== undefined,
  };
}

export type SeasonRole = "player" | "owner";

/**
 * Ask a person about ONE season (Phase 4). Never re-issues: an ask about a
 * season is made once, by whichever of the sweep or the organizer's button
 * reaches them first, and `created: false` tells the caller not to mail again.
 */
export async function askForSeasonReview(
  db: Db,
  input: {
    personId: string;
    competitionId: string;
    orgId: string;
    role: SeasonRole;
    source: "manual_org" | "auction_completed" | "season_completed";
    requestedBy: string | null;
    now?: Date;
  },
): Promise<{
  readonly requestId: string | null;
  readonly link: string | null;
  readonly created: boolean;
}> {
  const now = input.now ?? new Date();
  const id = newId();
  const [row] = await db
    .insert(reviewRequests)
    .values({
      id,
      personId: input.personId,
      subjectType: "competition",
      competitionId: input.competitionId,
      orgId: input.orgId,
      role: input.role,
      source: input.source,
      requestedBy: input.requestedBy,
      tokenHash: hashReviewToken(tokenForReviewRequest(id)),
      expiresAt: new Date(now.getTime() + REVIEW_LINK_TTL_MS),
    })
    .onConflictDoNothing({
      target: [reviewRequests.personId, reviewRequests.competitionId],
      where: sql`${reviewRequests.subjectType} = 'competition'`,
    })
    .returning({ id: reviewRequests.id });
  if (row === undefined) {
    return { requestId: null, link: null, created: false };
  }
  return { requestId: row.id, link: reviewLink(row.id), created: true };
}

/** Record where and when the ask was mailed. */
export async function markAskSent(
  db: Db,
  requestId: string,
  sentTo: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(reviewRequests)
    .set({ sentTo, sentAt: now })
    .where(eq(reviewRequests.id, requestId));
}

// --- the review page -------------------------------------------------------

export interface ExistingReview {
  readonly id: string;
  readonly rating: number;
  readonly wentWell: string | null;
  readonly improve: string | null;
  readonly mayQuote: boolean;
  readonly displayName: string | null;
  readonly displayOrg: string | null;
  readonly status: "pending" | "published" | "hidden";
}

export type ReviewPageState =
  | { readonly kind: "unknown" }
  | { readonly kind: "expired" }
  | {
      readonly kind: "open";
      readonly requestId: string;
      readonly personId: string;
      readonly personName: string | null;
      readonly subject: ReviewSubject;
      readonly review: ExistingReview | null;
    }
  | { readonly kind: "closed"; readonly review: ExistingReview; readonly subject: ReviewSubject };

/** What a request is about. Names are resolved separately (they live in tenant tables). */
export type ReviewSubject =
  | { readonly type: "platform" }
  | {
      readonly type: "competition";
      readonly competitionId: string;
      readonly orgId: string;
      readonly role: SeasonRole;
    };

/**
 * What the page behind a token should show. A review an operator has already
 * moderated is closed — the words they published are the words that stay.
 */
export async function reviewPageState(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<ReviewPageState> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) {
    return { kind: "unknown" };
  }
  const [row] = await db
    .select({
      requestId: reviewRequests.id,
      personId: reviewRequests.personId,
      expiresAt: reviewRequests.expiresAt,
      personName: people.name,
      subjectType: reviewRequests.subjectType,
      competitionId: reviewRequests.competitionId,
      orgId: reviewRequests.orgId,
      role: reviewRequests.role,
    })
    .from(reviewRequests)
    .innerJoin(people, eq(people.id, reviewRequests.personId))
    .where(eq(reviewRequests.tokenHash, hashReviewToken(token)))
    .limit(1);
  if (row === undefined) {
    return { kind: "unknown" };
  }
  const subject: ReviewSubject =
    row.subjectType === "competition" &&
    row.competitionId !== null &&
    row.orgId !== null &&
    row.role !== null
      ? { type: "competition", competitionId: row.competitionId, orgId: row.orgId, role: row.role }
      : { type: "platform" };
  const [review] = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      wentWell: reviews.wentWell,
      improve: reviews.improve,
      mayQuote: reviews.mayQuote,
      displayName: reviews.displayName,
      displayOrg: reviews.displayOrg,
      status: reviews.status,
    })
    .from(reviews)
    .where(eq(reviews.requestId, row.requestId))
    .limit(1);
  if (review !== undefined && review.status !== "pending") {
    return { kind: "closed", review, subject };
  }
  if (row.expiresAt <= now) {
    return { kind: "expired" };
  }
  return {
    kind: "open",
    requestId: row.requestId,
    personId: row.personId,
    personName: row.personName,
    subject,
    review: review ?? null,
  };
}

/** First open only — "did they ever see it?" wants the first time, not the last. */
export async function markAskOpened(
  db: Db,
  requestId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(reviewRequests)
    .set({ openedAt: now })
    .where(and(eq(reviewRequests.id, requestId), sql`${reviewRequests.openedAt} is null`));
}

// --- writing it ------------------------------------------------------------

export interface ReviewInput {
  readonly rating: string;
  readonly wentWell: string;
  readonly improve: string;
  readonly mayQuote: boolean;
  readonly displayName: string;
  readonly displayOrg: string;
}

export interface ValidReview {
  readonly rating: number;
  readonly wentWell: string | null;
  readonly improve: string | null;
  readonly mayQuote: boolean;
  readonly displayName: string | null;
  readonly displayOrg: string | null;
}

export type ReviewField = "rating" | "wentWell" | "improve" | "displayName" | "displayOrg";

export type ReviewValidation =
  | { readonly ok: true; readonly value: ValidReview }
  | { readonly ok: false; readonly field: ReviewField; readonly message: string };

function clean(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function validateReview(input: ReviewInput): ReviewValidation {
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, field: "rating", message: "Pick a rating from 1 to 5." };
  }
  const wentWell = clean(input.wentWell);
  if (wentWell !== null && wentWell.length > TEXT_LIMIT) {
    return {
      ok: false,
      field: "wentWell",
      message: `Keep it under ${String(TEXT_LIMIT)} characters.`,
    };
  }
  const improve = clean(input.improve);
  if (improve !== null && improve.length > TEXT_LIMIT) {
    return {
      ok: false,
      field: "improve",
      message: `Keep it under ${String(TEXT_LIMIT)} characters.`,
    };
  }
  const displayName = clean(input.displayName);
  const displayOrg = clean(input.displayOrg);
  if (input.mayQuote) {
    if (displayName === null) {
      return {
        ok: false,
        field: "displayName",
        message: "Add the name we should show beside your words.",
      };
    }
    if (displayName.length > NAME_LIMIT) {
      return {
        ok: false,
        field: "displayName",
        message: `Keep the name under ${String(NAME_LIMIT)} characters.`,
      };
    }
    if (displayOrg !== null && displayOrg.length > ORG_LIMIT) {
      return {
        ok: false,
        field: "displayOrg",
        message: `Keep it under ${String(ORG_LIMIT)} characters.`,
      };
    }
  }
  return {
    ok: true,
    value: {
      rating,
      wentWell,
      improve,
      mayQuote: input.mayQuote,
      // Without permission to quote, a public name is not something we keep.
      displayName: input.mayQuote ? displayName : null,
      displayOrg: input.mayQuote ? displayOrg : null,
    },
  };
}

export type SubmitResult =
  | { readonly ok: true; readonly reviewId: string; readonly firstTime: boolean }
  | { readonly ok: false; readonly reason: "unknown" | "expired" | "closed" };

/**
 * Write or rewrite the review behind a token, while it is still pending.
 *
 * The page state is re-read here rather than trusted from the render: a link
 * can expire, or an operator can publish, between the form loading and the
 * press of Send.
 */
export async function submitReview(
  db: Db,
  token: string,
  review: ValidReview,
  now: Date = new Date(),
): Promise<SubmitResult> {
  const state = await reviewPageState(db, token, now);
  if (state.kind !== "open") {
    return { ok: false, reason: state.kind };
  }
  const id = newId();
  // A season review is one piece of writing, signed or not: "what to improve"
  // and a club name are platform questions and are never stored for a season.
  const body: ValidReview =
    state.subject.type === "competition" ? { ...review, improve: null, displayOrg: null } : review;
  const subjectColumns =
    state.subject.type === "competition"
      ? {
          subjectType: "competition" as const,
          competitionId: state.subject.competitionId,
          orgId: state.subject.orgId,
          role: state.subject.role,
        }
      : { subjectType: "platform" as const };
  const [row] = await db
    .insert(reviews)
    .values({
      id,
      requestId: state.requestId,
      personId: state.personId,
      ...subjectColumns,
      ...body,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: reviews.requestId,
      set: { ...body, updatedAt: now },
      // The same race as above, closed at the database: a review an operator
      // moderated between the read and this write is not overwritten.
      setWhere: sql`${reviews.status} = 'pending'`,
    })
    .returning({ id: reviews.id });
  if (row === undefined) {
    return { ok: false, reason: "closed" };
  }
  return { ok: true, reviewId: row.id, firstTime: row.id === id };
}

// --- moderation ------------------------------------------------------------

export type ModerationResult =
  { readonly ok: true; readonly summary: string } | { readonly ok: false; readonly error: string };

export async function moderateReview(
  db: Db,
  reviewId: string,
  status: string,
  actorId: string,
  now: Date = new Date(),
): Promise<ModerationResult> {
  if (status !== "published" && status !== "hidden") {
    return { ok: false, error: "That isn't a status we record." };
  }
  const updated = await db
    .update(reviews)
    .set({ status, moderatedAt: now, moderatedBy: actorId })
    .where(eq(reviews.id, reviewId))
    .returning({ id: reviews.id });
  if (updated[0] === undefined) {
    return { ok: false, error: "That review no longer exists." };
  }
  return { ok: true, summary: status === "published" ? "Published." : "Hidden." };
}
