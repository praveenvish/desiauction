import { reviews } from "@desiauction/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "../db";

/**
 * WHAT THE LANDING PAGE MAY QUOTE (FR-1 Phase 5).
 *
 * The landing page has been uniformly no-fabrication since the 2026-07-24
 * council ruling, and a content test fails the build if its static copy ever
 * carries a testimonial. That rule stays exactly as it is. The founder's
 * 2026-09-17 decision opens ONE door beside it, and this function is the door:
 * a quote reaches the landing page only when every one of these is true —
 *
 *   · it is a PLATFORM review (about DesiAuction, not about somebody's league);
 *   · a person we asked, by name, wrote it through their own link;
 *   · an operator PUBLISHED it;
 *   · its author ticked "DesiAuction may quote this review" and signed it
 *     (the CHECK in 0065 refuses a quote without a name);
 *   · it says something — a rating alone is not a quote.
 *
 * Nothing here is written by us, edited by us, or chosen by rating: the most
 * recently published come first, whatever they gave. A shortened quote says so
 * with an ellipsis rather than silently becoming a different sentence.
 */

export const VOICES_SHOWN = 3;
export const QUOTE_LIMIT = 280;

export interface LandingVoice {
  readonly id: string;
  readonly quote: string;
  readonly shortened: boolean;
  readonly name: string;
  readonly org: string | null;
  readonly rating: number;
  readonly publishedAt: Date;
}

/** Cut at a word boundary, never mid-word, and say that it was cut. */
export function shortenQuote(
  text: string,
  limit: number = QUOTE_LIMIT,
): {
  quote: string;
  shortened: boolean;
} {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) {
    return { quote: clean, shortened: false };
  }
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return {
    quote: `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, "")}…`,
    shortened: true,
  };
}

export async function landingVoices(
  limit: number = VOICES_SHOWN,
): Promise<readonly LandingVoice[]> {
  const rows = await db
    .select({
      id: reviews.id,
      wentWell: reviews.wentWell,
      name: reviews.displayName,
      org: reviews.displayOrg,
      rating: reviews.rating,
      publishedAt: reviews.moderatedAt,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.subjectType, "platform"),
        eq(reviews.status, "published"),
        eq(reviews.mayQuote, true),
        isNotNull(reviews.displayName),
        sql`length(trim(coalesce(${reviews.wentWell}, ''))) > 0`,
      ),
    )
    .orderBy(desc(reviews.moderatedAt))
    .limit(limit);
  return rows.flatMap((row) => {
    if (row.wentWell === null || row.name === null || row.publishedAt === null) {
      return [];
    }
    const { quote, shortened } = shortenQuote(row.wentWell);
    return [
      {
        id: row.id,
        quote,
        shortened,
        name: row.name,
        org: row.org,
        rating: row.rating,
        publishedAt: row.publishedAt,
      },
    ];
  });
}
