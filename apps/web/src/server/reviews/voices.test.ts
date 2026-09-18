import { describe, expect, it, vi } from "vitest";

import { shortenQuote } from "./voices";

/**
 * A quote on the landing page is somebody else's sentence. Shortening it must
 * never change what it says without showing that it was shortened.
 */
describe("shortenQuote", () => {
  it("leaves a quote under the limit exactly as written (whitespace tidied)", () => {
    expect(shortenQuote("Bidding  was\nsmooth.")).toEqual({
      quote: "Bidding was smooth.",
      shortened: false,
    });
  });

  it("cuts a long one at a word boundary and marks it", () => {
    const text = `${"The auction ran itself and the owners loved it ".repeat(10)}end`;
    const result = shortenQuote(text, 60);
    expect(result.shortened).toBe(true);
    expect(result.quote.endsWith("…")).toBe(true);
    expect(result.quote.length).toBeLessThanOrEqual(61);
    // Never mid-word: what precedes the ellipsis is a whole word of the original.
    const lastWord = result.quote.slice(0, -1).split(" ").at(-1) ?? "";
    expect(text.split(" ")).toContain(lastWord);
  });

  it("drops trailing punctuation before the ellipsis rather than doubling it", () => {
    const result = shortenQuote("Good, fast, and cheap, which never happens, honestly.", 22);
    expect(result.quote).not.toMatch(/[,.;:]…$/);
  });
});

describe("the landing section's guard", () => {
  it("renders nothing, and does not throw, when the read fails", async () => {
    vi.resetModules();
    vi.doMock("../../server/reviews/voices", () => ({
      landingVoices: () => Promise.reject(new Error("database down")),
    }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { LandingVoices } = await import("../../components/marketing/landing-voices");
    await expect(LandingVoices()).resolves.toBeNull();
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
    vi.doUnmock("../../server/reviews/voices");
  });

  it("renders nothing when there is nothing to quote", async () => {
    vi.resetModules();
    vi.doMock("../../server/reviews/voices", () => ({
      landingVoices: () => Promise.resolve([]),
    }));
    const { LandingVoices } = await import("../../components/marketing/landing-voices");
    await expect(LandingVoices()).resolves.toBeNull();
    vi.doUnmock("../../server/reviews/voices");
  });
});
