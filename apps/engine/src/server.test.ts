import { healthResponseSchema } from "@desiauction/contracts";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "./server.js";

const silentLogger = pino({ level: "silent" });

function makeServer(dbOk: boolean) {
  return buildServer({
    logger: silentLogger,
    version: "test",
    checkDb: () => Promise.resolve(dbOk),
  });
}

describe("GET /healthz", () => {
  let server: ReturnType<typeof makeServer> | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it("returns 200 with a contract-valid body when the db check passes", async () => {
    server = makeServer(true);
    const response = await server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.status).toBe("ok");
    expect(body.checks["db"]).toBe("ok");
  });

  it("fails closed with 503 when the db check fails", async () => {
    server = makeServer(false);
    const response = await server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(503);
    const body = healthResponseSchema.parse(response.json());
    expect(body.status).toBe("fail");
    expect(body.checks["db"]).toBe("fail");
  });
});
