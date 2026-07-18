import type { HealthResponse } from "@desiauction/contracts";
import { NextResponse } from "next/server";

import { dbHandle } from "../../server/db";
import { env } from "../../env";

/**
 * PX-11 reliability: the web READINESS probe (distinct from `/healthz`, which is
 * liveness). The engine already ships this (server.ts `/healthz` checks the DB);
 * the web tier did not, so an orchestrator could route traffic to an instance
 * that cannot reach Postgres. This does a cheap `select 1` and returns 503 when
 * the database is unreachable, so a bad instance is pulled from rotation instead
 * of serving errors.
 *
 * Liveness stays at `/healthz` (no dependency checks — a DB blip must not make
 * the orchestrator KILL a healthy process, only stop routing to it). Never
 * cached; must reflect the instant.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<HealthResponse>> {
  let dbOk = false;
  try {
    await dbHandle.sql`select 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const body: HealthResponse = {
    status: dbOk ? "ok" : "fail",
    version: env.APP_VERSION,
    checks: { db: dbOk ? "ok" : "fail" },
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
