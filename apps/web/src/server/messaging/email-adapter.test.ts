import { describe, expect, it } from "vitest";

import {
  createHttpEmailAdapter,
  subjectFor,
  type EmailResolver,
  type EmailTransport,
} from "./email-adapter";

const request = {
  dispatchId: "01DISPATCH",
  orgId: "01ORG",
  channel: "email" as const,
  recipientRef: "owner:01TEAM",
  templateId: "receipt.issued",
  templateVersion: "1",
  subjectRef: "doc:01DOC",
  body: "Receipt RCT/2026-27/000001 for Rs 1,20,000",
  bodyDigest: "digest",
  idempotencyKey: "dispatch:01DISPATCH",
};

const ok: EmailTransport = () => Promise.resolve({ status: 202, body: "{}" });
const resolves: EmailResolver = () => Promise.resolve("player@example.com");

function adapter(transport: EmailTransport, resolve: EmailResolver = resolves) {
  return createHttpEmailAdapter(
    {
      endpoint: "https://provider.test/send",
      apiKey: "k",
      from: "no-reply@desiauction.in",
      transport,
    },
    resolve,
  );
}

describe("http email adapter", () => {
  it("accepts a 2xx and reports a provider ref", async () => {
    const result = await adapter(ok).send(request);
    expect(result.ok).toBe(true);
  });

  it("does NOT confirm on a 2xx", async () => {
    // The provider accepting a message is not a mailbox receiving it. Delivery
    // truth arrives on the callback. Confirming here would rebuild, on email,
    // exactly the lie the in-app adapter told.
    const result = await adapter(ok).send(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.confirmed, "acceptance is not delivery").toBeUndefined();
    }
  });

  it("refuses NON-retryably when there is no address on file", async () => {
    // The live case, not an edge one: this product has never collected an email
    // address, so there is nothing to send to and retrying cannot help.
    const result = await adapter(ok, () => Promise.resolve(null)).send(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("no_email_on_file");
      expect(result.retryable).toBe(false);
    }
  });

  it("treats a 4xx as the message's fault and does not retry it", async () => {
    const result = await adapter(() => Promise.resolve({ status: 422, body: "bad" })).send(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
    }
  });

  it("treats a 5xx and a 429 as the provider's fault and retries", async () => {
    for (const status of [500, 503, 429]) {
      const result = await adapter(() => Promise.resolve({ status, body: "" })).send(request);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.retryable, `status ${String(status)}`).toBe(true);
      }
    }
  });

  it("retries an unreachable provider rather than dropping the document", async () => {
    const result = await adapter(() => Promise.reject(new Error("socket"))).send(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("provider_unreachable");
      expect(result.retryable).toBe(true);
    }
  });

  it("opens the breaker after repeated failures instead of hammering", async () => {
    // One melted provider must not turn a bulk issuance into a retry storm —
    // the same contract the SMS sender holds.
    let calls = 0;
    const failing: EmailTransport = () => {
      calls += 1;
      return Promise.resolve({ status: 500, body: "" });
    };
    const port = createHttpEmailAdapter(
      {
        endpoint: "https://provider.test/send",
        apiKey: "k",
        from: "no-reply@desiauction.in",
        transport: failing,
        breakerThreshold: 2,
        now: () => 1_000,
      },
      resolves,
    );
    await port.send(request);
    await port.send(request);
    const third = await port.send(request);
    expect(calls, "the third send never reached the provider").toBe(2);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.code).toBe("provider_unavailable");
      expect(third.retryable).toBe(true);
    }
  });

  it("sends the address, the sender and the body the document rendered", async () => {
    let sent: Record<string, unknown> = {};
    const capture: EmailTransport = (_url, init) => {
      sent = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({ status: 202, body: "{}" });
    };
    await adapter(capture).send(request);
    expect(sent["to"]).toEqual(["player@example.com"]);
    expect(sent["from"]).toBe("no-reply@desiauction.in");
    expect(sent["text"]).toBe(request.body);
  });
});

