import type { Db } from "@desiauction/db";
import { describe, expect, it, vi } from "vitest";

// The gate calls `maySend` inside packages/messaging, so the mock goes on the
// module it actually imports; the web path below is a re-export of it.
vi.mock("@desiauction/messaging/consent", () => ({
  maySend: vi.fn(() => Promise.resolve({ send: true })),
}));
// The platform's switches, as the catalogue leaves them: this db is a stub
// with no tables to read (their own rules are platform-switches.test).
vi.mock("@desiauction/messaging/platform-switches", async (importOriginal) => {
  const real = await importOriginal<typeof import("@desiauction/messaging/platform-switches")>();
  return {
    ...real,
    platformSwitches: () => Promise.resolve(real.CATALOGUE_DEFAULTS),
    withPlatformSwitches: (
      _db: unknown,
      entry: Parameters<typeof real.effectiveOn>[1],
      channel: Parameters<typeof real.effectiveOn>[2],
    ) => Promise.resolve(real.effectiveOn(real.CATALOGUE_DEFAULTS, entry, channel)),
  };
});

import { maySend } from "../messaging/consent";
import type { OutgoingMail, TransactionalMailer } from "../messaging/transactional-mail";
import { emailChangedCopy, maskEmail, notifyEmailChanged } from "./email-changed-notice";

const db = {} as Db;

function recorder(): TransactionalMailer & { sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    send: (mail) => {
      sent.push(mail);
      return Promise.resolve("sent");
    },
  };
}

describe("the email-change notice (gate P1-6)", () => {
  it("goes to the OLD address and names the new one only masked", async () => {
    const mailer = recorder();
    const outcome = await notifyEmailChanged(db, "owner@example.com", "thief@evil.test", mailer);
    expect(outcome).toBe("sent");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("owner@example.com");
    expect(mailer.sent[0]?.subject).toMatch(/sign-in email was changed/);
    expect(mailer.sent[0]?.text).toContain("t•••@evil.test");
    expect(mailer.sent[0]?.text).not.toContain("thief@evil.test");
    expect(mailer.sent[0]?.html).not.toContain("thief@evil.test");
  });

  it("asks the send gate about the old address as a transactional security notice", async () => {
    await notifyEmailChanged(db, "owner@example.com", "new@example.com", recorder());
    expect(maySend).toHaveBeenLastCalledWith(db, {
      contact: "owner@example.com",
      channel: "email",
      category: "transactional",
      scope: "security",
    });
  });

  it("stays silent when a hard suppression says stop", async () => {
    vi.mocked(maySend).mockResolvedValueOnce({ send: false, reason: "suppressed" });
    const mailer = recorder();
    expect(await notifyEmailChanged(db, "owner@example.com", "new@example.com", mailer)).toBe(
      "refused",
    );
    expect(mailer.sent).toHaveLength(0);
  });

  it("has nobody to tell for a first address", async () => {
    const mailer = recorder();
    expect(await notifyEmailChanged(db, null, "new@example.com", mailer)).toBe("skipped");
    expect(mailer.sent).toHaveLength(0);
  });

  it("masks to the first letter and the domain", () => {
    expect(maskEmail("arjun@example.com")).toBe("a•••@example.com");
    expect(emailChangedCopy("arjun@example.com").text).toContain("a•••@example.com");
  });
});
