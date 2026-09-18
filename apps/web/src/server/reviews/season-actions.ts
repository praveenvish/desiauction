"use server";

import { withTenantDb } from "@desiauction/db";
import { revalidatePath } from "next/cache";

import { currentSession } from "../auth/actions";
import { canCompetition } from "../competition/authz";
import { resolveCompetition } from "../competition/competitions";
import { dbHandle, systemDb } from "../db";
import { reviewRequests, reviews } from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";
import {
  ORG_ASK_COOLDOWN_MS,
  PUBLIC_MIN_REVIEWS,
  askSeason,
  lastOrgAsk,
  publishedSeasonReviews,
  replyToReview,
  seasonRef,
  unaskedParticipants,
  mayAskParticipant,
  type ReplyResult,
  type SeasonReviews,
} from "./season";

/**
 * A SEASON'S REVIEWS, FOR THE PEOPLE WHO RAN IT (FR-1 Phase 4).
 *
 * Anybody who can open the season can read what the public reads. Holders of
 * `competition.manage` — the club's owners — also get what only a club can do:
 * answer a review, and ask the players and owners for one. Nobody at the club
 * ever sees a review before an operator publishes it, and nobody at the club
 * can edit, hide or delete one; those are platform decisions.
 *
 * GATE THE DATA, NOT THE BUTTON. The counts of who could be asked are computed
 * only for a manager, so a team owner opening this tab learns nothing about
 * the season's other participants.
 */

async function gate(slug: string) {
  const session = await currentSession();
  if (session === null) {
    return null;
  }
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const canManage = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    (db) =>
      canCompetition(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "competition.manage",
      ),
  );
  return { personId: session.personId, competition, canManage };
}

export interface SeasonReviewsView {
  readonly seasonName: string;
  readonly orgName: string;
  readonly isPublic: boolean;
  readonly canManage: boolean;
  /** What this viewer may read. A non-manager sees exactly the public rule. */
  readonly shown: SeasonReviews | null;
  readonly publicThreshold: number;
  /** Manager-only. */
  readonly manage: {
    readonly askable: { readonly players: number; readonly owners: number };
    readonly asked: number;
    readonly reviewed: number;
    readonly awaitingModeration: number;
    readonly lastAskedAt: Date | null;
    readonly nextAskAt: Date | null;
  } | null;
}

export async function seasonReviewsView(slug: string): Promise<SeasonReviewsView | null> {
  const access = await gate(slug);
  if (access === null) {
    return null;
  }
  const season = await seasonRef(access.competition.id);
  if (season === null) {
    return null;
  }
  const published = await publishedSeasonReviews(season.id, 50);
  const shown = access.canManage
    ? published
    : published.count >= PUBLIC_MIN_REVIEWS
      ? published
      : null;

  if (!access.canManage) {
    return {
      seasonName: season.name,
      orgName: season.orgName,
      isPublic: season.visibility === "public",
      canManage: false,
      shown,
      publicThreshold: PUBLIC_MIN_REVIEWS,
      manage: null,
    };
  }

  const now = new Date();
  const [participants, counts, lastAskedAt] = await Promise.all([
    unaskedParticipants(season.id, ["player", "owner"]),
    systemDb
      .select({
        asked: sql<number>`count(distinct ${reviewRequests.id})::int`,
        reviewed: sql<number>`count(${reviews.id})::int`,
        awaiting: sql<number>`count(${reviews.id}) filter (where ${reviews.status} = 'pending')::int`,
      })
      .from(reviewRequests)
      .leftJoin(reviews, eq(reviews.requestId, reviewRequests.id))
      .where(
        and(
          eq(reviewRequests.subjectType, "competition"),
          eq(reviewRequests.competitionId, season.id),
        ),
      ),
    lastOrgAsk(season.id),
  ]);
  const askable = participants.filter((participant) => mayAskParticipant(participant, now));
  const nextAskAt =
    lastAskedAt !== null && now.getTime() - lastAskedAt.getTime() < ORG_ASK_COOLDOWN_MS
      ? new Date(lastAskedAt.getTime() + ORG_ASK_COOLDOWN_MS)
      : null;
  return {
    seasonName: season.name,
    orgName: season.orgName,
    isPublic: season.visibility === "public",
    canManage: true,
    shown,
    publicThreshold: PUBLIC_MIN_REVIEWS,
    manage: {
      askable: {
        players: askable.filter((participant) => participant.role === "player").length,
        owners: askable.filter((participant) => participant.role === "owner").length,
      },
      asked: counts[0]?.asked ?? 0,
      reviewed: counts[0]?.reviewed ?? 0,
      awaitingModeration: counts[0]?.awaiting ?? 0,
      lastAskedAt,
      nextAskAt,
    },
  };
}

export type AskSeasonResult =
  { readonly ok: true; readonly summary: string } | { readonly ok: false; readonly error: string };

export async function askSeasonReviewsAction(slug: string): Promise<AskSeasonResult> {
  if (typeof slug !== "string") {
    return { ok: false, error: "Not available." };
  }
  const access = await gate(slug);
  if (access === null || !access.canManage) {
    return { ok: false, error: "Only the club's owners can ask for reviews." };
  }
  const season = await seasonRef(access.competition.id);
  if (season === null) {
    return { ok: false, error: "Not available." };
  }
  // Once a week. The button is for "the season is done, please tell people",
  // not for chasing — and a club that could press it daily could make the
  // platform the one nagging its players.
  const last = await lastOrgAsk(season.id);
  if (last !== null && Date.now() - last.getTime() < ORG_ASK_COOLDOWN_MS) {
    const next = new Date(last.getTime() + ORG_ASK_COOLDOWN_MS);
    return {
      ok: false,
      error: `You asked recently. You can ask again from ${next.toISOString().slice(0, 10)}.`,
    };
  }
  const result = await askSeason(season, {
    roles: ["player", "owner"],
    source: "manual_org",
    requestedBy: access.personId,
  });
  revalidatePath(`/seasons/${slug}/reviews`);
  if (result.asked === 0) {
    return { ok: true, summary: "Everyone we can ask has already been asked." };
  }
  return {
    ok: true,
    summary: `Asked ${String(result.asked)} ${result.asked === 1 ? "person" : "people"}; ${String(result.mailed)} emailed.`,
  };
}

export async function replyToReviewAction(
  slug: string,
  reviewId: string,
  text: string,
): Promise<ReplyResult> {
  if (typeof slug !== "string" || typeof reviewId !== "string" || typeof text !== "string") {
    return { ok: false, error: "Not available." };
  }
  const access = await gate(slug);
  if (access === null || !access.canManage) {
    return { ok: false, error: "Only the club's owners can reply to reviews." };
  }
  const result = await replyToReview(access.competition.id, reviewId, text, access.personId);
  if (result.ok) {
    revalidatePath(`/seasons/${slug}/reviews`);
    revalidatePath(`/c/${slug}`);
  }
  return result;
}
