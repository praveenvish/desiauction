import { describe, expect, it } from "vitest";

import {
  BETA_TIER,
  TIER_LIMITS,
  checkTierLimit,
  isTier,
  limitRefusalMessage,
  tierLabel,
} from "./tiers";

describe("tier limits — what a pass actually buys", () => {
  it("carries the numbers the pricing page prints", () => {
    // If these ever disagree with content/marketing.ts, one of the two is
    // selling something the other will not deliver.
    expect(TIER_LIMITS.free).toEqual({ teams: 4, players: 40 });
    expect(TIER_LIMITS.pro).toEqual({ teams: 16, players: 400 });
    expect(TIER_LIMITS.association).toEqual({ teams: null, players: null });
  });

  it("allows a season to sit exactly on its ceiling", () => {
    // "Up to 4 teams" means the fourth is fine. It is the fifth that is not.
    expect(checkTierLimit("free", "teams", 3)).toEqual({ ok: true });
    expect(checkTierLimit("free", "teams", 0)).toEqual({ ok: true });
  });

  it("blocks the fifth team on Free", () => {
    expect(checkTierLimit("free", "teams", 4)).toEqual({
      ok: false,
      subject: "teams",
      tier: "free",
      limit: 4,
      current: 4,
    });
  });

  it("blocks the forty-first player on Free, and the four-hundred-and-first on Pro", () => {
    expect(checkTierLimit("free", "players", 39).ok).toBe(true);
    expect(checkTierLimit("free", "players", 40).ok).toBe(false);
    expect(checkTierLimit("pro", "players", 399).ok).toBe(true);
    expect(checkTierLimit("pro", "players", 400).ok).toBe(false);
  });

  it("never refuses an Association season — its limits are a contract, not a number", () => {
    expect(checkTierLimit("association", "teams", 500).ok).toBe(true);
    expect(checkTierLimit("association", "players", 100_000).ok).toBe(true);
  });

  it("refuses in words an organizer can act on", () => {
    const decision = checkTierLimit("free", "teams", 4);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    const message = limitRefusalMessage(decision);
    expect(message).toContain("Free");
    expect(message).toContain("up to 4 teams");
    expect(message).toContain("already has 4");
    expect(message).toContain("Upgrade");
    // Never an enum, never a bare refusal.
    expect(message).not.toMatch(/tier_limit|forbidden|error/i);
  });

  it("grants beta seasons the uncounted tier, so the promise on the page holds", () => {
    // "Tournaments started during beta stay free forever" — with every tier.
    expect(BETA_TIER).toBe("association");
    expect(TIER_LIMITS[BETA_TIER].teams).toBeNull();
  });

  it("recognises its own tiers and nothing else", () => {
    expect(isTier("free")).toBe(true);
    expect(isTier("enterprise")).toBe(false);
    expect(tierLabel("pro")).toBe("Pro Pass");
  });
});
