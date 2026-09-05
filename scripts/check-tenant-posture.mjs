#!/usr/bin/env node
// THE GATE THAT WOULD HAVE CAUGHT THE PAYMENT WEBHOOK (audit PA-1, §10 P0-1).
//
// Two of that audit's three most serious defects were the same defect: a code
// path that reached for a database pool WITHOUT entering `withTenantDb`, so no
// `app.org_id` was ever set. Under the production four-role recipe — where
// `desiauction_app` is NOBYPASSRLS and 46 tables carry FORCE ROW LEVEL
// SECURITY — such a path sees zero rows and fails. Under every local process,
// which connects as the database OWNER, it works perfectly.
//
// That asymmetry is the whole problem: the bug is invisible in every
// environment the team can observe, and appears for the first time on the first
// real payment. No test caught it because no test runs as a role that could.
//
// This script makes the class visible without needing a database at all. It
// reads the source, finds every file that reaches a pool directly, and requires
// each one to be listed — with a written reason — in `ops/posture-allowlist.json`.
//
// It is a RATCHET, not a cliff:
//
//   · a NEW unlisted bypass fails the build, so the class cannot grow;
//   · a listed file that no longer bypasses ALSO fails the build, so the list
//     cannot rot — fixing a file forces you to delete its entry;
//   · the allowlist count is printed on every run, so the debt is a number
//     somebody watches go down (PA-1R Phase 3.4 burns it down).
//
// What counts as safe: `withTenantDb(dbHandle, …)`. That helper opens a
// transaction and sets `app.person_id` / `app.org_id` transaction-locally
// (packages/db/src/index.ts), which is the only thing that makes the RLS
// policies evaluate to anything.
//
// What counts as a bypass:
//   · `systemDb` / `systemHandle` — the RLS-EXEMPT pool. Legitimate for the
//     named pre-tenant token paths and the platform-admin surface; a bypass
//     everywhere else.
//   · `db` imported from `server/db` — that is `dbHandle.db`, the app pool with
//     no GUC set. Correct only where the query is genuinely tenant-free.
//   · `dbHandle` used anywhere other than as the first argument of
//     `withTenantDb` — same reason.
//
// Usage: node scripts/check-tenant-posture.mjs [--json]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const webSrc = join(repoRoot, "apps/web/src");
const allowlistPath = join(repoRoot, "ops/posture-allowlist.json");
const asJson = process.argv.includes("--json");

/** Identifiers exported by `apps/web/src/server/db.ts` that reach a pool raw. */
const RAW_POOL_IMPORTS = ["systemDb", "systemHandle", "db", "dbHandle"];

/**
 * Strip comments before matching.
 *
 * Not cosmetic: this repository documents its reasoning at length, and the
 * words `systemDb` and `withTenantDb` appear in dozens of comment blocks that
 * explain the very rule being checked. Matching those would report a file as a
 * bypass because it TALKS about bypasses. String and template literals are left
 * alone — an identifier inside a string is not a call, and none of the patterns
 * below appear in this codebase's strings.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code"; // code | line | block | single | double | template
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") state = "single";
      else if (c === '"') state = "double";
      else if (c === "`") state = "template";
      out += c;
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") {
        state = "code";
        i += 2;
        continue;
      }
      // Keep newlines so reported line numbers stay truthful.
      if (c === "\n") out += c;
      i += 1;
      continue;
    }
    // Inside a string/template: copy through, honouring escapes.
    if (c === "\\") {
      out += c + (next ?? "");
      i += 2;
      continue;
    }
    if (
      (state === "single" && c === "'") ||
      (state === "double" && c === '"') ||
      (state === "template" && c === "`")
    ) {
      state = "code";
    }
    out += c;
    i += 1;
  }
  return out;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, files);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // Tests are exempt: fixtures legitimately need owner-level reach, and the
    // runtime proof for tests is `posture:verify`, not this static read.
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    files.push(full);
  }
  return files;
}

/** Which raw-pool identifiers does this file import from the db module? */
function poolImports(code) {
  const found = new Set();
  // `import { a, b } from "…/server/db"` and `"../db"` inside server/.
  const importRe = /import\s*\{([^}]*)\}\s*from\s*["']([^"']*(?:server\/db|\/db))["']/g;
  let m;
  while ((m = importRe.exec(code)) !== null) {
    const specifier = m[2];
    // Only our own db module — never `@desiauction/db` (the schema package,
    // which exports tables, not pools).
    if (specifier.startsWith("@")) continue;
    for (const raw of m[1].split(",")) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (RAW_POOL_IMPORTS.includes(name)) found.add(name);
    }
  }
  return found;
}

/**
 * Which imported pool identifiers does this file reach RAW?
 *
 * This classifies; it deliberately does not count. Counting occurrences by
 * regex is unreliable here for two reasons that both bite: the import statement
 * is itself an occurrence, and `withTenantDb(dbHandle, …, (db) => …)` binds a
 * callback parameter literally named `db`, so a file with one honest raw use
 * can look like it has thirty. A gate that reports numbers nobody trusts is a
 * gate somebody switches off, so it reports only the fact that matters: this
 * file reaches this pool without a tenant boundary.
 *
 * `systemDb` / `systemHandle` / `db`: importing them is reaching them. An
 * unused import would be caught by lint, so presence implies use.
 *
 * `dbHandle` is the one case needing arithmetic, because passing it to
 * `withTenantDb` is exactly the CORRECT usage. Subtract the wrapped calls and
 * the import line; anything left over is a raw reach.
 */
