// THE SCHEDULER FOR THE WEB TIER'S JOB DOORS (go-live gate P1-2).
//
// Four routes under apps/web/src/app/api/jobs/ are written as doors a scheduler
// calls — "whatever cron the host already has calls it" — and on the
// self-hosted stack the host had none. So nothing drained the personal-message
// outbox after a restart, no retention purge ran, no demo reminder went out and
// the settlement catch-up sweep never swept. Each route is fail-closed (no
// secret → 404) and idempotent, which is exactly why nobody noticed: an
// unscheduled door looks the same as a quiet one.
//
// This is that cron: one small loop, run by the web image's own node (the
// compose `scheduler` service), so there is no third-party image to pin and no
// shell to exec into. It reads the secrets from web.env — the same file the web
// tier reads — so the header a job sends can never drift from the secret the
// route expects.
//
// Every run logs one pino-shaped JSON line, which Alloy ships to Loki:
//   level 30 "job.ok"      — the heartbeat the "jobs went silent" alert watches
//   level 50 "job.failed"  — non-2xx, timeout or unreachable web tier
//   level 40 "job.disabled" at boot — the route's secret is unset, so it 404s
//
// No dependencies, deliberately: it runs from a read-only bind mount.

const BASE = process.env["SCHEDULER_BASE_URL"] ?? "http://web:3000";
const MINUTE = 60_000;

/**
 * Cadences come from each route's own header comment:
 *   messages                — "call it every few minutes"; the retry clock for
 *                             backed-off sends, so it is the tightest.
 *   settlement-coordination — "every few minutes is safe"; money self-healing.
 *   demo-reminders          — "every ten minutes is fine"; a reminder an hour
 *                             before a call cannot wait an hour.
 *   feedback                — "every ten minutes is fine"; retention purge +
 *                             review asks, neither time-critical.
 */
const JOBS = [
  {
    path: "/api/jobs/messages",
    every: 2 * MINUTE,
    secret: "FEEDBACK_JOB_SECRET",
    header: "x-feedback-job-secret",
  },
  {
    path: "/api/jobs/settlement-coordination",
    every: 5 * MINUTE,
    secret: "SETTLEMENT_JOB_SECRET",
    header: "x-settlement-job-secret",
  },
  {
    path: "/api/jobs/demo-reminders",
    every: 10 * MINUTE,
    secret: "DEMO_JOB_SECRET",
    header: "x-demo-job-secret",
  },
  {
    path: "/api/jobs/feedback",
    every: 15 * MINUTE,
    secret: "FEEDBACK_JOB_SECRET",
    header: "x-feedback-job-secret",
  },
];

/** A job longer than this is hung, not busy; the next tick tries again. */
const TIMEOUT_MS = 2 * MINUTE;

function log(level, fields, msg) {
  process.stdout.write(
    `${JSON.stringify({ level, time: Date.now(), app: "scheduler", ...fields, msg })}\n`,
  );
}

async function run(job, secret) {
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}${job.path}`, {
      method: "POST",
      headers: { [job.header]: secret },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // The body is the job's own summary (counts, never personal data) — kept
    // short so one bad response cannot flood the log.
    const body = (await response.text()).slice(0, 500);
    const fields = { job: job.path, status: response.status, tookMs: Date.now() - started };
    if (response.ok) {
      log(30, { ...fields, result: body }, "job.ok");
    } else {
      // A 404 here means the ROUTE believes it is unconfigured — the web tier's
      // secret is unset or differs from this one. Never "not deployed yet".
      log(50, { ...fields, result: body }, "job.failed");
    }
  } catch (error) {
    log(
      50,
      {
        job: job.path,
        tookMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      },
      "job.failed",
    );
  }
}

/**
 * One loop per job, each awaiting its own run before sleeping, so a slow job
 * never overlaps itself — the routes are idempotent, but a pile-up of the same
 * sweep is load for nothing.
 */
async function loop(job, secret) {
  for (;;) {
    await run(job, secret);
    await new Promise((resolve) => setTimeout(resolve, job.every));
  }
}

let enabled = 0;
for (const job of JOBS) {
  const secret = process.env[job.secret];
  if (secret === undefined || secret === "") {
    log(40, { job: job.path, secret: job.secret }, "job.disabled");
    continue;
  }
  enabled += 1;
  void loop(job, secret);
}
log(30, { enabled, of: JOBS.length, base: BASE }, "scheduler started");
if (enabled === 0) {
  // Nothing to do is a configuration fault, not a steady state: exit so the
  // restart counter and the missing heartbeat both say so.
  log(50, {}, "scheduler has no job secrets — set them in web.env");
  process.exit(1);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log(30, { signal }, "scheduler stopping");
    process.exit(0);
  });
}
