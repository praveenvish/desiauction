import { describe, expect, it } from "vitest";

import { reviewArrivedMail, reviewAskMail } from "./review-mail";
import {
  ageOn,
  hashReviewToken,
  isKnownMinor,
  reviewLink,
  tokenForReviewRequest,
  validateReview,
  type ReviewInput,
} from "./reviews";

/**
 * The rules a review page and a review desk live by, with no database: who may
 * be asked, what a review may say, what a quote needs, and what the mail says.
 */

const NOW = new Date("2026-09-17T09:00:00.000Z");

const base: ReviewInput = {
  rating: "4",
  wentWell: "The gavel never lagged.",
  improve: "",
  mayQuote: false,
  displayName: "",
  displayOrg: "",
};

function valid(overrides: Partial<ReviewInput> = {}) {
  const result = validateReview({ ...base, ...overrides });
  if (!result.ok) {
    throw new Error(`expected valid, got ${result.field}: ${result.message}`);
  }
  return result.value;
}

describe("ageOn / isKnownMinor", () => {
  it("counts whole years, turning over on the birthday", () => {
    expect(ageOn("2008-09-17", NOW)).toBe(18);
    expect(ageOn("2008-09-18", NOW)).toBe(17);
    expect(ageOn("1990-01-01", NOW)).toBe(36);
  });

  it("treats an unreadable date as unknown, not as an adult or a minor", () => {
    expect(ageOn(null, NOW)).toBeNull();
    expect(ageOn("17/09/2008", NOW)).toBeNull();
    expect(isKnownMinor({ dateOfBirth: null }, NOW)).toBe(false);
  });

  it("refuses a known minor and allows an adult", () => {
    expect(isKnownMinor({ dateOfBirth: "2010-05-01" }, NOW)).toBe(true);
    expect(isKnownMinor({ dateOfBirth: "2000-05-01" }, NOW)).toBe(false);
  });
});

describe("the review link", () => {
  it("is derived, stable, 32 URL-safe characters, and differs per request", () => {
    const a = tokenForReviewRequest("01J00000000000000000000001");
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(tokenForReviewRequest("01J00000000000000000000001")).toBe(a);
    expect(tokenForReviewRequest("01J00000000000000000000002")).not.toBe(a);
  });

  it("is never its own hash, and the link carries the token in the path", () => {
    const token = tokenForReviewRequest("01J00000000000000000000001");
    expect(hashReviewToken(token)).not.toContain(token);
    expect(reviewLink("01J00000000000000000000001")).toMatch(new RegExp(`/review/${token}$`));
  });

  it("is not the demo booking link for the same id", async () => {
    const { tokenForRequest } = await import("../marketing/demo-booking");
    expect(tokenForReviewRequest("01J00000000000000000000001")).not.toBe(
      tokenForRequest("01J00000000000000000000001"),
    );
  });
});

describe("validateReview", () => {
  it("needs a whole-number rating from 1 to 5", () => {
    for (const rating of ["", "0", "6", "3.5", "four"]) {
      const result = validateReview({ ...base, rating });
      expect(!result.ok && result.field, `rating ${rating}`).toBe("rating");
    }
    expect(valid({ rating: "1" }).rating).toBe(1);
  });

  it("allows a rating with no words, and trims blank words to nothing", () => {
    const review = valid({ wentWell: "   ", improve: "" });
    expect(review.wentWell).toBeNull();
    expect(review.improve).toBeNull();
  });

  it("caps each text", () => {
    const result = validateReview({ ...base, improve: "x".repeat(2001) });
    expect(!result.ok && result.field).toBe("improve");
  });

  it("a quote needs a name to sign it with", () => {
    const result = validateReview({ ...base, mayQuote: true, displayName: " " });
    expect(!result.ok && result.field).toBe("displayName");
    const signed = valid({ mayQuote: true, displayName: "Ravi K", displayOrg: "Sunday PL" });
    expect(signed.displayName).toBe("Ravi K");
    expect(signed.displayOrg).toBe("Sunday PL");
  });

  it("keeps no public name without permission to quote", () => {
    const review = valid({ mayQuote: false, displayName: "Ravi K", displayOrg: "Sunday PL" });
    expect(review.displayName).toBeNull();
    expect(review.displayOrg).toBeNull();
  });
});

describe("the mail", () => {
  it("the ask names the link, how long it lasts, and how to stop being asked", async () => {
    const { subject, text } = await reviewAskMail("Ravi", "https://desiauction.in/review/abc");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(text).toContain("https://desiauction.in/review/abc");
    expect(text).toContain("30 days");
    expect(text).toContain("Feedback requests");
    // No nudging: a review we steered is a review we cannot quote honestly.
    expect(text.toLowerCase()).not.toMatch(/5 stars|five stars|reward|discount|voucher/);
  });

  it("the arrival note says whether it may be quoted", async () => {
    const quoted = await reviewArrivedMail(
      valid({ mayQuote: true, displayName: "Ravi K" }),
      "Ravi Kumar",
    );
    expect(quoted.subject).toBe("[Review] 4/5 from Ravi Kumar");
    expect(quoted.text).toContain("May quote, signed: Ravi K");
    expect((await reviewArrivedMail(valid(), null)).text).toContain("Not for quoting.");
  });
});
