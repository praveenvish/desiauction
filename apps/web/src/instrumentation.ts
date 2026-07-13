// RC-A2 (IP-0 acceptance condition; IP-0_DESIGN §29): Sentry in both apps,
// guarded — a missing SENTRY_DSN means a silent no-op, never a crash.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [Sentry, { env }] = await Promise.all([import("@sentry/nextjs"), import("./env")]);
    if (env.SENTRY_DSN !== undefined) {
      Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        release: env.APP_VERSION,
        tracesSampleRate: 0.1,
      });
    }
  }
}

export async function onRequestError(...args: unknown[]): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    (Sentry.captureRequestError as (...a: unknown[]) => void)(...args);
  }
}
