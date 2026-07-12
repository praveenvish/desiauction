// Runs against a real Postgres: docker compose locally, service container in
// CI (IP-0_DESIGN §22). DATABASE_URL is injected by vitest.config.ts.
import { healthResponseSchema } from "@desiauction/contracts";
import { pino } from "pino";
import { WebSocket } from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { checkDb, sql } from "../db.js";
import { buildServer } from "../server.js";

const server = buildServer({
  logger: pino({ level: "silent" }),
  version: "integration",
  checkDb,
});

afterAll(async () => {
  await server.close();
  await sql.end();
});

describe("engine against real Postgres", () => {
  it("healthz reports ok through a live connection", async () => {
    const response = await server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).checks["db"]).toBe("ok");
  });

  it("echoes over /ws (the deploy smoke contract, §20)", async () => {
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a bound socket address");
    }
    const ws = new WebSocket(`ws://127.0.0.1:${String(address.port)}/ws`);
    const echoed = await new Promise<string>((resolve, reject) => {
      ws.on("open", () => {
        ws.send("ping");
      });
      ws.on("message", (data) => {
        if (Buffer.isBuffer(data)) {
          resolve(data.toString("utf8"));
        } else {
          reject(new Error("expected a Buffer frame from the echo endpoint"));
        }
      });
      ws.on("error", reject);
    });
    ws.close();
    expect(echoed).toBe("ping");
  });
});
