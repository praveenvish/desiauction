import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { commandRefusalMessage } from "./auction-copy";

/**
 * EVERY REFUSAL THE AUCTION CAN GIVE HAS A SENTENCE.
 *
 * The fallback — "That didn't go through. Try again." — is advice, and for a
 * refusal that is a FACT (somebody else holds the paddle, the invitation
 * expired, the record cannot be replayed) it is the wrong advice: the retry is
 * refused identically. Twice now a reason has been added to the engine with no
 * sentence here and reached a person as "try again". This reads the reasons
 * out of the source that produces them, so the next one fails the build
 * instead of an auction night.
 */
const FALLBACK = "That didn't go through. Try again.";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Reasons that never reach `commandRefusalMessage`, and why. */
const NOT_SHOWN: ReadonlySet<string> = new Set([
  // createAuction's refusals: the setup wizard has its own sentences for them.
  "auction_exists",
  "invalid_config",
  "not_ready",
  // `reason: "undo"` is the audit reason written on a reversal, not a refusal.
  "undo",
]);

function reasonsIn(path: string, pattern: RegExp): string[] {
  const source = readFileSync(join(root, path), "utf8");
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

describe("refusal copy", () => {
  const reasons = new Set([
    ...reasonsIn("packages/auction/src/aggregate.ts", /reason: "([a-z_]+)"/g),
    ...reasonsIn("apps/engine/src/engine-core.ts", /rejected\("([a-z_]+)"\)/g),
    ...reasonsIn("apps/engine/src/engine-core.ts", /this\.reject\(\s*envelope,\s*"([a-z_]+)"/g),
    ...reasonsIn("packages/core/src/auction.ts", /^\s+\| "([A-Z_]+)"$/gm),
  ]);

  it("finds the reasons it is meant to be checking", () => {
    // A regex that silently stopped matching would make this suite vacuous.
    for (const known of ["paddle_held", "no_grant", "rate_limited", "engine_halted"]) {
      expect(reasons.has(known), known).toBe(true);
    }
    expect(reasons.has("LOT_EXPIRED")).toBe(true);
    expect(reasons.size).toBeGreaterThan(30);
  });

  it("has a sentence of its own for every reason the engine and the aggregate can return", () => {
    const unspoken = [...reasons]
      .filter((reason) => !NOT_SHOWN.has(reason))
      .filter((reason) => commandRefusalMessage(reason) === FALLBACK);
    expect(unspoken).toEqual([]);
  });

  it("never tells anyone to retry what a retry cannot change", () => {
    for (const reason of ["paddle_held", "expired", "already_accepted", "owns_another_team"]) {
      expect(commandRefusalMessage(reason).toLowerCase(), reason).not.toContain("try again");
    }
    const failedRecovery = commandRefusalMessage("replay_failed:sequence_gap");
    expect(failedRecovery).not.toBe(FALLBACK);
    expect(failedRecovery).toContain("Do not keep retrying");
  });

  it("still falls back for a reason it has genuinely never heard of", () => {
    expect(commandRefusalMessage("something_new")).toBe(FALLBACK);
    expect(commandRefusalMessage(null)).toBe(FALLBACK);
  });
});
