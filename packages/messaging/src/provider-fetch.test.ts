import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isProviderTimeout, providerFetch } from "./provider-fetch";

// A provider that accepts the connection, sends the headers, and then goes
// quiet — the shape of stall that used to hold a drain past its lease.
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/ok") {
      response.end("fine");
      return;
    }
    // Headers out, body never finished.
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("part");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});

describe("providerFetch — every provider call has a deadline", () => {
  it("returns the status and body of an answer", async () => {
    expect(await providerFetch(`${base}/ok`, { method: "GET", headers: {} }, 1_000)).toEqual({
      status: 200,
      body: "fine",
    });
  });

  it("gives up on a body that never finishes, and says it was the deadline", async () => {
    const started = Date.now();
    const error: unknown = await providerFetch(
      `${base}/stall`,
      { method: "POST", headers: {}, body: "{}" },
      100,
    ).catch((e: unknown) => e);
    expect(isProviderTimeout(error)).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("does not call a refused connection a timeout", async () => {
    const error: unknown = await providerFetch(
      "http://127.0.0.1:1/",
      { method: "GET", headers: {} },
      1_000,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(isProviderTimeout(error)).toBe(false);
  });
});
