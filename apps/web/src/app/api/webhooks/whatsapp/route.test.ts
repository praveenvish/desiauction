import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The WhatsApp door, at the HTTP boundary, for every answer that is decided
 * before the database is touched: closed, handshake, signature, size, and the
 * signed-but-empty callbacks Meta also sends. The writes behind a valid
 * callback are in whatsapp-webhook.regression.test.ts (they need a database).
 *
 * env.ts is parsed once at import, so each case re-imports the route under the
 * variables it needs.
 */

const SECRET = "unit-whatsapp-app-secret-0123456789";
const TOKEN = "unit-whatsapp-verify-token-0123456789";
const URL_BASE = "https://example.test/api/webhooks/whatsapp";

async function route(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(vars)) {
    vi.stubEnv(key, value);
  }
  return import("./route");
}

const sign = (body: string, secret = SECRET): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function post(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  return new Request(URL_BASE, { method: "POST", headers, body });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("closed until configured", () => {
  it("404s both methods with neither secret set", async () => {
    const { GET, POST } = await route({
      WHATSAPP_APP_SECRET: undefined,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: undefined,
    });
    expect((await GET(new Request(`${URL_BASE}?hub.mode=subscribe`))).status).toBe(404);
    expect((await POST(post("{}", sign("{}")))).status).toBe(404);
  });
});

describe("GET — Meta's verification handshake", () => {
  it("echoes hub.challenge as text/plain for our token", async () => {
    const { GET } = await route({
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: TOKEN,
      WHATSAPP_APP_SECRET: SECRET,
    });
    const response = await GET(
      new Request(
        `${URL_BASE}?hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=1158201444`,
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await response.text()).toBe("1158201444");
  });

  it("403s a wrong token or a missing mode", async () => {
    const { GET } = await route({
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: TOKEN,
      WHATSAPP_APP_SECRET: SECRET,
    });
    const wrong = await GET(
      new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1`),
    );
    expect(wrong.status).toBe(403);
    const noMode = await GET(new Request(`${URL_BASE}?hub.verify_token=${TOKEN}&hub.challenge=1`));
    expect(noMode.status).toBe(403);
  });
});

describe("POST — only what Meta signed gets in", () => {
  it("401s a missing, a forged and a wrong-secret signature", async () => {
    const { POST } = await route({
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: TOKEN,
    });
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    expect((await POST(post(body, null))).status).toBe(401);
    expect((await POST(post(body, `sha256=${"0".repeat(64)}`))).status).toBe(401);
    expect((await POST(post(body, sign(body, "not-the-app-secret-at-all")))).status).toBe(401);
    expect((await POST(post(`${body} `, sign(body)))).status).toBe(401);
  });

  it("401s every POST when only the handshake token is configured", async () => {
    const { POST } = await route({
      WHATSAPP_APP_SECRET: undefined,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: TOKEN,
    });
    expect((await POST(post("{}", sign("{}")))).status).toBe(401);
  });

  it("413s a body past the cap before verifying anything", async () => {
    const { POST } = await route({
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: TOKEN,
    });
    const big = "x".repeat(300 * 1024);
    expect((await POST(post(big, sign(big)))).status).toBe(413);
  });

  it("200s a signed body it cannot read, so Meta does not retry it for days", async () => {
    const { POST } = await route({
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: TOKEN,
    });
    expect((await POST(post("not json", sign("not json")))).status).toBe(200);
    const empty = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    expect((await POST(post(empty, sign(empty)))).status).toBe(200);
  });
});
