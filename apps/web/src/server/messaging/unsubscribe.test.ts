import { describe, expect, it } from "vitest";

import { env } from "../../env";
import { createResendProvider } from "@desiauction/messaging/mail-provider";

import { HttpTransactionalMailer } from "./transactional-mail";
import {
  isSelfManagedKind,
  oneClickUnsubscribeUrl,
  unsubscribeHeaders,
  unsubscribeToken,
  unsubscribeTokenMatches,
} from "./unsubscribe";

const PERSON = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const OTHER = "01JABCDEFGHJKMNPQRSTVWXYZ1";

describe("the unsubscribe link", () => {
  it("proves one person and one topic, and nothing else", () => {
    const token = unsubscribeToken(PERSON, "auction");
    expect(unsubscribeTokenMatches(PERSON, "auction", token)).toBe(true);
    expect(unsubscribeTokenMatches(OTHER, "auction", token)).toBe(false);
    expect(unsubscribeTokenMatches(PERSON, "registration", token)).toBe(false);
    expect(unsubscribeTokenMatches(PERSON, "auction", `${token.slice(0, -1)}x`)).toBe(false);
    expect(unsubscribeTokenMatches(PERSON, "auction", undefined)).toBe(false);
    expect(unsubscribeTokenMatches("not-an-id", "auction", token)).toBe(false);
  });

  it("refuses a topic nobody can switch off, even with a well-formed token", () => {
    for (const topic of ["login", "security", "demo", "staff"]) {
      expect(unsubscribeTokenMatches(PERSON, topic, unsubscribeToken(PERSON, topic))).toBe(false);
    }
  });

  it("points at our own host", () => {
    expect(oneClickUnsubscribeUrl(PERSON, "auction").startsWith(env.PUBLIC_BASE_URL)).toBe(true);
  });
});

describe("which mail carries List-Unsubscribe", () => {
  it("a mail the reader can switch off, to a person", () => {
    for (const kind of ["auction.sold", "registration.approved", "review.platform_ask"] as const) {
      expect(isSelfManagedKind(kind)).toBe(true);
      const headers = unsubscribeHeaders(kind, PERSON);
      expect(headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(headers?.["List-Unsubscribe"]).toMatch(
        /^<https?:\/\/.+\/api\/email\/unsubscribe\?.+>$/,
      );
    }
  });

  it("never a code, a security alert, a stranger's or a staff mail — or a mail with no person", () => {
    for (const kind of [
      "auth.email_code",
      "security.email_changed",
      "demo.booking_confirmed",
      "staff.problem_report",
    ] as const) {
      expect(unsubscribeHeaders(kind, PERSON)).toBeUndefined();
    }
    expect(unsubscribeHeaders("auction.sold", null)).toBeUndefined();
  });
});

describe("the provider's message id", () => {
  it("comes back from a send, with the headers passed to the provider", async () => {
    let sentBody: Record<string, unknown> = {};
    const mailer = new HttpTransactionalMailer({
      provider: createResendProvider({
        endpoint: "https://api.resend.com/emails",
        apiKey: "key",
        from: "DesiAuction <hello@desiauction.in>",
        transport: (_url, init) => {
          sentBody = JSON.parse(init.body) as Record<string, unknown>;
          return Promise.resolve({ status: 200, body: '{"id":"msg_123"}' });
        },
      }),
    });
    const receipt = await mailer.deliver({
      to: "arjun@example.com",
      subject: "s",
      text: "t",
      headers: { "List-Unsubscribe": "<https://desiauction.in/x>" },
    });
    expect(receipt).toEqual({ outcome: "sent", providerMessageId: "msg_123" });
    expect(sentBody["headers"]).toEqual({ "List-Unsubscribe": "<https://desiauction.in/x>" });
    // `send` is the same call, answering the outcome alone.
    expect(await mailer.send({ to: "a@example.com", subject: "s", text: "t" })).toBe("sent");
  });

  it("is null on a refusal", async () => {
    const mailer = new HttpTransactionalMailer({
      provider: createResendProvider({
        endpoint: "https://api.resend.com/emails",
        apiKey: "key",
        from: "hello@desiauction.in",
        transport: () => Promise.resolve({ status: 422, body: '{"id":"never"}' }),
      }),
    });
    expect(await mailer.deliver({ to: "a@example.com", subject: "s", text: "t" })).toEqual({
      outcome: "failed",
      providerMessageId: null,
    });
  });
});
