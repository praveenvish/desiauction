import {
  auctionEvents,
  auctions,
  competitions,
  createDb,
  fixtures,
  grants,
  newId,
  notificationPreferences,
  organizations,
  paddles,
  people,
  playerProfiles,
  registrations,
  reviewReports,
  reviewRequests,
  reviews,
  teams,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { setTransactionalMailerForTest, type OutgoingMail } from "../messaging/transactional-mail";
import { dismissReports, moderate } from "./desk";
import { sweepReviewAsks } from "./review-sweep";
import {
  askForPlatformReview,
  reviewPageState,
  submitReview,
  tokenForReviewRequest,
  validateReview,
  type ValidReview,
} from "./reviews";
import {
  askSeason,
  publicSeasonReviews,
  publishedSeasonReviews,
  replyToReview,
  reportReview,
  seasonRef,
} from "./season";

/**
 * FR-1 Phase 4 — tournament reviews — against Postgres.
 *
 * Who is asked about a season, what a season review stores, what the public
 * may see and when, what an organizer may do to a review (reply, nothing else),
 * and how a reader's report reaches an operator. Plain inserts into RLS-forced
 * tenant tables work because local runs connect as a superuser; the sweep part
 * is isolated by time (2020 fixtures, 2020 clock), as in review-sweep's suite.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const MARK = "FR1P4-REGRESSION";
const NOW = new Date("2026-09-18T09:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const sent: OutgoingMail[] = [];

const REVIEW: ValidReview = (() => {
  const result = validateReview({
    rating: "4",
    wentWell: "Well run, and the auction night was the best part.",
    improve: "should be dropped for a season review",
    mayQuote: false,
    displayName: "",
    displayOrg: "should be dropped too",
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.value;
})();

function emailOf(personId: string): string {
  return `fr1p4-${personId.toLowerCase()}@example.test`;
}

async function person(opts: { email?: boolean; dob?: string } = {}): Promise<string> {
  const id = newId();
  await db.insert(people).values({
    id,
    name: `${MARK} ${id.slice(-4)}`,
    email: opts.email === false ? null : emailOf(id),
    phone: opts.email === false ? `+9196${id.slice(-8).replace(/\D/g, "3").padEnd(8, "3")}` : null,
  });
  if (opts.dob !== undefined) {
    await db.insert(playerProfiles).values({ id: newId(), personId: id, dateOfBirth: opts.dob });
  }
  return id;
}

interface Season {
  readonly orgId: string;
  readonly id: string;
  readonly name: string;
  readonly orgName: string;
  readonly organizer: string;
}

async function season(visibility: "public" | "private" = "public"): Promise<Season> {
  const organizer = await person();
  const orgId = newId();
  const id = newId();
  await db.insert(organizations).values({
    id: orgId,
    name: `${MARK} Club`,
    slug: `fr1p4-${orgId.toLowerCase()}`,
    createdBy: organizer,
  });
  await db.insert(competitions).values({
    id,
    orgId,
    sport: "cricket",
    name: `${MARK} Premier League`,
    slug: `fr1p4-s-${id.toLowerCase()}`,
    visibility,
    createdBy: organizer,
  });
  await db.insert(grants).values({
    id: newId(),
    personId: organizer,
    scopeType: "org",
    scopeId: orgId,
    capabilitySet: "org:owner",
    grantedBy: organizer,
  });
  return { orgId, id, name: `${MARK} Premier League`, orgName: `${MARK} Club`, organizer };
}

async function player(
  where: Season,
  personId: string,
  status: "approved" | "rejected" = "approved",
  dob?: string,
): Promise<void> {
  await db.insert(registrations).values({
    id: newId(),
    orgId: where.orgId,
    competitionId: where.id,
    personId,
    status,
    ...(dob === undefined ? {} : { dateOfBirth: dob }),
  });
}

async function auctionFor(where: Season, closedAt: Date | null = null): Promise<string> {
  const auctionId = newId();
  await db.insert(auctions).values({
    id: auctionId,
    orgId: where.orgId,
    competitionId: where.id,
    name: `${MARK} Auction`,
    status: "completed",
    config: {},
    createdBy: where.organizer,
  });
  if (closedAt !== null) {
    await db.insert(auctionEvents).values({
      id: newId(),
      orgId: where.orgId,
      auctionId,
      seq: 1,
      type: "AuctionClosed",
      atMs: closedAt.getTime(),
      actor: where.organizer,
      correlationId: newId(),
      payload: {},
      createdAt: closedAt,
    });
  }
  return auctionId;
}

async function owner(where: Season, auctionId: string, personId: string): Promise<void> {
  const teamId = newId();
  await db.insert(teams).values({
    id: teamId,
    orgId: where.orgId,
    competitionId: where.id,
    name: `${MARK} Team ${teamId.slice(-4)}`,
    createdBy: where.organizer,
  });
  await db.insert(paddles).values({
    id: newId(),
    orgId: where.orgId,
    auctionId,
    teamId,
    personId,
    paddleNumber: teamId.slice(-6),
  });
}

async function seasonAsk(personId: string, competitionId: string) {
  const [row] = await db
    .select()
    .from(reviewRequests)
    .where(
      and(eq(reviewRequests.personId, personId), eq(reviewRequests.competitionId, competitionId)),
    );
  return row;
}

/** A published season review, written through the real page path. */
async function publishedReview(
  where: Season,
  overrides: Partial<ValidReview> = {},
): Promise<string> {
  const reviewer = await person({ dob: "1990-01-01" });
  await player(where, reviewer);
  await askSeason(where, { roles: ["player"], source: "manual_org", requestedBy: null, now: NOW });
  const ask = await seasonAsk(reviewer, where.id);
  if (ask === undefined) {
    throw new Error("the reviewer was not asked");
  }
  const written = await submitReview(db, tokenForReviewRequest(ask.id), {
    ...REVIEW,
    ...overrides,
  });
  if (!written.ok) {
    throw new Error(`review not written: ${written.reason}`);
  }
  await moderate(written.reviewId, "published", where.organizer);
  return written.reviewId;
}

async function cleanup(): Promise<void> {
  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(like(organizations.name, `${MARK}%`));
  const ids = orgs.map((row) => row.id);
  if (ids.length > 0) {
    await db.delete(paddles).where(inArray(paddles.orgId, ids));
    await db.delete(teams).where(inArray(teams.orgId, ids));
    await db.delete(auctionEvents).where(inArray(auctionEvents.orgId, ids));
    await db.delete(auctions).where(inArray(auctions.orgId, ids));
    await db.delete(fixtures).where(inArray(fixtures.orgId, ids));
    await db.delete(registrations).where(inArray(registrations.orgId, ids));
    await db.delete(grants).where(inArray(grants.scopeId, ids));
    // Review rows cascade with the competition (0070).
    await db.delete(competitions).where(inArray(competitions.orgId, ids));
    await db.delete(organizations).where(inArray(organizations.id, ids));
  }
  await db.delete(people).where(like(people.name, `${MARK}%`));
}

beforeAll(async () => {
  await cleanup();
  setTransactionalMailerForTest({
    send: (mail: OutgoingMail) => {
      sent.push(mail);
      return Promise.resolve("sent");
    },
  });
});

afterAll(async () => {
  setTransactionalMailerForTest(null);
  await cleanup();
  await handle.sql.end({ timeout: 5 });
});

describe("FR-1 P4 · who is asked about a season", () => {
  it("adult approved players and paddle holders — and nobody else", async () => {
    const where = await season();
    const adult = await person({ dob: "1995-05-05" });
    const adultByRegistration = await person();
    const undated = await person();
    const minor = await person({ dob: "2011-01-01" });
    const rejected = await person({ dob: "1990-01-01" });
    const bidder = await person();
    const both = await person({ dob: "1988-08-08" });
    await player(where, adult);
    await player(where, adultByRegistration, "approved", "1992-02-02");
    await player(where, undated);
    await player(where, minor);
    await player(where, rejected, "rejected");
    await player(where, both);
    const auctionId = await auctionFor(where);
    await owner(where, auctionId, bidder);
    await owner(where, auctionId, both);

    sent.length = 0;
    const result = await askSeason(where, {
      roles: ["player", "owner"],
      source: "manual_org",
      requestedBy: where.organizer,
      now: NOW,
    });

    expect((await seasonAsk(adult, where.id))?.role).toBe("player");
    expect((await seasonAsk(adultByRegistration, where.id))?.role).toBe("player");
    expect((await seasonAsk(bidder, where.id))?.role).toBe("owner");
    // Played AND bid: asked once, as the owner.
    expect((await seasonAsk(both, where.id))?.role).toBe("owner");
    // Founder decision: a player with no date of birth is not asked.
    expect(await seasonAsk(undated, where.id)).toBeUndefined();
    expect(await seasonAsk(minor, where.id)).toBeUndefined();
    expect(await seasonAsk(rejected, where.id)).toBeUndefined();
    // A club does not review itself.
    expect(await seasonAsk(where.organizer, where.id)).toBeUndefined();
    expect(result.asked).toBe(4);
    expect(result.notEligible).toBe(2);

    const toOwner = sent.find((mail) => mail.to === emailOf(bidder));
    expect(toOwner?.subject).toBe(`How was ${where.name}?`);
    expect(toOwner?.text).toContain("You bid for a team");
    expect(toOwner?.text).toContain('"A team owner"');
    expect(sent.find((mail) => mail.to === emailOf(adult))?.text).toContain("You played in");
  });

  it("never asks the club about its own season, even when an organizer also bid or played", async () => {
    const where = await season();
    const staff = await person({ dob: "1985-01-01" });
    await db.insert(grants).values({
      id: newId(),
      personId: staff,
      scopeType: "org",
      scopeId: where.orgId,
      capabilitySet: "org:staff",
      grantedBy: where.organizer,
    });
    const auctionId = await auctionFor(where);
    await owner(where, auctionId, where.organizer);
    await player(where, staff);
    await askSeason(where, {
      roles: ["player", "owner"],
      source: "manual_org",
      requestedBy: null,
      now: NOW,
    });
    expect(await seasonAsk(where.organizer, where.id)).toBeUndefined();
    expect(await seasonAsk(staff, where.id)).toBeUndefined();
  });

  it("asks each person once per season, and never twice", async () => {
    const where = await season();
    const adult = await person({ dob: "1990-01-01" });
    await player(where, adult);
    await askSeason(where, {
      roles: ["player"],
      source: "manual_org",
      requestedBy: null,
      now: NOW,
    });
    sent.length = 0;
    const again = await askSeason(where, {
      roles: ["player"],
      source: "manual_org",
      requestedBy: null,
      now: NOW,
    });
    expect(again.asked).toBe(0);
    expect(sent).toEqual([]);
  });

  it("a season ask and the platform ask live side by side (two partial indexes)", async () => {
    const where = await season();
    const adult = await person({ dob: "1990-01-01" });
    await player(where, adult);
    await askForPlatformReview(db, { personId: adult, source: "manual_admin", requestedBy: null });
    await askSeason(where, {
      roles: ["player"],
      source: "manual_org",
      requestedBy: null,
      now: NOW,
    });
    const rows = await db.select().from(reviewRequests).where(eq(reviewRequests.personId, adult));
    expect(rows.map((row) => row.subjectType).sort()).toEqual(["competition", "platform"]);
    // The platform re-issue still finds its row under the new partial index.
    const again = await askForPlatformReview(db, {
      personId: adult,
      source: "manual_admin",
      requestedBy: null,
    });
    expect(again.created).toBe(false);
  });

  it("records but never mails somebody who switched feedback requests off", async () => {
    const where = await season();
    const adult = await person({ dob: "1990-01-01" });
    await player(where, adult);
    await db.insert(notificationPreferences).values({
      id: newId(),
      personId: adult,
      topic: "feedback",
      channel: "email",
      allowed: false,
    });
    sent.length = 0;
    const result = await askSeason(where, {
      roles: ["player"],
      source: "manual_org",
      requestedBy: null,
      now: NOW,
    });
    expect(result.optedOut).toBe(1);
    expect((await seasonAsk(adult, where.id))?.sentAt).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe("FR-1 P4 · what a season review is", () => {
  it("the page knows the season, and the review stores one text, no club name", async () => {
    const where = await season();
    const adult = await person({ dob: "1990-01-01" });
    await player(where, adult);
    await askSeason(where, {
      roles: ["player"],
      source: "manual_org",
      requestedBy: null,
      now: NOW,
    });
    const ask = await seasonAsk(adult, where.id);
    const token = tokenForReviewRequest(ask?.id ?? "");
    const state = await reviewPageState(db, token);
    expect(state.kind === "open" && state.subject).toEqual({
      type: "competition",
      competitionId: where.id,
      orgId: where.orgId,
      role: "player",
    });
    const written = await submitReview(db, token, REVIEW);
    expect(written.ok).toBe(true);
    const [row] = await db
      .select()
      .from(reviews)
      .where(eq(reviews.requestId, ask?.id ?? ""));
    expect(row?.subjectType).toBe("competition");
    expect(row?.competitionId).toBe(where.id);
    expect(row?.role).toBe("player");
    expect(row?.improve).toBeNull();
    expect(row?.displayOrg).toBeNull();
  });

  it("the database refuses a season row with no season, and a platform row with one", async () => {
    const adult = await person();
    await expect(
      db.insert(reviewRequests).values({
        id: newId(),
        personId: adult,
        subjectType: "competition",
        source: "manual_org",
        tokenHash: `fr1p4-${newId()}`,
        expiresAt: NOW,
      }),
    ).rejects.toThrow();
    const where = await season();
    await expect(
      db.insert(reviewRequests).values({
        id: newId(),
        personId: adult,
        subjectType: "platform",
        competitionId: where.id,
        source: "manual_admin",
        tokenHash: `fr1p4-${newId()}`,
        expiresAt: NOW,
      }),
    ).rejects.toThrow();
  });
});

describe("FR-1 P4 · what the public sees", () => {
  it("nothing below three published reviews, then the reviews and their average", async () => {
    const where = await season();
    await publishedReview(where, { rating: 5 });
    await publishedReview(where, { rating: 4 });
    expect(await publicSeasonReviews(where.id)).toBeNull();
    await publishedReview(where, { rating: 3, mayQuote: true, displayName: "Ravi K" });
    const shown = await publicSeasonReviews(where.id);
    expect(shown?.count).toBe(3);
    expect(shown?.average).toBe(4);
    const signed = shown?.reviews.find((review) => review.signedName !== null);
    expect(signed?.signedName).toBe("Ravi K");
    expect(shown?.reviews.filter((review) => review.signedName === null).length).toBe(2);
  });

  it("never for a private season, and never an unread or hidden review", async () => {
    const hiddenSeason = await season("private");
    for (let index = 0; index < 3; index += 1) {
      await publishedReview(hiddenSeason);
    }
    expect(await publicSeasonReviews(hiddenSeason.id)).toBeNull();

    const where = await season();
    const kept = await publishedReview(where);
    await publishedReview(where);
    const hidden = await publishedReview(where);
    await moderate(hidden, "hidden", where.organizer);
    // Two published, one hidden: below the floor.
    expect(await publicSeasonReviews(where.id)).toBeNull();
    const all = await publishedSeasonReviews(where.id);
    expect(all.reviews.map((review) => review.id)).toContain(kept);
    expect(all.reviews.map((review) => review.id)).not.toContain(hidden);
  });
});

describe("FR-1 P4 · the club answers; it does not edit", () => {
  it("replies to its own season's published review, and can take the reply back", async () => {
    const where = await season();
    const reviewId = await publishedReview(where);
    const replied = await replyToReview(
      where.id,
      reviewId,
      "Thanks — see you next season.",
      where.organizer,
    );
    expect(replied.ok).toBe(true);
    const [row] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
    expect(row?.organizerReply).toBe("Thanks — see you next season.");
    expect(row?.wentWell).toBe(REVIEW.wentWell);
    const removed = await replyToReview(where.id, reviewId, "   ", where.organizer);
    expect(removed.ok).toBe(true);
    const [after] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
    expect(after?.organizerReply).toBeNull();
    expect(after?.organizerReplyAt).toBeNull();
  });

  it("cannot reach another club's review by changing the id, or an unread one", async () => {
    const mine = await season();
    const theirs = await season();
    const theirReview = await publishedReview(theirs);
    expect((await replyToReview(mine.id, theirReview, "hi", mine.organizer)).ok).toBe(false);
    expect((await replyToReview(mine.id, theirReview, "x".repeat(1001), mine.organizer)).ok).toBe(
      false,
    );
  });

  it("the database refuses a reply on a platform review", async () => {
    const adult = await person();
    const ask = await askForPlatformReview(db, {
      personId: adult,
      source: "manual_admin",
      requestedBy: null,
    });
    await expect(
      db.insert(reviews).values({
        id: newId(),
        requestId: ask.requestId,
        personId: adult,
        rating: 4,
        organizerReply: "a club has no business here",
        organizerReplyAt: NOW,
      }),
    ).rejects.toThrow();
  });
});

describe("FR-1 P4 · a reader objects", () => {
  it("reports a published public review; hiding it answers the report", async () => {
    const where = await season();
    const reviewId = await publishedReview(where);
    const reported = await reportReview({
      reviewId,
      reason: "abusive",
      note: "names a player",
      ip: "198.51.100.41",
      personId: null,
    });
    expect(reported.ok).toBe(true);
    await moderate(reviewId, "hidden", where.organizer);
    const [report] = await db
      .select()
      .from(reviewReports)
      .where(eq(reviewReports.reviewId, reviewId));
    expect(report?.resolvedAt).not.toBeNull();
  });

  it("dismissing keeps the review up and closes the reports", async () => {
    const where = await season();
    const reviewId = await publishedReview(where);
    await reportReview({ reviewId, reason: "false", note: "", ip: null, personId: null });
    const dismissed = await dismissReports(reviewId, where.organizer);
    expect(dismissed.ok).toBe(true);
    const [row] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
    expect(row?.status).toBe("published");
    expect((await dismissReports(reviewId, where.organizer)).ok).toBe(false);
  });

  it("still throttles when there is no network address — by the signed-in person", async () => {
    // Gate P3: a null address used to mean no limit at all.
    const where = await season();
    const reviewId = await publishedReview(where);
    const reader = await person();
    const at = new Date("2031-03-01T10:00:00.000Z");
    for (let i = 0; i < 12; i += 1) {
      await reportReview({
        reviewId,
        reason: "spam",
        note: "",
        ip: null,
        personId: reader,
        now: at,
      });
    }
    const rows = await db
      .select({ id: reviewReports.id })
      .from(reviewReports)
      .where(eq(reviewReports.reporterPersonId, reader));
    expect(rows).toHaveLength(10);
  });

  it("caps reports with neither address nor session across the whole platform", async () => {
    const where = await season();
    const reviewId = await publishedReview(where);
    // A clock no other test uses, so the hour holds only this test's rows.
    const at = new Date("2031-04-01T10:00:00.000Z");
    for (let i = 0; i < 33; i += 1) {
      await reportReview({ reviewId, reason: "spam", note: "", ip: null, personId: null, now: at });
    }
    const rows = await db
      .select({ id: reviewReports.id })
      .from(reviewReports)
      .where(eq(reviewReports.reviewId, reviewId));
    expect(rows).toHaveLength(30);
  });

  it("refuses what is not on show, and an unknown reason", async () => {
    const privateSeason = await season("private");
    const privateReview = await publishedReview(privateSeason);
    expect(
      (
        await reportReview({
          reviewId: privateReview,
          reason: "spam",
          note: "",
          ip: null,
          personId: null,
        })
      ).ok,
    ).toBe(false);
    const where = await season();
    const reviewId = await publishedReview(where);
    expect(
      (await reportReview({ reviewId, reason: "i-dislike-it", note: "", ip: null, personId: null }))
        .ok,
    ).toBe(false);
  });

  it("a flood from one address is thanked and not stored", async () => {
    const where = await season();
    const reviewId = await publishedReview(where);
    const ip = `198.51.100.${String(Math.floor(Math.random() * 50) + 150)}`;
    await db.delete(reviewReports).where(eq(reviewReports.reporterIp, ip));
    for (let index = 0; index < 12; index += 1) {
      const result = await reportReview({ reviewId, reason: "spam", note: "", ip, personId: null });
      expect(result.ok).toBe(true);
    }
    const stored = await db.select().from(reviewReports).where(eq(reviewReports.reporterIp, ip));
    expect(stored.length).toBe(10);
  });
});

describe("FR-1 P4 · the sweep asks about seasons too", () => {
  const CLOSED = new Date("2020-02-10T10:00:00.000Z");
  const SWEEP = new Date(CLOSED.getTime() + 3 * HOUR);

  it("an auction closing asks its owners about the season — not yet its players", async () => {
    const where = await season();
    const bidder = await person();
    const adult = await person({ dob: "1990-01-01" });
    await player(where, adult);
    const auctionId = await auctionFor(where, CLOSED);
    await owner(where, auctionId, bidder);
    await sweepReviewAsks(SWEEP);
    expect((await seasonAsk(bidder, where.id))?.source).toBe("auction_completed");
    expect(await seasonAsk(adult, where.id)).toBeUndefined();
  });

  it("a season finishing asks its players and owners", async () => {
    const where = await season();
    const adult = await person({ dob: "1990-01-01" });
    await player(where, adult);
    await db.insert(fixtures).values({
      id: newId(),
      orgId: where.orgId,
      competitionId: where.id,
      fixtureNumber: "M1",
      seq: 1,
      status: "completed",
      completedAt: CLOSED,
      createdBy: where.organizer,
    });
    await sweepReviewAsks(SWEEP);
    expect((await seasonAsk(adult, where.id))?.source).toBe("season_completed");
  });
});

describe("FR-1 P4 · names", () => {
  it("seasonRef reads a tenant season's names on the system pool", async () => {
    const where = await season();
    const ref = await seasonRef(where.id);
    expect(ref?.name).toBe(where.name);
    expect(ref?.orgName).toBe(where.orgName);
    expect(await seasonRef(newId())).toBeNull();
  });
});
