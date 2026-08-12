// Warm the dev server's on-demand compiler before parallel workers start —
// first-hit route compiles otherwise inject 10s+ of jitter into early tests.
// Production servers (CI option) are pre-compiled; warming is then a no-op.
//
// WARMING IS BOUNDED, AND THAT IS THE POINT. This used to be one
// `Promise.all` over the whole list, so every route below started compiling at
// the same instant. Next compiles each in its own pass with the full module
// graph in memory, and forty at once blew the dev server's heap before a single
// test ran — the server restarted mid-warm and every early spec failed
// ECONNREFUSED. Those failures looked exactly like application bugs, which is
// how the suite came to be described as "11 of 20 failing".
//
// The heap ceiling was raised twice chasing this (4096 → 8192). It was never a
// heap problem; it was a concurrency problem wearing a heap costume.
const WARM_CONCURRENCY = 4;

const ROUTES = [
  "/login",
  "/c",
  "/c/warmup",
  "/home",
  "/help",
  "/inbox",
  "/money",
  "/account",
  "/orgs",
  "/org/warmup",
  "/join/warmup",
  // /seasons is a redirect now, so warming it compiles nothing: the index it
  // forwards to is the route that has to be warm.
  "/tournaments",
  "/tournaments/warmup",
  "/seasons/warmup",
  "/seasons/warmup/register",
  "/seasons/warmup/registrations",
  "/seasons/warmup/teams",
  "/seasons/warmup/fixtures",
  "/seasons/warmup/standings",
  "/seasons/warmup/auction",
  "/seasons/warmup/auction/live",
  "/seasons/warmup/auction/cockpit",
  "/seasons/warmup/auction/spectate",
  "/seasons/warmup/readiness",
  "/seasons/warmup/money",
  "/org/warmup/settlement",
  "/org/warmup/money",
  "/org/warmup/money/deliveries",
  "/org/warmup/money/reconciliation",
  "/admin",
  "/admin/orgs",
  "/admin/orgs/warmup",
  "/admin/users",
  "/admin/users/warmup",
  "/admin/audit",
  "/admin/health",
  "/admin/messaging",
  "/gallery",
  "/",
];

export default async function globalSetup(): Promise<void> {
  const base = "http://localhost:3050";
  const queue = [...ROUTES];
  const worker = async (): Promise<void> => {
    for (;;) {
      const route = queue.shift();
      if (route === undefined) {
        return;
      }
      // Failures are ignored on purpose: a warm is an optimisation, and a route
      // that 404s or redirects has still been compiled, which is the point.
      await fetch(`${base}${route}`, { redirect: "manual" }).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, () => worker()));
}
