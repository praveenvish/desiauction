import { createHttpEmailAdapter, parseEmailCallback } from "@desiauction/messaging/email-adapter";
import { describe, expect, it, vi } from "vitest";

import { handleSesWebhook, sesEventActions, type SesWebhookDeps } from "./ses-webhook";

const TOPIC = "arn:aws:sns:ap-south-1:123456789012:desiauction-ses-events";

/** SES event-publishing JSON, trimmed to the fields that decide anything. */
function sesEvent(type: string, extra: Record<string, unknown>, tags?: Record<string, string[]>) {
  return JSON.stringify({
    eventType: type,
    mail: {
      messageId: "0109019281c4-ses-msg",
      destination: ["owner@example.com"],
      ...(tags === undefined ? {} : { tags }),
    },
    ...extra,
  });
}

const permanentBounce = (tags?: Record<string, string[]>) =>
  sesEvent(
    "Bounce",
    {
      bounce: {
        bounceType: "Permanent",
        bounceSubType: "NoEmail",
        bouncedRecipients: [{ emailAddress: "Gone@Example.com" }],
      },
    },
    tags,
  );

describe("sesEventActions — what each SES event asks of us", () => {
  it("suppresses a permanent bounce", () => {
    expect(sesEventActions(permanentBounce()).actions).toEqual([
      {
        kind: "suppress",
        recipient: "Gone@Example.com",
        reason: "bounce",
        note: "ses bounce: NoEmail",
      },
    ]);
  });

  it("leaves a transient or undetermined bounce alone — a full mailbox is not a reason to stop", () => {
    for (const bounceType of ["Transient", "Undetermined"]) {
      const event = sesEvent("Bounce", {
        bounce: { bounceType, bouncedRecipients: [{ emailAddress: "full@example.com" }] },
      });
      expect(sesEventActions(event).actions).toEqual([]);
    }
  });

  it("suppresses a complaint", () => {
    const event = sesEvent("Complaint", {
      complaint: {
        complaintFeedbackType: "abuse",
        complainedRecipients: [{ emailAddress: "angry@example.com" }],
      },
    });
    expect(sesEventActions(event).actions).toEqual([
      {
        kind: "suppress",
        recipient: "angry@example.com",
        reason: "complaint",
        note: "ses complaint: abuse",
      },
    ]);
  });

  it("reads the older identity-notification shape too", () => {
    const legacy = JSON.stringify({
      notificationType: "Bounce",
      mail: { messageId: "m" },
      bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "x@example.com" }] },
    });
    expect(sesEventActions(legacy).actions).toHaveLength(1);
  });

  it("ignores events that are not delivery truth", () => {
    for (const type of ["Send", "Open", "Click", "DeliveryDelay", "Reject"]) {
      expect(sesEventActions(sesEvent(type, {})).actions).toEqual([]);
    }
    expect(sesEventActions("{not json").type).toBe("unparseable");
  });

  /*
   * The finops half. A receipt is tagged `dispatch=<id>` when sent (the
   * adapter); its Delivery / Bounce must come back as the generic report the
   * CERTIFIED platform already verifies — proved here by running the report
   * through the real adapter's verifyCallback, not by comparing JSON.
   */
  describe("reports about a receipt reach the platform in the shape it verifies", () => {
    const adapter = createHttpEmailAdapter(
      { endpoint: "https://x.test", apiKey: "k", from: "f" },
      () => Promise.resolve(null),
    );
    const reportsOf = (message: string) =>
      sesEventActions(message).actions.flatMap((a) => (a.kind === "report" ? [a.raw] : []));

    it("Delivery → delivered", () => {
      const [raw] = reportsOf(
        sesEvent(
          "Delivery",
          { delivery: { recipients: ["owner@example.com"] } },
          { dispatch: ["01DISPATCH"] },
        ),
      );
      expect(adapter.verifyCallback?.(raw ?? "")).toMatchObject({
        ok: true,
        dispatchId: "01DISPATCH",
        kind: "delivered",
      });
    });

    it("permanent bounce → failed, and the address suppressed as well", () => {
      const actions = sesEventActions(permanentBounce({ dispatch: ["01DISPATCH"] })).actions;
      expect(actions.map((a) => a.kind)).toEqual(["suppress", "report"]);
      const raw = actions[1]?.kind === "report" ? actions[1].raw : "";
      expect(adapter.verifyCallback?.(raw)).toMatchObject({
        ok: true,
        kind: "failed",
        code: "bounced",
      });
      expect(parseEmailCallback(raw)?.recipient).toBe("Gone@Example.com");
    });

    it("mail that is not a receipt produces no report", () => {
      expect(
        reportsOf(sesEvent("Delivery", { delivery: { recipients: ["a@example.com"] } })),
      ).toEqual([]);
    });

    it("gives each message, event and recipient its own event id, so replays collapse", () => {
      const tags = { dispatch: ["01DISPATCH"] };
      const first = reportsOf(
        sesEvent("Delivery", { delivery: { recipients: ["a@example.com"] } }, tags),
      );
      const again = reportsOf(
        sesEvent("Delivery", { delivery: { recipients: ["a@example.com"] } }, tags),
      );
      expect(parseEmailCallback(first[0] ?? "")?.providerEventRef).toBe(
        parseEmailCallback(again[0] ?? "")?.providerEventRef,
      );
    });
  });
});

