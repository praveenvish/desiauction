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

/**
 * How long the database gets to answer. A probe that waits for ever is not a
 * probe: with the pool exhausted, `select 1` simply queued, the caller's own
 * timeout fired first, and "busy" was reported as "down". Two seconds is far
 * above a healthy answer (a millisecond or two) and inside every caller's
 * patience (the container check allows five).
 */
const DB_ANSWER_MS = 2_000;

export async function GET(): Promise<NextResponse<HealthResponse>> {
  let dbOk = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      dbHandle.sql`select 1`,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("readyz: database did not answer in time"));
        }, DB_ANSWER_MS);
      }),
    ]);
    dbOk = true;
  } catch {
    dbOk = false;
  } finally {
    clearTimeout(timer);
  }
  // PRR P1-1: surface the rehearsal escape so a monitor (or a human) can see at
  // a glance that an instance is running with development adapters. It is a
  // POSTURE signal, not a dependency check: it does NOT flip status/HTTP (a
  // rehearsal server must stay in rotation), but it reads as a non-ok check so
  // an insecure instance can never masquerade as a clean production one.
  const insecure = env.ALLOW_INSECURE_LOCAL_PRODUCTION && env.NODE_ENV === "production";
  const body: HealthResponse = {
    status: dbOk ? "ok" : "fail",
    version: env.APP_VERSION,
    checks: {
      db: dbOk ? "ok" : "fail",
      ...(insecure ? { insecure_local_production: "fail" as const } : {}),
    },
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
