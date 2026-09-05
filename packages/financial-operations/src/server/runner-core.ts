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
  /**
   * Jobs this worker finished AFTER its lease had already been reclaimed, so
   * its write was fenced out and another worker owns the outcome.
   *
   * Not an error — the job is being handled — but a number worth watching: a
   * tick that regularly loses leases is running work longer than the lease, and
   * the answer is a shorter batch or a longer lease, not a retry.
   */
  readonly lost: number;
  /** Finished jobs the retention sweep removed on this tick, when it ran. */
  readonly purged?: number;
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
  /** Jobs whose lease moved on while we were still working — see below. */
  let lost = 0;

  for (const job of claimed) {
    /**
     * The lease this worker holds for THIS job, and the fence for every write
     * it makes about it. `claimJobs` stamped it; if another runner reclaims the
     * job because we ran past it, that value changes and our writes stop
     * landing — which is the difference between two workers finishing a job and
     * two workers overwriting each other (audit PA-1 §16).
     */
    const fence = job.leasedUntilMs;
    const handler = handlers[job.kind];
    try {
      if (handler === undefined) {
        throw new Error(`unknown_job_kind:${job.kind}`);
      }
      await handler(deps, job);
      const won = await deps.store.transact(async (tx) =>
        tx.updateJob({ ...job, state: "done", leasedUntilMs: null, lastError: null }, fence),
      );
      if (won) {
        done += 1;
      } else {
        // Our lease had already gone. The reclaiming worker owns the outcome;
        // saying `done` here would overwrite whatever it recorded. Counted so a
        // tick that is routinely losing its leases is visible rather than
        // merely slow.
        lost += 1;
      }
    } catch (error) {
      const attempts = job.attempts + 1;
      const decision = retryDecision(attempts, job.maxAttempts, nowMs);
      const lastError = error instanceof Error ? error.message : String(error);
      const won = await deps.store.transact(async (tx) =>
        tx.updateJob(
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
          fence,
        ),
      );
      if (!won) {
        lost += 1;
      } else if (decision.kind === "retry") {
        retried += 1;
      } else {
        dead += 1;
      }
    }
  }
  return { claimed: claimed.length, done, retried, dead, lost };
}

/** One full runner tick: seed slots, fire due schedules, discover pipeline
 * work (requested dispatches/exports → derived jobs), drain the queue. */
/**
 * How long a finished job stays before the sweep takes it.
 *
 * Long enough that an operator investigating this morning's run can still see
 * what ran, short enough that the table does not become an archive. `dead` jobs
 * are never swept — they are the queue of things needing a human.
 */
const FINISHED_JOB_TTL_MS = 7 * 24 * 60 * 60_000;

/** How often the sweep runs, regardless of tick cadence. */
const PURGE_INTERVAL_MS = 60 * 60_000;
let lastPurgeMs = 0;

export async function runnerTick(deps: FinopsDeps, nowMs?: number): Promise<DrainResult> {
  const at = nowMs ?? deps.now();
  await ensureSchedules(deps, at);
  await runSchedulesOnce(deps, at);
  await enqueueDispatchSends(deps, at);
  await enqueueExportGenerations(deps, at);
  const drained = await drainJobsOnce(deps, at);

  /*
   * RETENTION (audit PA-1 §14). `finops_jobs` kept every completed row for
   * ever: the ops board had already measured "1192 queued, oldest 9 days", and
   * a claim query whose index carries years of dead rows gets slower at exactly
   * the rate the platform gets busier.
   *
   * On the tick rather than on a schedule, because the schedules run inside the
   * governance lifecycle that beta descopes (D3) — a retention sweep that only
   * runs when somebody opens a fiscal period is a retention sweep that never
   * runs. Hourly, and failure is swallowed on purpose: housekeeping must never
   * be the reason a tick that did real work reports failure.
   */
  let purgedThisTick = 0;
  if (at - lastPurgeMs >= PURGE_INTERVAL_MS) {
    lastPurgeMs = at;
    try {
      const purged = await deps.store.transact((tx) =>
        tx.purgeFinishedJobs(at - FINISHED_JOB_TTL_MS),
      );
      purgedThisTick = purged;
    } catch {
      // Deliberately swallowed: see above. The next hour tries again.
    }
  }
  // Reported rather than logged here: `FinopsDeps` carries no logger, and the
  // runner is the process that owns saying things out loud.
  return purgedThisTick > 0 ? { ...drained, purged: purgedThisTick } : drained;
}

/** One org the follower could not serve this tick, and why. */
export interface FollowFailure {
  readonly orgId: string;
  readonly error: unknown;
}

export interface FollowAllResult {
  /** Settlement facts consumed across every org that succeeded. */
  readonly consumed: number;
  /** Orgs that threw. Empty on a healthy tick; never silently discarded. */
  readonly failures: readonly FollowFailure[];
}

/** The follower poll across every org — the loop's other half (ADR-3: polling
 * is the truth mechanism; nothing depends on a notification arriving). */
export async function followAllOrgs(deps: FinopsDeps): Promise<FollowAllResult> {
  let consumed = 0;
  const failures: FollowFailure[] = [];
  for (const orgId of await deps.orgs.listOrgIds()) {
    /**
     * ONE ORG'S BAD DAY IS NOT EVERY ORG'S (audit PA-1 §16).
     *
     * `runFollower` throwing used to abort this loop, so every org after the
     * failing one was skipped for the whole tick — and because the org list is
     * stably ordered, it was the SAME orgs skipped every time. A single
     * contended stream (a manual issuance racing the follower's auto-receipt is
     * the ordinary way it happens) could therefore stop receipts for everyone
     * sorted below it, indefinitely, while the runner logged a healthy tick.
     *
     * Isolating each org turns that into one org falling behind by one tick and
     * catching up on the next, which is what polling is for. The failure is
     * REPORTED rather than swallowed: the caller logs it, so a persistently
     * failing org is visible instead of merely slow.
     */
    try {
      const run = await runFollower(deps, orgId);
      consumed += run.consumed;
    } catch (error: unknown) {
      failures.push({ orgId, error });
    }
    await certifyFirstTime(deps, orgId);
  }
  return { consumed, failures };
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
