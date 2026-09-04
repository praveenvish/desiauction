// RC-A2 (IP-0 acceptance condition; IP-0_DESIGN §29): Sentry in both apps,
// guarded — a missing SENTRY_DSN means a silent no-op, never a crash.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [Sentry, { env }, { scrub }] = await Promise.all([
      import("@sentry/nextjs"),
      import("./env"),
      import("@desiauction/core"),
    ]);
    if (env.SENTRY_DSN !== undefined) {
      Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        release: env.APP_VERSION,
        tracesSampleRate: 0.1,
        /**
         * NOTHING LEAVES THIS PROCESS UNREDACTED (audit PA-1 §20).
         *
         * The pino loggers redact by key path, which does nothing for an error
         * MESSAGE — and `duplicate key ... Key (phone)=(+91...)` carries a phone
         * number in free text that Sentry would otherwise store verbatim with a
         * third party. `scrub` is shared by all three services so they cannot
         * disagree about what is sensitive.
         */
        beforeSend: (event) => scrub(event) as typeof event,
      });
    }
    // PRR P1-1: prove RLS tenant isolation is actually load-bearing before this
    // instance serves a single request. Refuses to boot if the app role can
    // bypass RLS in production.
    const { assertTenantIsolation } = await import("./server/db");
    await assertTenantIsolation();
  }
}

export async function onRequestError(...args: unknown[]): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    (Sentry.captureRequestError as (...a: unknown[]) => void)(...args);
  }
}
