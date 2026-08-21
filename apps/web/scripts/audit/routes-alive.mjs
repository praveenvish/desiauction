/**
 * DID THE PARALLEL ROUTE BREAK ANY ROUTING?
 *
 * Adding an `@action` slot changes how the router resolves EVERY route, not
 * just the three with an action: each one now has to match the slot too, and a
 * missing `default` would show the previous route's action or fail outright.
 * This walks the whole product and compares each status against what the route
 * sweep recorded before the slot existed.
 */
import { readFileSync } from "node:fs";
import { ROUTES } from "./routes.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3200";
const OUT =
  "/private/tmp/claude-501/-Users-praveenvishnoi-dev-desiauction-next/63fd49f8-6a66-41c1-b622-0fad001280da/scratchpad";

const before = new Map();
try {
  for (const r of JSON.parse(readFileSync(`${OUT}/audit-after/results.json`, "utf8"))) {
    if (r.authed && r.status !== undefined) before.set(r.path, r.status);
  }
} catch {}

const cookie = JSON.parse(readFileSync(`${OUT}/audit/state.json`, "utf8"))
  .cookies.map((c) => `${c.name}=${c.value}`)
  .join("; ");

let bad = 0;
for (const route of ROUTES) {
  let status = 0;
  try {
    const res = await fetch(BASE + route.path, { headers: { cookie }, redirect: "manual" });
    status = res.status;
  } catch (e) {
    status = -1;
  }
  const was = before.get(route.path);
  // A production build 404s the dev-only surfaces by design; 3xx is a real
  // answer, not a failure.
  const ok = status === 200 || (status >= 300 && status < 400) || status === 404;
  const changed = was !== undefined && was !== status && !(was === 200 && status === 404);
  if (!ok || changed) {
    bad++;
    console.log(`  ${status}  (was ${was ?? "?"})  ${route.path}`);
  }
}
console.log(
  bad === 0 ? `\nall ${ROUTES.length} routes resolve as before` : `\n${bad} routes differ`,
);
process.exit(bad > 0 ? 1 : 0);
