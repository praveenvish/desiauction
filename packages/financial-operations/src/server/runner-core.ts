import {
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  attestationDateFor,
  checklistGreen,
  dailyOpsJobKey,
  endedFiscalYearFor,
  evaluateOperationalChecklist,
  exceptionKindForCheck,
  fiscalYearOf,
  istDateOf,
  nextDueMs,
  retryDecision,
  yearEndJobKey,
  type AttestationCheck,
  type JobRow,
  type ScheduleSlot,
} from "..";

import type { FinopsDeps } from "./deps";
import { runFollower } from "./follower";
import {
  CERTIFICATION_ACTION,
  certifyOperations,
  checklistInputsFrom,
  gatherObservations,
  verifyYearEnd,
} from "./governance";
import {
  enqueueDispatchSends,
  enqueueExportGenerations,
  runDailyExport,
  runDispatchSend,
  runExportGenerate,
} from "./pipelines";
import { attestDay, noteException, verifyOrgFinops } from "./writer";

/**
 * THE RUNNER's core (IP-6_ARCHITECTURE §15, ADR-4): schedules fire → derived
 * jobs enqueue (idempotent by (org, dedupeKey)) → workers claim under lease →
 * handlers run → failures retry with deterministic backoff → exhaustion is a
 * DEAD LETTER that becomes a red check on the day. The `apps/finops-runner`
 * process is a thin loop over these functions; every decision is pure and
 * lives in the domain.
 *
 * No operational cron exists inside the web tier and none inside settlement —
 * this module is the platform's one scheduled-work home (the CTO scope rule).
 */

export interface ScheduleTickResult {
  readonly fired: readonly ScheduleSlot[];
  readonly jobsEnqueued: number;
}

/** Seed schedule slots so the first tick computes real due times. */
export async function ensureSchedules(deps: FinopsDeps, nowMs: number): Promise<void> {
  const existing = new Set((await deps.store.loadSchedules()).map((row) => row.slot));
  await deps.store.transact(async (tx) => {
    for (const slot of ["daily-ops", "year-end"] as const) {
      if (!existing.has(slot)) {
        await tx.putSchedule({ slot, nextDueMs: nextDueMs(slot, nowMs), lastFiredMs: null });
      }
    }
  });
}

/**
 * Fire every due slot: enqueue one derived job per org, advance the slot.
 * Crash-safe by derivation: a re-fired slot re-derives the same job keys and
 * the unique index absorbs them.
 */
export async function runSchedulesOnce(
  deps: FinopsDeps,
  nowMs: number,
): Promise<ScheduleTickResult> {
  const schedules = await deps.store.loadSchedules();
  const fired: ScheduleSlot[] = [];
  let jobsEnqueued = 0;

  for (const schedule of schedules) {
    if (schedule.nextDueMs > nowMs) {
      continue;
    }
    const orgIds = await deps.orgs.listOrgIds();
    for (const orgId of orgIds) {
      const enqueued = await enqueueSlotJob(deps, schedule.slot, orgId, nowMs);
      jobsEnqueued += enqueued ? 1 : 0;
    }
    await deps.store.transact(async (tx) => {
      await tx.putSchedule({
        slot: schedule.slot,
        nextDueMs: nextDueMs(schedule.slot, nowMs),
        lastFiredMs: nowMs,
      });
    });
    fired.push(schedule.slot);
  }
  return { fired, jobsEnqueued };
}

async function enqueueSlotJob(
  deps: FinopsDeps,
  slot: ScheduleSlot,
  orgId: string,
  nowMs: number,
): Promise<boolean> {
  const date = attestationDateFor(nowMs);
  const jobs: JobRow[] =
    slot === "daily-ops"
      ? [
          {
            jobId: deps.newId(),
            orgId,
            kind: "ops.attest-day",
            dedupeKey: dailyOpsJobKey(orgId, date),
            state: "queued",
            attempts: 0,
            maxAttempts: DEFAULT_MAX_ATTEMPTS,
            notBeforeMs: nowMs,
            leasedUntilMs: null,
            lastError: null,
            payload: { date },
          },
          // The DAILY EXPORT (M-IP6-3): the day's register, archived per org.
          {
            jobId: deps.newId(),
            orgId,
            kind: "export.daily",
            dedupeKey: `export.daily:${orgId}:${date}`,
            state: "queued",
            attempts: 0,
            maxAttempts: DEFAULT_MAX_ATTEMPTS,
            notBeforeMs: nowMs,
            leasedUntilMs: null,
            lastError: null,
            payload: { date },
          },
        ]
      : [
          {
            jobId: deps.newId(),
            orgId,
            kind: "ops.year-end",
            dedupeKey: yearEndJobKey(orgId, endedFiscalYearFor(nowMs)),
            state: "queued",
            attempts: 0,
            maxAttempts: DEFAULT_MAX_ATTEMPTS,
            notBeforeMs: nowMs,
            leasedUntilMs: null,
            lastError: null,
            payload: { fy: endedFiscalYearFor(nowMs) },
          },
        ];
  let inserted = false;
  for (const job of jobs) {
    inserted = (await deps.store.transact(async (tx) => tx.enqueueJob(job))) || inserted;
  }
  return inserted;
}

