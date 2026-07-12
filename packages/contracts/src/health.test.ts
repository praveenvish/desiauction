import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "./health.js";

describe("healthResponseSchema", () => {
  it("accepts a valid health response", () => {
    const result = healthResponseSchema.safeParse({
      status: "ok",
      version: "abc1234",
      checks: { db: "ok" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown statuses and missing fields", () => {
    expect(healthResponseSchema.safeParse({ status: "up", version: "x", checks: {} }).success).toBe(
      false,
    );
    expect(healthResponseSchema.safeParse({ status: "ok", checks: {} }).success).toBe(false);
  });
});
