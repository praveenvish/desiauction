import { people, reviewRequests, reviews, type Db } from "@desiauction/db";
import { desc, eq } from "drizzle-orm";

import { systemDb } from "../db";

/**
 * THE REVIEW DESK, AS A PROJECTION (FR-1 Phase 2).
 *
 * Read-only like every module in administration; the writes live in
 * `server/reviews/desk.ts`. Two lists: the reviews (pending first — that is the
 * work) and the asks (who was asked, whether it reached them, whether they
 * opened it), because "should I nudge?" needs the second.
 */

export interface DeskReview {
  readonly id: string;
  readonly personName: string | null;
  readonly rating: number;
  readonly wentWell: string | null;
  readonly improve: string | null;
  readonly mayQuote: boolean;
  readonly displayName: string | null;
  readonly displayOrg: string | null;
  readonly status: "pending" | "published" | "hidden";
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DeskAsk {
  readonly id: string;
  readonly personName: string | null;
  readonly personEmail: string | null;
  readonly source: string;
  readonly sentAt: Date | null;
  readonly openedAt: Date | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly reviewed: boolean;
}

export interface ReviewDesk {
  readonly pending: readonly DeskReview[];
  readonly published: readonly DeskReview[];
  readonly hidden: readonly DeskReview[];
  readonly asks: readonly DeskAsk[];
}

const LIMIT = 100;

/** `db` is injectable so the read-only proof can drive it through a refusing handle. */
export async function reviewDesk(db: Db = systemDb): Promise<ReviewDesk> {
  const rows = await db
    .select({
      id: reviews.id,
      personName: people.name,
      rating: reviews.rating,
      wentWell: reviews.wentWell,
      improve: reviews.improve,
      mayQuote: reviews.mayQuote,
      displayName: reviews.displayName,
      displayOrg: reviews.displayOrg,
      status: reviews.status,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
    })
    .from(reviews)
    .innerJoin(people, eq(people.id, reviews.personId))
    .orderBy(desc(reviews.createdAt))
    .limit(LIMIT);

  const askRows = await db
    .select({
      id: reviewRequests.id,
      personName: people.name,
      personEmail: people.email,
      source: reviewRequests.source,
      sentAt: reviewRequests.sentAt,
      openedAt: reviewRequests.openedAt,
      expiresAt: reviewRequests.expiresAt,
      createdAt: reviewRequests.createdAt,
      reviewId: reviews.id,
    })
    .from(reviewRequests)
    .innerJoin(people, eq(people.id, reviewRequests.personId))
    .leftJoin(reviews, eq(reviews.requestId, reviewRequests.id))
    .orderBy(desc(reviewRequests.createdAt))
    .limit(LIMIT);

  return {
    pending: rows.filter((row) => row.status === "pending"),
    published: rows.filter((row) => row.status === "published"),
    hidden: rows.filter((row) => row.status === "hidden"),
    asks: askRows.map(({ reviewId, ...ask }) => ({ ...ask, reviewed: reviewId !== null })),
  };
}