describe("delivery callbacks", () => {
  const port = adapter(ok);
  /*
   * `verifyCallback` is optional on DeliveryPort — synchronous channels have no
   * callback to verify — so it is asserted once here rather than optional-chained
   * at every use. The assertion is not ceremony: an email adapter without it
   * would take documents and never learn whether any of them arrived, and
   * `ingestDeliveryCallback` would refuse every report with
   * `callback_unsupported`.
   */
  const verifyCallback = (raw: string) => {
    const result = port.verifyCallback?.(raw);
    if (result === undefined) {
      throw new Error("the email adapter must expose verifyCallback");
    }
    return result;
  };
  const verify = (payload: unknown) => verifyCallback(JSON.stringify(payload));

  it("confirms a delivery", () => {
    const result = verify({ event: "delivered", providerRef: "email:01D", id: "evt_1" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("delivered");
      expect(result.dispatchId).toBe("01D");
      expect(result.providerEventRef).toBe("evt_1");
    }
  });

  it("classifies a bounce and a complaint as failures, keeping the reason", () => {
    for (const event of ["bounce", "hard_bounce", "complaint", "spam", "dropped"]) {
      const result = verify({ event, providerRef: "email:01D", id: `evt_${event}` });
      expect(result.ok, event).toBe(true);
      if (result.ok) {
        expect(result.kind).toBe("failed");
        expect(result.code).toBe(event);
      }
    }
  });

  it("refuses an open or a click — they are not delivery truth", () => {
    // Letting these through would make the dispatch's state machine about
    // engagement rather than about whether the message arrived.
    for (const event of ["open", "click", "unsubscribe"]) {
      const result = verify({ event, providerRef: "email:01D", id: "evt" });
      expect(result.ok, event).toBe(false);
    }
  });

  it("refuses a body it cannot read, and one with no dispatch in it", () => {
    expect(verifyCallback("not json").ok).toBe(false);
    expect(verify({ event: "delivered" }).ok).toBe(false);
    expect(verify({ event: "delivered", providerRef: "notours:01D" }).ok).toBe(false);
  });

  it("reads the field names different providers use", () => {
    const result = verify({ type: "delivered", MessageID: "email:01D", ID: "evt_9" });
    expect(result.ok).toBe(true);
  });

  it("derives an idempotency key when the provider sends no event id", () => {
    // The platform keys the command on provider:{providerEventRef}, so a
    // constant here would make the second report about a message a no-op.
    const delivered = verify({ event: "delivered", providerRef: "email:01D" });
    const bounced = verify({ event: "bounce", providerRef: "email:01D" });
    expect(delivered.ok && bounced.ok).toBe(true);
    if (delivered.ok && bounced.ok) {
      expect(delivered.providerEventRef).not.toBe(bounced.providerEventRef);
    }
  });
});

describe("subjectFor", () => {
  it("names the document kind", () => {
    expect(subjectFor("receipt.issued")).toBe("Your receipt from DesiAuction");
  });

  it("falls back rather than rendering an id at a customer", () => {
    expect(subjectFor("something.new")).toBe("A document from DesiAuction");
  });
});

describe("provider idempotency (PA-1 §16)", () => {
  it("sends the same key on every attempt, so a retried send can be collapsed", async () => {
    const seen: Record<string, string>[] = [];
    const capture: EmailTransport = (_url, init) => {
      seen.push(init.headers);
      return Promise.resolve({ status: 202, body: "{}" });
    };
    const port = adapter(capture);
    await port.send(request);
    await port.send(request);

    expect(seen).toHaveLength(2);
    expect(seen[0]?.["idempotency-key"]).toBe("dispatch:01DISPATCH");
    expect(
      seen[1]?.["idempotency-key"],
      "a retry sent a different key — the provider cannot tell it is the same message",
    ).toBe("dispatch:01DISPATCH");
  });

  it("omits the header for a provider that has none, rather than inventing one", async () => {
    const seen: Record<string, string>[] = [];
    const capture: EmailTransport = (_url, init) => {
      seen.push(init.headers);
      return Promise.resolve({ status: 202, body: "{}" });
    };
    const port = createHttpEmailAdapter(
      {
        endpoint: "https://mail.test/send",
        apiKey: "key",
        from: "no-reply@desiauction.in",
        transport: capture,
        idempotencyHeader: null,
      },
      resolves,
    );
    await port.send(request);
    expect(Object.keys(seen[0] ?? {})).not.toContain("idempotency-key");
  });
});
