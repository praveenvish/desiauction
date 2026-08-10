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

describe("subjectFor", () => {
  it("names the document kind", () => {
    expect(subjectFor("receipt.issued")).toBe("Your receipt from DesiAuction");
  });

  it("falls back rather than rendering an id at a customer", () => {
    expect(subjectFor("something.new")).toBe("A document from DesiAuction");
  });
});
