// Unit tests for the first-load JS budget. Run: pnpm test:scripts
// (CI runs them before the build; the check itself runs after it.)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  baseline,
  evaluate,
  measure,
  routeChunks,
  routeFromEntry,
  staleOverrides,
} from "./check-bundle-budget.mjs";

const appBuildManifest = {
  pages: {
    "/layout": ["static/chunks/root-layout.js", "static/css/app.css"],
    "/(public)/page": ["static/chunks/webpack.js", "static/chunks/landing.js", "static/css/a.css"],
    "/(shell)/c/[slug]/page": [
      "static/chunks/webpack.js",
      "static/chunks/shell.js",
      "static/chunks/c.js",
    ],
    "/(shell)/@action/c/[slug]/page": ["static/chunks/webpack.js", "static/chunks/dialog.js"],
    "/api/health/route": ["static/chunks/webpack.js", "static/chunks/never.js"],
    "/(shell)/home/page": ["static/chunks/webpack.js", "static/chunks/shell.js"],
  },
};
const buildManifest = { rootMainFiles: ["static/chunks/webpack.js", "static/chunks/main-app.js"] };

test("route keys drop groups, slots and the trailing segment", () => {
  assert.equal(routeFromEntry("/(public)/page"), "/");
  assert.equal(routeFromEntry("/(shell)/c/[slug]/page"), "/c/[slug]");
  assert.equal(routeFromEntry("/(shell)/@action/c/[slug]/page"), "/c/[slug]");
});

test("pages only; root main files counted once; parallel slots merge into their URL", () => {
  const routes = routeChunks(appBuildManifest, buildManifest);
  assert.deepEqual([...routes.keys()].sort(), ["/", "/c/[slug]", "/home"]);
  assert.deepEqual([...routes.get("/c/[slug]")].sort(), [
    "static/chunks/c.js",
    "static/chunks/dialog.js",
    "static/chunks/main-app.js",
    "static/chunks/shell.js",
    "static/chunks/webpack.js",
  ]);
  // CSS never counts toward first-load JS.
  assert.ok(![...routes.get("/")].some((f) => f.endsWith(".css")));
});

test("measure sums shared chunks per route and sorts heaviest first", () => {
  const sizes = {
    "static/chunks/webpack.js": 1000,
    "static/chunks/main-app.js": 2000,
    "static/chunks/landing.js": 500,
    "static/chunks/shell.js": 40_000,
    "static/chunks/c.js": 3000,
    "static/chunks/dialog.js": 1000,
  };
  let reads = 0;
  const measured = measure(routeChunks(appBuildManifest, buildManifest), (f) => {
    reads++;
    return sizes[f];
  });
  assert.deepEqual(measured, [
    { route: "/c/[slug]", bytes: 47_000 },
    { route: "/home", bytes: 43_000 },
    { route: "/", bytes: 3500 },
  ]);
  assert.equal(reads, 6, "each chunk is sized once however many routes share it");

  const budget = { default: 45, routes: { "/c/[slug]": 50, "/gone": 10 } };
  assert.deepEqual(
    evaluate(measured, budget).map((r) => [r.route, r.limit, r.over]),
    [
      ["/c/[slug]", 50, false],
      ["/home", 45, false],
      ["/", 45, false],
    ],
  );
  assert.equal(evaluate(measured, { default: 40 }).filter((r) => r.over).length, 2);
  assert.deepEqual(staleOverrides(measured, budget), ["/gone"]);
});

test("baseline: median default with headroom, overrides only for the heavy tail", () => {
  const measured = [
    { route: "/big", bytes: 200_000 },
    { route: "/b", bytes: 100_000 },
    { route: "/a", bytes: 100_000 },
  ];
  const out = baseline(measured, { _howToRaise: "keep me", default: 1 });
  assert.deepEqual(out, { _howToRaise: "keep me", default: 110, routes: { "/big": 220 } });
  assert.equal(evaluate(measured, out).filter((r) => r.over).length, 0);
});

test("the CLI fails over budget and passes within it, on a real .next fixture", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "bundle-budget-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const next = join(dir, ".next");
  mkdirSync(join(next, "static/chunks"), { recursive: true });
  writeFileSync(join(next, "app-build-manifest.json"), JSON.stringify(appBuildManifest));
  writeFileSync(join(next, "build-manifest.json"), JSON.stringify(buildManifest));
  for (const f of new Set(
    Object.values(appBuildManifest.pages).flat().concat(buildManifest.rootMainFiles),
  )) {
    // Random bytes do not compress, so gzip size ≈ raw size: ~20 kB a chunk.
    mkdirSync(join(next, f, ".."), { recursive: true });
    writeFileSync(join(next, f), crypto.getRandomValues(new Uint8Array(20_000)));
  }
  const script = fileURLToPath(new URL("./check-bundle-budget.mjs", import.meta.url));
  const run = (budget) => {
    const path = join(dir, "budget.json");
    writeFileSync(path, JSON.stringify(budget));
    return spawnSync(process.execPath, [script, "--next-dir", next, "--budget", path], {
      encoding: "utf8",
    });
  };
  const tight = run({ default: 50 });
  assert.equal(tight.status, 1, tight.stdout + tight.stderr);
  assert.match(tight.stdout, /\/c\/\[slug\].*OVER BUDGET/);
  const loose = run({ default: 200 });
  assert.equal(loose.status, 0, loose.stdout + loose.stderr);

  const written = join(dir, "written.json");
  const w = spawnSync(
    process.execPath,
    [script, "--next-dir", next, "--budget", written, "--write"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(w.status, 0, w.stderr);
  assert.equal(run(JSON.parse(readFileSync(written, "utf8"))).status, 0);
});