function deps(overrides: Partial<SesWebhookDeps> = {}) {
  const calls = { suppress: [] as unknown[], report: [] as string[], confirm: [] as string[] };
  const value: SesWebhookDeps = {
    topicArn: TOPIC,
    verify: () => Promise.resolve(true),
    confirm: (url) => {
      calls.confirm.push(url);
      return Promise.resolve(true);
    },
    suppress: (action) => {
      calls.suppress.push(action);
      return Promise.resolve();
    },
    report: (raw) => {
      calls.report.push(raw);
      return Promise.resolve();
    },
    log: vi.fn(),
    ...overrides,
  };
  return { value, calls };
}

function envelope(fields: Record<string, unknown>): string {
  return JSON.stringify({
    Type: "Notification",
    MessageId: "sns-1",
    TopicArn: TOPIC,
    Message: permanentBounce({ dispatch: ["01DISPATCH"] }),
    Timestamp: "2026-09-28T10:00:00.000Z",
    SignatureVersion: "2",
    Signature: "c2ln",
    SigningCertURL: "https://sns.ap-south-1.amazonaws.com/cert.pem",
    ...fields,
  });
}

describe("handleSesWebhook — one SNS POST", () => {
  it("acts on a verified notification from our topic: suppression first, then the report", async () => {
    const { value, calls } = deps();
    const result = await handleSesWebhook(envelope({}), value);
    expect(result).toEqual({ status: 200, body: { status: "ok", event: "Bounce" } });
    expect(calls.suppress).toHaveLength(1);
    expect(calls.report).toHaveLength(1);
  });

  it("refuses a bad signature before reading anything, and never acts", async () => {
    const { value, calls } = deps({ verify: () => Promise.resolve(false) });
    expect((await handleSesWebhook(envelope({}), value)).status).toBe(403);
    expect(calls.suppress).toEqual([]);
  });

  it("refuses a validly signed message from somebody else's topic", async () => {
    const { value, calls } = deps();
    const foreign = envelope({ TopicArn: "arn:aws:sns:ap-south-1:999999999999:theirs" });
    expect((await handleSesWebhook(foreign, value)).status).toBe(403);
    expect(calls.suppress).toEqual([]);
  });

  it("rejects a body that is not an SNS message", async () => {
    expect((await handleSesWebhook("hello", deps().value)).status).toBe(400);
  });

  it("confirms a subscription to our topic by visiting its SNS URL", async () => {
    const { value, calls } = deps();
    const url = "https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&Token=t";
    const result = await handleSesWebhook(
      envelope({
        Type: "SubscriptionConfirmation",
        SubscribeURL: url,
        Token: "t",
        Message: "confirm",
      }),
      value,
    );
    expect(result.status).toBe(200);
    expect(calls.confirm).toEqual([url]);
  });

  it("will not visit a SubscribeURL off SNS's own host", async () => {
    const { value, calls } = deps();
    const result = await handleSesWebhook(
      envelope({
        Type: "SubscriptionConfirmation",
        SubscribeURL: "https://evil.test/x",
        Token: "t",
      }),
      value,
    );
    expect(result.status).toBe(400);
    expect(calls.confirm).toEqual([]);
  });

  it("asks SNS to redeliver when the database write fails", async () => {
    const { value } = deps({ suppress: () => Promise.reject(new Error("db down")) });
    await expect(handleSesWebhook(envelope({}), value)).rejects.toThrow("db down");
  });
});
