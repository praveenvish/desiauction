import { createDb, newId, people, reviews, type DbHandle } from "@desiauction/db";
import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { moderate } from "./desk";
import {
  askForPlatformReview,
  submitReview,
  tokenForReviewRequest,
  type ValidReview,
} from "./reviews";
import { landingVoices } from "./voices";

/**
 * FR-1 Phase 5 — the one door through which the landing page may quote anyone —
 * against Postgres. Only a published, permitted, signed platform review with
 * words in it passes; newest-published first, never best-rated first.
 *
 * The landing read is global, so these assertions look only at this suite's
 * own rows (found by id) rather than at the list's length or head.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const MARK = "FR1P5-REGRESSION";

const BASE: ValidReview = {
  rating: 5,
  wentWell: "Owners bid from their phones and nobody argued about who bid first.",
  improve: null,
  mayQuote: true,
  displayName: "Ravi K",
  displayOrg: "Sunday Premier League",
};

async function review(
  overrides: Partial<ValidReview> = {},
  status: "pending" | "published" | "hidden" = "published",
): Promise<string> {
  const personId = newId();
  await db.insert(people).values({
    id: personId,
    name: `${MARK} ${personId.slice(-4)}`,
    email: `fr1p5-${personId.toLowerCase()}@example.test`,
  });
  const ask = await askForPlatformReview(db, {
    personId,
    source: "manual_admin",
    requestedBy: null,
  });
  const written = await submitReview(db, tokenForReviewRequest(ask.requestId), {
    ...BASE,
    ...overrides,
  });
  if (!written.ok) {
    throw new Error(written.reason);
  }
  if (status !== "pending") {
    await moderate(written.reviewId, status, personId);
  }
  return written.reviewId;
}

beforeAll(async () => {
  await db.delete(people).where(like(people.name, `${MARK}%`));
});

afterAll(async () => {
  await db.delete(people).where(like(people.name, `${MARK}%`));
  await handle.sql.end({ timeout: 5 });
});

describe("FR-1 P5 · what the landing page may quote", () => {
  it("a published, permitted, signed platform review with words — and nothing else", async () => {
    const shown = await review();
    const pending = await review({}, "pending");
    const hidden = await review({}, "hidden");
    const unpermitted = await review({ mayQuote: false, displayName: null, displayOrg: null });
    const wordless = await review({ wentWell: null });

    const ids = (await landingVoices(500)).map((voice) => voice.id);
    expect(ids).toContain(shown);
    for (const excluded of [pending, hidden, unpermitted, wordless]) {
      expect(ids).not.toContain(excluded);
    }
  });

  it("quotes the words as written, under the chosen name", async () => {
    const id = await review({ wentWell: "  Exactly   these words.  " });
    const voice = (await landingVoices(500)).find((candidate) => candidate.id === id);
    expect(voice?.quote).toBe("Exactly these words.");
    expect(voice?.name).toBe("Ravi K");
    expect(voice?.org).toBe("Sunday Premier League");
  });

  it("newest published first, not best rated first", async () => {
    const older = await review({ rating: 5 });
    const newer = await review({ rating: 2, wentWell: "Honest two stars." });
    const ids = (await landingVoices(500)).map((voice) => voice.id);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
  });

  it("unpublishing takes it off the page", async () => {
    const id = await review();
    expect((await landingVoices(500)).map((voice) => voice.id)).toContain(id);
    const [author] = await db
      .select({ personId: reviews.personId })
      .from(reviews)
      .where(inArray(reviews.id, [id]));
    await moderate(id, "hidden", author?.personId ?? "");
    expect((await landingVoices(500)).map((voice) => voice.id)).not.toContain(id);
  });

  it("never a season review, even a signed and published one", async () => {
    const seasonReviews = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(inArray(reviews.subjectType, ["competition"]))
      .limit(50);
    const ids = new Set((await landingVoices(500)).map((voice) => voice.id));
    for (const row of seasonReviews) {
      expect(ids.has(row.id)).toBe(false);
    }
  });
});
