// Warm the dev server's on-demand compiler before parallel workers start —
// first-hit route compiles otherwise inject 10s+ of jitter into early tests.
// Production servers (CI option) are pre-compiled; warming is then a no-op.
export default async function globalSetup(): Promise<void> {
  const base = "http://localhost:3050";
  const routes = [
    "/login",
    "/account",
    "/orgs",
    "/org/warmup",
    "/join/warmup",
    "/competitions",
    "/competitions/warmup",
    "/competitions/warmup/register",
    "/dev/inbox",
    "/gallery",
    "/",
  ];
  await Promise.all(
    routes.map((route) => fetch(`${base}${route}`, { redirect: "manual" }).catch(() => undefined)),
  );
}
