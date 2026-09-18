import {
  createDb,
  newId,
  notificationPreferences,
  people,
  playerProfiles,
  reviewRequests,
  reviews,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { setTransactionalMailerForTest, type OutgoingMail } from "../messaging/transactional-mail";
import { askByContact } from "./desk";
import {
  askForPlatformReview,
  markAskOpened,
  moderateReview,
  reviewPageState,
  submitReview,
  tokenForReviewRequest,
  validateReview,
  type ValidReview,
} from "./reviews";

/**
 * FR-1 Phase 2 against a real database — the properties that would fail
 * silently if only written down:
 *
 *   1 · No RLS on either table, deliberately (the principal is a link token).
 *   2 · One ask per person: asking again re-issues, never duplicates.
 *   3 · The token page tells unknown, open, expired and closed apart.
 *   4 · A review is editable while pending and frozen once moderated — even
 *       against a write that read "pending" a moment earlier.
 *   5 · The desk refuses known minors and honours "stop asking me".
 *   6 · Deleting a person deletes the ask and the review.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const MARK = "FR1P2-REGRESSION";
const createdPeople: string[] = [];
const sent: OutgoingMail[] = [];

const REVIEW: ValidReview = (() => {
  const result = validateReview({
    rating: "5",
    wentWell: "Owners bid from their phones without a hitch.",
    improve: "",
    mayQuote: true,
    displayName: "Ravi K",
    displayOrg: "",
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.value;
})();

async function person(overrides: { email?: string | null; phone?: string | null } = {}) {
  const id = newId();
  const email =
    overrides.email === undefined ? `fr1p2-${id.toLowerCase()}@example.test` : overrides.email;
  await db.insert(people).values({
    id,
    name: `${MARK} Organizer`,
    email,
    phone: overrides.phone ?? null,
  });
  createdPeople.push(id);
  return { id, email };
}

beforeAll(async () => {
  await db.delete(people).where(like(people.name, `${MARK}%`));
  setTransactionalMailerForTest({
    send: (mail: OutgoingMail) => {
      sent.push(mail);
      return Promise.resolve("sent");
    },
  });
});

afterAll(async () => {
  setTransactionalMailerForTest(null);
  if (createdPeople.length > 0) {
    await db.delete(people).where(inArray(people.id, createdPeople));
  }
  await handle.sql.end({ timeout: 5 });
});

describe("FR-1 P2 · the no-RLS decision is deliberate, and asserted", () => {
  it("review_requests and reviews carry no policies", async () => {
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(
      sql`select relname, relrowsecurity from pg_class
          where relkind = 'r' and relname in ('review_requests', 'reviews')`,
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} must stay RLS-free`).toBe(false);
    }
  });
});

describe("FR-1 P2 · one ask per person", () => {
  it("asking twice re-issues the same request and pushes its expiry out", async () => {
    const { id } = await person();
    const first = await askForPlatformReview(db, {
      personId: id,
      source: "manual_admin",
      requestedBy: null,
      now: new Date(Date.now() - 20 * 86_400_000),
    });
    const again = await askForPlatformReview(db, {
      personId: id,
      source: "manual_admin",
      requestedBy: null,
    });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.requestId).toBe(first.requestId);
    expect(again.link).toBe(first.link);
    const rows = await db.select().from(reviewRequests).where(eq(reviewRequests.personId, id));
    expect(rows.length).toBe(1);
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it("two asks at once still make one row", async () => {
    const { id } = await person();
    const asks = await Promise.all(
      [1, 2, 3].map(() =>
        askForPlatformReview(db, { personId: id, source: "manual_admin", requestedBy: null }),
      ),
    );
    expect(new Set(asks.map((ask) => ask.requestId)).size).toBe(1);
  });
});

describe("FR-1 P2 · the page behind the link", () => {
  it("unknown, open, expired and closed are four different answers", async () => {
    expect((await reviewPageState(db, "not-a-token")).kind).toBe("unknown");
    expect((await reviewPageState(db, "A".repeat(32))).kind).toBe("unknown");

    const { id } = await person();
    const ask = await askForPlatformReview(db, {
      personId: id,
      source: "manual_admin",
      requestedBy: null,
    });
    const token = tokenForReviewRequest(ask.requestId);
    const open = await reviewPageState(db, token);
    expect(open.kind).toBe("open");

    const later = new Date(Date.now() + 31 * 86_400_000);
    expect((await reviewPageState(db, token, later)).kind).toBe("expired");

    const written = await submitReview(db, token, REVIEW);
    expect(written.ok).toBe(true);
    const operator = await person();
    if (written.ok) {
      await moderateReview(db, written.reviewId, "published", operator.id);
    }
    // Closed outranks expired: somebody whose review we published sees that,
    // not a lapsed link.
    expect((await reviewPageState(db, token, later)).kind).toBe("closed");
  });

  it("records the first open only", async () => {
    const { id } = await person();
    const ask = await askForPlatformReview(db, {
      personId: id,
      source: "manual_admin",
      requestedBy: null,
    });
    const first = new Date(Date.now() - 60_000);
    await markAskOpened(db, ask.requestId, first);
    await markAskOpened(db, ask.requestId, new Date());
    const [row] = await db
      .select({ openedAt: reviewRequests.openedAt })
      .from(reviewRequests)
      .where(eq(reviewRequests.id, ask.requestId));
    expect(row?.openedAt?.getTime()).toBe(first.getTime());
  });
});

describe("FR-1 P2 · writing and moderating", () => {
  it("rewrites while pending, then freezes once moderated", async () => {
    const { id } = await person();
    const ask = await askForPlatformReview(db, {
      personId: id,
      source: "manual_admin",
      requestedBy: null,
    });
    const token = tokenForReviewRequest(ask.requestId);

    const first = await submitReview(db, token, REVIEW);
    expect(first.ok && first.firstTime).toBe(true);
    const second = await submitReview(db, token, { ...REVIEW, rating: 3 });
    expect(second.ok && second.firstTime).toBe(false);
    const [row] = await db.select().from(reviews).where(eq(reviews.requestId, ask.requestId));
    expect(row?.rating).toBe(3);

    if (row === undefined) {
      throw new Error("the review was not written");
    }
    const operator = await person();
    await moderateReview(db, row.id, "hidden", operator.id);
    const third = await submitReview(db, token, { ...REVIEW, rating: 1 });
    expect(third).toEqual({ ok: false, reason: "closed" });
    const [after] = await db.select().from(reviews).where(eq(reviews.id, row.id));
    expect(after?.rating).toBe(3);
    expect(after?.status).toBe("hidden");
  });

  it("the database refuses a quote with no name, and a moderated status with no time", async () => {
    const { id } = await person();
    const ask = await askForPlatformReview(db, {
      personId: id,
      source: "manual_admin",
      requestedBy: null,
    });
    await expect(
      db.insert(reviews).values({
        id: newId(),
        requestId: ask.requestId,
        personId: id,
        rating: 5,
        mayQuote: true,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(reviews).values({
        id: newId(),
        requestId: ask.requestId,
        personId: id,
        rating: 5,
        status: "published",
      }),
    ).rejects.toThrow();
  });

  it("moderation refuses anything but published or hidden", async () => {
    const operator = await person();
    expect((await moderateReview(db, newId(), "deleted", operator.id)).ok).toBe(false);
    expect((await moderateReview(db, newId(), "published", operator.id)).ok).toBe(false);
  });
});

describe("FR-1 P2 · the desk", () => {
  it("emails the ask and records where it went", async () => {
    const { id, email } = await person();
    sent.length = 0;
    const outcome = await askByContact(email ?? "", id);
    expect(outcome.ok && outcome.delivery).toBe("sent");
    expect(sent.map((mail) => mail.to)).toEqual([email]);
    expect(sent[0]?.text).toContain("/review/");
    const [row] = await db.select().from(reviewRequests).where(eq(reviewRequests.personId, id));
    expect(row?.sentTo).toBe(email);
  });

  it("finds people by number too, and hands back a link when there is no email", async () => {
    const phone = `+9199${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
    const { id } = await person({ email: null, phone });
    const outcome = await askByContact(phone.slice(3), id);
    expect(outcome.ok && outcome.delivery).toBe("no-address");
    expect(outcome.ok && outcome.link).toContain("/review/");
  });

  it("honours 'feedback requests: off'", async () => {
    const { id, email } = await person();
    await db.insert(notificationPreferences).values({
      id: newId(),
      personId: id,
      topic: "feedback",
      channel: "email",
      allowed: false,
    });
    sent.length = 0;
    const outcome = await askByContact(email ?? "", id);
    expect(outcome.ok && outcome.delivery).toBe("opted-out");
    expect(sent).toEqual([]);
  });

  it("refuses a known minor and asks nothing", async () => {
    const { id, email } = await person();
    await db
      .insert(playerProfiles)
      .values({ id: newId(), personId: id, dateOfBirth: "2012-01-01" });
    const outcome = await askByContact(email ?? "", id);
    expect(outcome.ok).toBe(false);
    const rows = await db.select().from(reviewRequests).where(eq(reviewRequests.personId, id));
    expect(rows).toEqual([]);
  });

  it("does not ask again once they have reviewed", async () => {
    const { id, email } = await person();
    const ask = await askForPlatformReview(db, {
      personId: id,
      source: "manual_admin",
      requestedBy: null,
    });
    await submitReview(db, tokenForReviewRequest(ask.requestId), REVIEW);
    sent.length = 0;
    const outcome = await askByContact(email ?? "", id);
    expect(outcome.ok && outcome.delivery).toBe("skipped-already-reviewed");
    expect(sent).toEqual([]);
  });

  it("refuses somebody who has never signed in", async () => {
    const outcome = await askByContact(`nobody-${newId()}@example.test`, newId());
    expect(outcome.ok).toBe(false);
  });
});

describe("FR-1 P2 · a person's review is theirs", () => {
  it("deleting the person deletes the ask and the review", async () => {
    const { id } = await person();
    const ask = await askForPlatformReview(db, {
      personId: id,
      source: "manual_admin",
      requestedBy: null,
    });
    await submitReview(db, tokenForReviewRequest(ask.requestId), REVIEW);
    await db.delete(people).where(eq(people.id, id));
    expect(
      await db.select().from(reviewRequests).where(eq(reviewRequests.id, ask.requestId)),
    ).toEqual([]);
    expect(await db.select().from(reviews).where(eq(reviews.requestId, ask.requestId))).toEqual([]);
  });
});
