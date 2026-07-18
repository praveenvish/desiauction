// Warm the dev server's on-demand compiler before parallel workers start —
// first-hit route compiles otherwise inject 10s+ of jitter into early tests.
// Production servers (CI option) are pre-compiled; warming is then a no-op.
export default async function globalSetup(): Promise<void> {
  const base = "http://localhost:3050";
  const routes = [
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
    "/competitions",
    "/competitions/warmup",
    "/competitions/warmup/register",
    "/competitions/warmup/registrations",
    "/competitions/warmup/teams",
    "/competitions/warmup/auction",
    "/competitions/warmup/auction/live",
    "/competitions/warmup/auction/cockpit",
    "/competitions/warmup/auction/spectate",
    "/competitions/warmup/readiness",
    "/competitions/warmup/money",
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
    "/dev/inbox",
    "/gallery",
    "/",
  ];
  await Promise.all(
    routes.map((route) => fetch(`${base}${route}`, { redirect: "manual" }).catch(() => undefined)),
  );
}
