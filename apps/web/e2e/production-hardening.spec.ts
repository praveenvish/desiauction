import { expect, test } from "@playwright/test";

// PERMANENT PX-11 PRODUCTION-CONFIGURATION REGRESSION.
//
// Proves the deployment-facing guarantees hold end-to-end against a running
// server: the hardened HTTP security headers are present on every response, and
// the liveness/readiness probes behave as an orchestrator expects. The
// application-level guards (open-redirect fold, JSON-LD escaping) are proven by
// their unit suites; this covers what only a live server can show.

test("security headers are present on public responses", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const headers = response.headers();

  // Framing / clickjacking.
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  // Base-tag, plugin, and form-target restrictions (PX-11 H1).
  expect(headers["content-security-policy"]).toContain("base-uri 'self'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).toContain("form-action 'self'");
  // MIME sniffing, referrer, and feature policy.
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("geolocation=()");
  // HSTS from day one.
  expect(headers["strict-transport-security"]).toContain("max-age=");
});

test("headers are present on the login page (the open-redirect surface)", async ({ request }) => {
  const response = await request.get("/login?next=/home");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("form-action 'self'");
  expect(headers["x-frame-options"]).toBe("DENY");
});

test("liveness /healthz is dependency-free and always 200 when the process is up", async ({
  request,
}) => {
  const response = await request.get("/healthz");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { status: string; checks: Record<string, string> };
  expect(body.status).toBe("ok");
});

test("readiness /readyz checks the database and reports it", async ({ request }) => {
  const response = await request.get("/readyz");
  // The DB is up in the test stack, so readiness is 200 with db:ok.
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { status: string; checks: { db?: string } };
  expect(body.status).toBe("ok");
  expect(body.checks.db).toBe("ok");
});
