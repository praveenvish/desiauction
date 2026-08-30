#!/usr/bin/env node
// PRODUCTION LOGICAL BACKUP (PRR P0-1).
//
// The repo had a restore-VERIFY drill (a same-cluster dump→scratch→compare) but
// no command that actually PRODUCES a stored backup an operator could restore
// from. This is that command: `pg_dump -Fc` (custom format — compressed, and
// `pg_restore`-selectable) to a durable destination, with an exit code a
// scheduler can gate on.
//
//   node scripts/backup-database.mjs
//
// Env:
//   BACKUP_DATABASE_URL  the connection to dump. Prefer a DISTINCT read-only /
//                        backup role from the app role, and — for ransomware
//                        isolation — credentials the running app never holds.
//                        Falls back to DATABASE_URL if unset.
//   BACKUP_DIR           directory to write the dump into (default ./.local/backups).
//                        In production this MUST be a durable, OFF-HOST volume
//                        (a mounted object-store bucket, a separate account's
//                        disk) — a dump beside the database it came from is not
//                        a backup. See docs/operations/RESTORE_RUNBOOK.md.
//   BACKUP_RETAIN        how many local dumps to keep (default 14); older ones
//                        in BACKUP_DIR are pruned after a successful dump.
//   BACKUP_PG_CONTAINER  a docker container with version-matched pg tools; unset
//                        uses host `pg_dump` against the URL's host (prod form).
//
// This does NOT provision managed-Postgres PITR or cross-region replication —
// those remain operator provisioning (docs/62-backup-strategy.md). It gives the
// scheduled off-site logical-dump layer a real, tested command to run.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const url = process.env["BACKUP_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (url === undefined) {
  console.error("backup-database needs BACKUP_DATABASE_URL (or DATABASE_URL)");
  process.exit(2);
}
const parsed = new URL(url);
const dir = resolve(process.env["BACKUP_DIR"] ?? "./.local/backups");
// Guard the parse: a non-numeric BACKUP_RETAIN would make Number() NaN, and
// Math.max(1, NaN) is NaN, and dumps.slice(NaN) coerces to slice(0) — which
// would prune EVERY backup, including the one just written. Fall back to 14.
const retainRaw = Number(process.env["BACKUP_RETAIN"] ?? "14");
const retain = Number.isFinite(retainRaw) ? Math.max(1, Math.trunc(retainRaw)) : 14;
const container = process.env["BACKUP_PG_CONTAINER"] ?? "";

// A sortable UTC stamp (real wall clock — this is an ops script, not a workflow).
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const fileName = `desiauction-${stamp}.dump`;
mkdirSync(dir, { recursive: true });
const outPath = join(dir, fileName);

function run(tool, args) {
  const argv =
    container === ""
      ? [tool, "-h", parsed.hostname, "-p", parsed.port || "5432", ...args]
      : ["docker", "exec", container, tool, ...args];
  return execFileSync(argv[0], argv.slice(1), {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) },
  });
}

const dbName = parsed.pathname.slice(1);
const pgUser = decodeURIComponent(parsed.username);

console.log(`backing up ${dbName} → ${outPath}`);
try {
  // -Fc custom format, --no-owner/--no-acl so the dump restores under whatever
  // role the target instance uses (a fresh restore rarely has the same roles).
  run("pg_dump", [
    "-U",
    pgUser,
    "-d",
    dbName,
    "-Fc",
    "--no-owner",
    "--no-acl",
    "-f",
    container === "" ? outPath : `/tmp/${fileName}`,
  ]);
  if (container !== "") {
    // Copy the dump out of the container to the durable host directory.
    execFileSync("docker", ["cp", `${container}:/tmp/${fileName}`, outPath], { stdio: "inherit" });
    execFileSync("docker", ["exec", container, "rm", "-f", `/tmp/${fileName}`], {
      stdio: "inherit",
    });
  }
} catch (error) {
  console.error(`backup FAILED: ${String(error)}`);
  process.exit(1);
}

const size = statSync(outPath).size;
if (size === 0) {
  console.error("backup FAILED: produced a zero-byte dump");
  rmSync(outPath, { force: true });
  process.exit(1);
}
console.log(`backup complete: ${outPath} (${String(Math.round(size / 1024))} KiB)`);

// Prune old local dumps (retention). Off-site/object-store retention is the
// store's own lifecycle policy — this only bounds the local staging directory.
const dumps = readdirSync(dir)
  .filter((name) => name.startsWith("desiauction-") && name.endsWith(".dump"))
  .sort()
  .reverse();
for (const stale of dumps.slice(retain)) {
  rmSync(join(dir, stale), { force: true });
  console.log(`pruned old dump: ${stale}`);
}