// --- Job execution ---------------------------------------------------------------------

export type JobHandler = (deps: FinopsDeps, job: JobRow) => Promise<void>;

/**
 * The DAILY RECONCILIATION run (completed at M-IP6-4): run the follower,
 * gather the supervisor's observations, evaluate the FULL operational
 * checklist (foundation checks + document reproduction + export verification
 * + dispatch currency + settlement synchronization + fiscal evidence), and
 * either system-attest a green day or note one exception per red check (a
 * human then investigates and attests — the acknowledgment).
 */
export async function runDailyOps(deps: FinopsDeps, job: JobRow): Promise<void> {
  const date = typeof job.payload["date"] === "string" ? job.payload["date"] : null;
  if (date === null) {
    throw new Error("malformed_job_payload");
  }
  const orgId = job.orgId;

  await runFollower(deps, orgId);
  // CERTIFY, EVERY DAY, WHATEVER ELSE THIS JOB DECIDES.
  //
  // Before this line nothing in the platform ever derived a certification.
  // `certificationSnapshot` is the only writer of the breadcrumb and it had no
  // callers: the reconciliation view dropped it deliberately (it wrote an audit
  // row on every page view), and nothing took its place — so every org created
  // after the seed sat on "not certified yet" for ever, on the one desk whose
  // job is to say whether the money agrees with itself.
  //
  // A schedule is where it belongs. Once a day per org is the same cadence the
  // attestation runs on, it is bounded (one row, not one per reader), and it
  // keeps the read path pure.
  //
  // Deliberately ABOVE the period gate below: certification asks whether the
  // projections still fold out of the events, which is true or false whether or
  // not the org has adopted period discipline. A failure here is recorded as
  // the breadcrumb's own FAIL verdict and must not stop the attestation work
  // that follows, so it is not allowed to throw the job.
  await certifyOperations(deps, orgId);
  const checks = await evaluateChecklist(deps, orgId);

  const period = await deps.store.loadPeriodFor(orgId, fiscalYearOf(date));
  if (period === null || period.status !== "open") {
    // No open period for this day's FY: the org has not adopted (or has
    // sealed) period discipline — nothing to attest against. Visible in the
    // OperationalSnapshot; deliberately not an error.
    return;
  }

  if (checklistGreen(checks)) {
    const ack = await attestDay(
      deps,
      { kind: "system", orgId, source: "runner" },
      period.periodId,
      { date, checks },
      `${job.dedupeKey}:attest`,
    );
    if (!ack.ok) {
      throw new Error(`attest_failed:${ack.reason}`);
    }
    return;
  }

  for (const check of checks) {
    if (check.outcome === "fail") {
      const ack = await noteException(
        deps,
        { kind: "system", orgId, source: "runner" },
        period.periodId,
        {
          date,
          kind: exceptionKindForCheck(check.name),
          detail: `${check.name}: ${check.detail ?? "failed"}`,
          sourceRef: job.dedupeKey,
        },
        `${job.dedupeKey}:exception:${check.name}`,
      );
      if (!ack.ok && ack.reason !== "period_not_open") {
        throw new Error(`exception_failed:${ack.reason}`);
      }
    }
  }
}

async function evaluateChecklist(deps: FinopsDeps, orgId: string): Promise<AttestationCheck[]> {
  const observations = await gatherObservations(deps, orgId, deps.now());
  const deadJobs = (await deps.store.loadDeadJobs(orgId)).map((dead) => ({
    kind: dead.kind,
    key: dead.dedupeKey,
  }));
  const divergences = await verifyOrgFinops(deps, orgId);
  return evaluateOperationalChecklist(checklistInputsFrom(observations, deadJobs, divergences));
}

/**
 * The YEAR-END trigger (completed at M-IP6-4): derives the ended year's close
 * readiness and records the verdict as an audit breadcrumb — it still appends
 * NO events; the pending close remains a computed fact a fold answers, and
 * sealing the year remains a deliberate human command.
 */
