import { describe, expect, it } from "vitest";

import { ACCOUNT_ONLY_ACTIONS, inboxExclusions } from "./inbox-filter";
import type { SecurityAction } from "./security-events";

// Compile-time: every excluded action is one the ledger can actually write.
const typed: readonly SecurityAction[] = ACCOUNT_ONLY_ACTIONS;

describe("inbox filter — the inbox tells people things, the security page keeps the log", () => {
  it("leaves every routine sign-in, code request and sign-out to the security page", () => {
    const excluded = inboxExclusions([]);
    for (const action of [
      "auth.login.otp",
      "auth.login.email",
      "auth.login.passkey",
      "auth.otp.requested",
      "auth.logout",
    ]) {
      expect(excluded).toContain(action);
    }
  });

  it("keeps the account events a person should be TOLD about", () => {
    const excluded = inboxExclusions([]);
    for (const action of [
      "auth.otp.lockout",
      "auth.passkey.failed",
      "auth.session.revoked",
      "auth.phone.changed",
      "auth.signup.email",
      "auction.sold",
      "registration.approved",
    ]) {
      expect(excluded).not.toContain(action);
    }
  });

  it("adds the person's own switched-off notices, once each", () => {
    const excluded = inboxExclusions(["auction.sold", "auth.logout"]);
    expect(excluded).toContain("auction.sold");
    expect(excluded.filter((action) => action === "auth.logout")).toHaveLength(1);
    expect(excluded).toHaveLength(typed.length + 1);
  });
});
