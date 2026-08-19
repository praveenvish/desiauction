import { describe, expect, it } from "vitest";

/**
 * THE ROUTE THAT WAS MISSING (audit 2026-08-18, P1-5).
 *
 * `handleRazorpayWebhook` was written, forgery-tested and unreachable: nothing
 * outside the test suite could call it, because no HTTP route existed. Payment
 * capture therefore could not complete in production, and the documented
 * go-live gate ("one live order → webhook → capture → discharge") could not be
 * run at all.
 *
 * These assertions are about the DOORWAY, not the decision logic — the trusted
 * envelope order is exercised by settlement-collections.regression and
 * adapters/razorpay.test. What matters here: the route exists, it is fail-closed
 * when unconfigured, and it hands the handler the EXACT bytes it was sent
 * (an HMAC over re-serialised JSON never verifies).
 */
describe("razorpay webhook ingress", () => {
  it("the route module exists and exports a POST handler", async () => {
    const route = await import("../../app/api/webhooks/razorpay/route");
    expect(typeof route.POST).toBe("function");
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("is CLOSED when no webhook secret is configured — 404, never an open callback", async () => {
    // The suite runs without RAZORPAY_* set, which is exactly the unconfigured
    // posture: an endpoint that accepted unverifiable callbacks would be worse
    // than one that never accepts.
    const route = await import("../../app/api/webhooks/razorpay/route");
    const response = await route.POST(
      new Request("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        headers: { "x-razorpay-signature": "whatever" },
        body: JSON.stringify({ event: "payment.captured" }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("reads the body as raw text, so the signature is computed over the bytes sent", async () => {
    // A guard on the implementation, not the behaviour: `request.json()` would
    // re-serialise and every real signature would fail. Cheap to assert, and it
    // fails loudly if someone "tidies" the route later.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      fileURLToPath(new URL("../../app/api/webhooks/razorpay/route.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("request.text()");
    expect(source).not.toContain("request.json()");
  });
});
