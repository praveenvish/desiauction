/**
 * BETA COLLECTS MANUALLY, AND THAT MUST BE A FACT RATHER THAN A COINCIDENCE.
 *
 * Decision D1 (2026-09-04): cash / UPI / bank capture is the money path for
 * beta; the Razorpay gateway stays off. Today it is off for a good reason —
 * `settlementAccount()` defaults to null, and a null account REFUSES the
 * payment rather than falling back to the platform's own account, which is the
 * difference between a payments product and collecting money on behalf of third
 * parties (a different regulated business, and the opposite of what the Terms
 * say).
 *
 * But "off because a default happens to be null" is not the same as "off
 * because we decided", and the distance between them is one well-meaning commit
 * wiring an onboarding flow. This asserts the refusal so the decision has to be
 * taken deliberately, in the open, by somebody deleting a test that says why.
 *
 * When gateway collection is genuinely enabled, this file is the checklist:
 * every expectation here should be re-read, not merely deleted.
 */
import { describe, expect, it } from "vitest";

import { settlementDeps } from "../server/settlement/deps";
import { dbHandle } from "../server/db";

const deps = settlementDeps(dbHandle.db);

describe("POSTURE — gateway collection is off by decision (D1)", () => {
  it("has no settlement account for any org, so a gateway order cannot be created", async () => {
    const account = await deps.settlementAccount("01M1POSTUREGATEWAY00ORG01");
    expect(
      account,
      "an org resolved a gateway settlement account — gateway collection is no " +
        "longer refused, and beta was decided to collect manually (D1). If that " +
        "changed on purpose, every organizer needs a KYC'd linked account first, " +
        "or their dues land in the platform's own account.",
    ).toBeNull();
  });

  it("keeps the manual methods available — they are the beta money path", () => {
    // The refusal above must not be a blanket "no payments": cash, UPI and bank
    // capture are how a beta organizer actually gets paid. Each resolves its own
    // manual adapter — the first draft of this test asserted null here and was
    // simply wrong about the design, which is worth leaving on the record.
    for (const method of ["manual:cash", "manual:upi-direct", "manual:bank"]) {
      expect(
        deps.gateway(method),
        `${method} lost its adapter — beta cannot collect`,
      ).not.toBeNull();
    }
  });
});
