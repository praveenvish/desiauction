import { jobRuns, newId } from "@desiauction/db";

import { db } from "../db";
import { logger } from "../logger";

/**
 * RECORD A SCHEDULED JOB'S RUN (AC-1.1, `job_runs`).
 *
 * The scheduler (ops/deploy/jobs/scheduler.mjs) has no database and logs only
 * to Loki, so "did last night's sweep run, and did it work?" had no answer in
 * /admin. Each job route's POST is wrapped in this: once the run is over, one
 * row — when it started and finished, whether it worked, and the route's own
 * JSON summary (or the error).
 *
 * Written AFTER the run, never before: a call refused at the door (wrong or
 * missing secret → 404, the job's fail-closed answer) is not a run and leaves
 * no row, so nobody can fill the table by knocking.
 *
 * Recording NEVER changes the job: a failure to write the row is logged, and
 * the response or error is passed through exactly as if this were not here.
 */
export async function recordJobRun(job: string, run: () => Promise<Response>): Promise<Response> {
  const startedAt = new Date();
  let response: Response;
  try {
    response = await run();
  } catch (error) {
    await write(job, startedAt, false, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  if (response.status === 404) {
    return response;
  }
  const detail: unknown = await response
    .clone()
    .json()
    .catch(() => ({}));
  await write(job, startedAt, response.ok, summaryOf(detail));
  return response;
}

async function write(
  job: string,
  startedAt: Date,
  ok: boolean,
  detail: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(jobRuns)
    .values({ id: newId(), job, startedAt, finishedAt: new Date(), ok, detail })
    .catch((error: unknown) => {
      logger().warn({ err: error, job }, "job_runs.not_recorded");
    });
}

/** A plain-object summary, capped: the row is a ledger line, not a payload store. */
function summaryOf(result: unknown): Record<string, unknown> {
  if (typeof result !== "object" || result === null) {
    return {};
  }
  const text = JSON.stringify(result);
  return text.length > 4000
    ? { truncated: text.slice(0, 4000) }
    : (JSON.parse(text) as Record<string, unknown>);
}
