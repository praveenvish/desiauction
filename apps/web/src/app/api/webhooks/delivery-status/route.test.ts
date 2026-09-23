import { describe, expect, it, vi } from "vitest";

// The door must be configured or the route 404s before it reads anything.
vi.stubEnv("DELIVERY_CALLBACK_SECRET", "unit-delivery-secret-0123456789");
vi.stubEnv("SMS_INBOUND_SECRET", "unit-inbound-secret-0123456789");

const delivery = await import("./route");
const inbound = await import("../sms-inbound/route");

/** A body that streams without declaring its length — the case a header check misses. */
function streamed(bytes: number, secretHeader: string, secret: string): Request {
  const chunk = new Uint8Array(1024).fill(97);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return new Request("http://localhost/api/webhooks", {
    method: "POST",
    headers: { [secretHeader]: secret, "content-type": "text/plain" },
    body,
    // @ts-expect-error — Node's fetch needs this for a streamed request body.
    duplex: "half",
  });
}

describe("provider webhooks read their bodies under a cap (gate P3)", () => {
  it("delivery-status refuses an oversized streamed body before touching anything", async () => {
    const response = await delivery.POST(
      streamed(1024 * 1024, "x-callback-secret", "unit-delivery-secret-0123456789"),
    );
    expect(response.status).toBe(413);
  });

  it("sms-inbound does the same", async () => {
    const response = await inbound.POST(
      streamed(1024 * 1024, "x-inbound-secret", "unit-inbound-secret-0123456789"),
    );
    expect(response.status).toBe(413);
  });
});
