import { describe, expect, it } from "vitest";

import { parseVitalSample, redactPath } from "./web-vitals-report";

describe("parseVitalSample", () => {
  it("accepts a real sample, and drops the query string", () => {
    expect(
      parseVitalSample({ name: "LCP", value: 1840.5, rating: "good", path: "/c/vpl?ref=wa" }),
    ).toEqual({ name: "LCP", value: 1840.5, rating: "good", path: "/c/vpl" });
  });

  it("keeps nothing a caller adds beyond the four fields", () => {
    const parsed = parseVitalSample({
      name: "INP",
      value: 120,
      rating: "good",
      path: "/",
      email: "someone@example.com",
    });
    expect(parsed).not.toHaveProperty("email");
  });

  it.each([
    [null],
    [{ name: "FID", value: 1, rating: "good", path: "/" }],
    [{ name: "LCP", value: -1, rating: "good", path: "/" }],
    [{ name: "LCP", value: 999_999, rating: "good", path: "/" }],
    [{ name: "LCP", value: 1, rating: "great", path: "/" }],
    [{ name: "LCP", value: 1, rating: "good", path: "https://evil.example/" }],
    [{ name: "CLS", value: Number.NaN, rating: "good", path: "/" }],
  ])("refuses %j", (body) => {
    expect(parseVitalSample(body)).toBeNull();
  });
});

describe("redactPath", () => {
  it("keeps a page's shape and hides anything that could be a token", () => {
    expect(redactPath("/seasons/vpl-1-513q/auction")).toBe("/seasons/vpl-1-513q/auction");
    expect(redactPath("/join/9f2c1a7e3b4d5c6e7f8a9b0c")).toBe("/join/:redacted");
  });
});
