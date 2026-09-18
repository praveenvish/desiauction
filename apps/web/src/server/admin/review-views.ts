import {
  competitions,
  people,
  reviewReports,
  reviewRequests,
  reviews,
  type Db,
} from "@desiauction/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

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
  /** Phase 4: null for a platform review. */
  readonly seasonName: string | null;
  readonly seasonSlug: string | null;
  readonly role: "player" | "owner" | null;
  readonly organizerReply: string | null;
  /** Open (unresolved) reader reports, newest first. */
  readonly reports: readonly { reason: string; note: string | null; createdAt: Date }[];
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
      seasonName: competitions.name,
      seasonSlug: competitions.slug,
      role: reviews.role,
      organizerReply: reviews.organizerReply,
    })
    .from(reviews)
    .innerJoin(people, eq(people.id, reviews.personId))
    .leftJoin(competitions, eq(competitions.id, reviews.competitionId))
    .orderBy(desc(reviews.createdAt))
    .limit(LIMIT);

  const reportRows =
    rows.length === 0
      ? []
      : await db
          .select({
            reviewId: reviewReports.reviewId,
            reason: reviewReports.reason,
            note: reviewReports.note,
            createdAt: reviewReports.createdAt,
          })
          .from(reviewReports)
          .where(
            and(
              inArray(
                reviewReports.reviewId,
                rows.map((row) => row.id),
              ),
              isNull(reviewReports.resolvedAt),
            ),
          )
          .orderBy(desc(reviewReports.createdAt));
  const reportsByReview = new Map<string, DeskReview["reports"][number][]>();
  for (const report of reportRows) {
    const list = reportsByReview.get(report.reviewId) ?? [];
    list.push({ reason: report.reason, note: report.note, createdAt: report.createdAt });
    reportsByReview.set(report.reviewId, list);
  }
  const shaped: DeskReview[] = rows.map((row) => ({
    ...row,
    reports: reportsByReview.get(row.id) ?? [],
  }));

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
    // Reported reviews come first within their list: a report is somebody
    // waiting on us, the same as a pending review is.
    pending: shaped.filter((row) => row.status === "pending"),
    published: shaped
      .filter((row) => row.status === "published")
      .sort((a, b) => b.reports.length - a.reports.length),
    hidden: shaped.filter((row) => row.status === "hidden"),
    asks: askRows.map(({ reviewId, ...ask }) => ({ ...ask, reviewed: reviewId !== null })),
  };
}