function bypassesFor(code, imported) {
  const reasons = [];
  for (const name of imported) {
    if (name === "dbHandle") {
      const all = (code.match(/\bdbHandle\b/g) ?? []).length;
      const wrapped = (code.match(/withTenantDb\(\s*dbHandle\b/g) ?? []).length;
      // − 1 for the import statement itself.
      if (all - wrapped - 1 > 0) reasons.push("dbHandle reached raw");
      continue;
    }
    reasons.push(`${name} imported`);
  }
  return reasons.sort();
}

/**
 * Tables `desiauction_system` may write, mirroring SYSTEM_MAY_WRITE in
 * apps/web/scripts/verify-grants.ts (which asserts it against the real roles).
 *
 * SCOPE, HONESTLY: this catches only a DIRECT `systemDb.insert(table)`. Today
 * that is two call sites, both `audit_log`, both legitimate — so on its own
 * this check passes vacuously and proves nothing. The writes that actually
 * matter reach the pool as a passed-in handle (`suppress(systemDb, …)`,
 * `webFinopsDeps(systemDb)`), 64 such sites, and no regex can follow them into
 * a helper and out the other side to a table name.
 *
 * Those are covered by `pnpm posture:verify`, which runs the real handlers as
 * the real roles and lets Postgres answer the question. This check exists so
 * the obvious form cannot be added without noticing — not as the safety net.
 */
const SYSTEM_MAY_WRITE = ["org_members", "grants", "audit_log", "invites"];

const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const allowed = allowlist.allow ?? {};

const violations = [];
const stale = [];
const listedAndStillNeeded = [];

const seen = new Set();
for (const file of walk(webSrc)) {
  const rel = relative(repoRoot, file);
  // The db module itself defines the pools; it cannot be a bypass of itself.
  if (rel === "apps/web/src/server/db.ts") continue;
  const code = stripComments(readFileSync(file, "utf8"));
  const imported = poolImports(code);
  if (imported.size === 0) continue;
  // A direct write on the system pool to a table its role cannot write.
  const writeRe = /\bsystemDb\s*\.\s*(?:insert|update|delete)\s*\(\s*([A-Za-z_$][\w$]*)/g;
  let w;
  while ((w = writeRe.exec(code)) !== null) {
    const table = w[1];
    // Drizzle identifiers are camelCase for snake_case tables.
    const snake = table.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
    if (!SYSTEM_MAY_WRITE.includes(snake)) {
      violations.push({
        file: rel,
        reasons: [
          `writes '${snake}' on the system pool, which is not in SYSTEM_MAY_WRITE ` +
            `(${SYSTEM_MAY_WRITE.join(", ")})`,
        ],
      });
    }
  }

  const reasons = bypassesFor(code, imported);
  seen.add(rel);
  if (reasons.length === 0) continue;
  if (rel in allowed) listedAndStillNeeded.push(rel);
  else violations.push({ file: rel, reasons });
}

for (const rel of Object.keys(allowed)) {
  if (!listedAndStillNeeded.includes(rel)) stale.push(rel);
}

if (asJson) {
  console.log(JSON.stringify({ violations, stale, debt: listedAndStillNeeded.length }, null, 2));
} else {
  if (violations.length > 0) {
    console.error("\nTENANT POSTURE — new bypasses, not on the allowlist:\n");
    for (const v of violations) {
      console.error(`  ✗ ${v.file}`);
      console.error(`      ${v.reasons.join(", ")}`);
    }
    console.error(
      "\nEach of these reaches a database pool without entering withTenantDb, so no\n" +
        "app.org_id is set and every RLS policy evaluates false under the production\n" +
        "role recipe. Either wrap the work in withTenantDb, or add the file to\n" +
        "ops/posture-allowlist.json with a reason a reviewer would accept.\n",
    );
  }
  if (stale.length > 0) {
    console.error("\nTENANT POSTURE — stale allowlist entries (the ratchet):\n");
    for (const rel of stale) console.error(`  ✗ ${rel}`);
    console.error(
      "\nThese are listed as bypasses but no longer bypass anything (or no longer\n" +
        "exist). Delete them from ops/posture-allowlist.json — the list is only\n" +
        "meaningful while it is exact, and an entry that outlives its fix is how a\n" +
        "gate quietly stops gating.\n",
    );
  }
  if (violations.length === 0 && stale.length === 0) {
    const byClass = { defect: 0, debt: 0, "by-design": 0 };
    for (const rel of listedAndStillNeeded) {
      const cls = allowed[rel]?.class ?? "by-design";
      byClass[cls] = (byClass[cls] ?? 0) + 1;
    }
    console.log(
      "tenant posture: every pool reach is inside withTenantDb or on the allowlist.\n" +
        `  by-design ${String(byClass["by-design"])}  ·  debt ${String(byClass.debt)}` +
        `  ·  defect ${String(byClass.defect)}   (debt and defect must reach 0)`,
    );
  }
}

process.exit(violations.length + stale.length > 0 ? 1 : 0);