export async function runYearEnd(deps: FinopsDeps, job: JobRow): Promise<void> {
  const fy = typeof job.payload["fy"] === "string" ? job.payload["fy"] : null;
  if (fy === null) {
    throw new Error("malformed_job_payload");
  }
  await verifyYearEnd(deps, job.orgId, fy);
}

const HANDLERS: Readonly<Record<string, JobHandler>> = {
  "ops.attest-day": runDailyOps,
  "ops.year-end": runYearEnd,
  "follower.run": async (deps, job) => {
    await runFollower(deps, job.orgId);
  },
  "dispatch.send": runDispatchSend,
  "export.generate": runExportGenerate,
  "export.daily": runDailyExport,
};

export interface DrainResult {
  readonly claimed: number;
  readonly done: number;
  readonly retried: number;
  readonly dead: number;
}

/**
 * Claim due work under a lease and execute it. A crash mid-job is healed by
 * the lease timeout (the job is re-claimed and re-run; every handler is
 * idempotent — writer commands by commandId, follower by cursor).
 */
export async function drainJobsOnce(
  deps: FinopsDeps,
  nowMs: number,
  options: {
    limit?: number;
    leaseMs?: number;
    handlers?: Readonly<Record<string, JobHandler>>;
    /** Scope the claim to one tenant (per-org draining — the sharding seam). */
    orgId?: string;
  } = {},
): Promise<DrainResult> {
  const handlers = options.handlers ?? HANDLERS;
  const claimed = await deps.store.claimJobs(
    nowMs,
    options.leaseMs ?? DEFAULT_LEASE_MS,
    options.limit ?? 10,
    options.orgId,
  );
  let done = 0;
  let retried = 0;
  let dead = 0;

  for (const job of claimed) {
    const handler = handlers[job.kind];
    try {
      if (handler === undefined) {
        throw new Error(`unknown_job_kind:${job.kind}`);
      }
      await handler(deps, job);
      await deps.store.transact(async (tx) => {
        await tx.updateJob({ ...job, state: "done", leasedUntilMs: null, lastError: null });
      });
      done += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const decision = retryDecision(attempts, job.maxAttempts, nowMs);
      const lastError = error instanceof Error ? error.message : String(error);
      await deps.store.transact(async (tx) => {
        await tx.updateJob(
          decision.kind === "retry"
            ? {
                ...job,
                state: "queued",
                attempts,
                notBeforeMs: decision.notBeforeMs,
                leasedUntilMs: null,
                lastError,
              }
            : { ...job, state: "dead", attempts, leasedUntilMs: null, lastError },
        );
      });
      if (decision.kind === "retry") {
        retried += 1;
      } else {
        dead += 1;
      }
    }
  }
  return { claimed: claimed.length, done, retried, dead };
}

/** One full runner tick: seed slots, fire due schedules, discover pipeline
 * work (requested dispatches/exports → derived jobs), drain the queue. */
export async function runnerTick(deps: FinopsDeps, nowMs?: number): Promise<DrainResult> {
  const at = nowMs ?? deps.now();
  await ensureSchedules(deps, at);
  await runSchedulesOnce(deps, at);
  await enqueueDispatchSends(deps, at);
  await enqueueExportGenerations(deps, at);
  return drainJobsOnce(deps, at);
}

/** The follower poll across every org — the loop's other half (ADR-3: polling
 * is the truth mechanism; nothing depends on a notification arriving). */
export async function followAllOrgs(deps: FinopsDeps): Promise<number> {
  let consumed = 0;
  for (const orgId of await deps.orgs.listOrgIds()) {
    const run = await runFollower(deps, orgId);
    consumed += run.consumed;
    await certifyFirstTime(deps, orgId);
  }
  return consumed;
}

/**
 * An org's FIRST certification, derived as soon as the runner sees the org.
 *
 * The daily schedule above is what keeps certification current, but a new
 * organization would then read "not certified yet" until the next daily fire —
 * up to a day of a money desk saying it does not know. This closes that window
 * without putting a write back on the read path: an existence check per org per
 * tick, and exactly one certification per org, ever, after which the schedule
 * owns it.
 *
 * Failure is swallowed on purpose. This is opportunistic work on the polling
 * loop's back, and an org that cannot be certified yet — mid-write, or genuinely
 * divergent — must not stop the follower serving every other org. The daily job
 * will try again and record the verdict where an operator can see it.
 */
async function certifyFirstTime(deps: FinopsDeps, orgId: string): Promise<void> {
  try {
    if (await deps.store.hasAuditBreadcrumb(orgId, CERTIFICATION_ACTION)) {
      return;
    }
    await certifyOperations(deps, orgId);
  } catch {
    // Opportunistic: the daily job is the one that must report.
  }
}

export { attestationDateFor, istDateOf };
