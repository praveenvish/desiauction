#!/usr/bin/env node
// FIRST-LOAD JS BUDGET — fail CI when an app route ships more JavaScript than
// its budget (audit P3 F14: nothing stopped the shell, on every route, from
// growing without anybody deciding it should).
//
// WHAT IS MEASURED. The same number `next build` prints as "First Load JS":
// for each app route, the gzipped size (zlib level 9, as Next's gzip-size
// does) of every .js chunk `.next/app-build-manifest.json` lists for that
// page — which already includes its layouts' chunks and the framework — plus
// `rootMainFiles` from `.next/build-manifest.json`. Read from the manifests,
// not scraped from the build's text table, so a change to Next's printing
// cannot quietly turn this into a check of nothing. One deliberate difference
// from Next's table: a parallel-route slot's page (`@action/home/page`) is
// counted with the URL it renders at, where Next's table keeps only one of
// the two, so a few routes read 1–4 kB above the printed figure.
//
// THE BUDGET lives in bundle-budget.json at the repo root: a `default` ceiling
// in kB (1 kB = 1000 bytes, Next's unit) and per-route `routes` overrides for
// routes that legitimately weigh more. See the `_howToRaise` note there before
// changing a number.
//
// Usage: node scripts/check-bundle-budget.mjs [--next-dir apps/web/.next]
//        [--budget bundle-budget.json] [--write]
//   --write  rewrites the budget file from the current build: every route over
//            the default gets an override at its size + headroom. For setting
//            the first budget or re-baselining after a deliberate change.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** Headroom applied by --write above a route's measured size. */
export const HEADROOM = 0.1;

/**
 * Turn an app-build-manifest page key into the URL path Next prints:
 * `/(shell)/c/[slug]/page` → `/c/[slug]`. Route groups and parallel-route
 * slots (`@action`) are not part of the URL; intercepting-route markers are
 * left alone (the key stays unique and readable).
 */
export function routeFromEntry(entry) {
  const segments = entry
    .split("/")
    .filter(Boolean)
    .slice(0, -1) // the trailing page / route
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .filter((segment) => !segment.startsWith("@"));
  return "/" + segments.join("/");
}

/**
 * Per-route chunk lists from the two manifests. Only `/page` entries: route
 * handlers ship no client JS, and layouts are counted inside each page's list.
 * Two entries can collapse to one URL (a parallel slot's page and the main
 * page); the route keeps the union of their chunks.
 */
export function routeChunks(appBuildManifest, buildManifest) {
  const root = (buildManifest?.rootMainFiles ?? []).filter((f) => f.endsWith(".js"));
  const routes = new Map();
  for (const [entry, files] of Object.entries(appBuildManifest.pages ?? {})) {
    if (!entry.endsWith("/page")) continue;
    const route = routeFromEntry(entry);
    const set = routes.get(route) ?? new Set(root);
    for (const file of files) if (file.endsWith(".js")) set.add(file);
    routes.set(route, set);
  }
  return routes;
}

/** Sum gzipped sizes, memoised per file (chunks are shared across routes). */
export function measure(routes, sizeOf) {
  const cache = new Map();
  const size = (file) => {
    if (!cache.has(file)) cache.set(file, sizeOf(file));
    return cache.get(file);
  };
  return [...routes]
    .map(([route, files]) => ({ route, bytes: [...files].reduce((n, f) => n + size(f), 0) }))
    .sort((a, b) => b.bytes - a.bytes || a.route.localeCompare(b.route));
}

/** The budget (kB) that applies to a route. */
export function budgetFor(route, budget) {
  return budget.routes?.[route] ?? budget.default;
}

/** Every measured route against its budget; `over` marks a failure. */
export function evaluate(measured, budget) {
  return measured.map(({ route, bytes }) => {
    const kb = bytes / 1000;
    const limit = budgetFor(route, budget);
    return { route, kb, limit, over: kb > limit };
  });
}

/** Overrides naming routes the build no longer has — stale, and reported. */
export function staleOverrides(measured, budget) {
  const present = new Set(measured.map((m) => m.route));
  return Object.keys(budget.routes ?? {}).filter((route) => !present.has(route));
}

/** A budget file derived from a build: default + overrides, with headroom. */
export function baseline(measured, previous) {
  // The epsilon keeps float noise (100 * 1.1 = 110.00000000000001) from adding a kB.
  const ceil = (kb) => Math.ceil(kb * (1 + HEADROOM) - 1e-9);
  const kbs = measured.map((m) => m.bytes / 1000);
  // The default covers the typical route; the heavy tail gets named overrides
  // so a regression on a light route is not hidden by the heaviest one.
  const sorted = [...kbs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const def = ceil(median);
  const routes = {};
  for (const { route, bytes } of measured) {
    if (ceil(bytes / 1000) > def) routes[route] = ceil(bytes / 1000);
  }
  return {
    ...(previous?._howToRaise ? { _howToRaise: previous._howToRaise } : {}),
    default: def,
    routes: Object.fromEntries(Object.entries(routes).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function formatTable(rows) {
  const width = Math.max(5, ...rows.map((r) => r.route.length));
  const line = (route, kb, limit, mark) =>
    `${route.padEnd(width)}  ${kb.padStart(9)}  ${limit.padStart(9)}  ${mark}`;
  return [
    line("Route", "First load", "Budget", ""),
    ...rows.map((r) =>
      line(r.route, `${r.kb.toFixed(1)} kB`, `${r.limit} kB`, r.over ? "OVER BUDGET" : ""),
    ),
  ].join("\n");
}

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
  };
  const repo = resolve(fileURLToPath(import.meta.url), "../..");
  const nextDir = resolve(repo, arg("--next-dir", "apps/web/.next"));
  const budgetPath = resolve(repo, arg("--budget", "bundle-budget.json"));
  const appManifestPath = join(nextDir, "app-build-manifest.json");
  if (!existsSync(appManifestPath)) {
    console.error(`bundle budget: ${appManifestPath} not found — run \`pnpm build\` first.`);
    return 2;
  }
  const appBuildManifest = JSON.parse(readFileSync(appManifestPath, "utf8"));
  const buildManifest = JSON.parse(readFileSync(join(nextDir, "build-manifest.json"), "utf8"));
  const routes = routeChunks(appBuildManifest, buildManifest);
  if (routes.size === 0) {
    // A manifest shape change must fail loudly, not pass with nothing checked.
    console.error("bundle budget: no app routes found in the manifest — has its shape changed?");
    return 2;
  }
  const measured = measure(
    routes,
    (file) => gzipSync(readFileSync(join(nextDir, file)), { level: 9 }).length,
  );

  if (argv.includes("--write")) {
    const previous = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, "utf8")) : null;
    writeFileSync(budgetPath, JSON.stringify(baseline(measured, previous), null, 2) + "\n");
    console.log(`bundle budget: wrote ${budgetPath} from ${measured.length} routes.`);
    return 0;
  }

  const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
  const rows = evaluate(measured, budget);
  console.log(formatTable(rows));
  const stale = staleOverrides(measured, budget);
  if (stale.length) {
    console.log(
      `\nstale overrides (no such route in this build — remove them): ${stale.join(", ")}`,
    );
  }
  const over = rows.filter((r) => r.over);
  if (over.length) {
    console.error(
      `\nbundle budget: ${over.length} route(s) over budget. Shrink the route, or raise its ` +
        "budget deliberately (see _howToRaise in bundle-budget.json).",
    );
    return 1;
  }
  console.log(
    `\nbundle budget: ${rows.length} routes within budget (default ${budget.default} kB).`,
  );
  return stale.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
