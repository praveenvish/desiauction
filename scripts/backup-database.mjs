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
  /*
   * Take the partial file with it.
   *
   * `pg_dump` creates its output file before it can fail — a version mismatch,
   * a lost connection — so a failed run left a zero-byte `.dump` sitting in the
   * backup directory. That file then looks exactly like a backup to anyone
   * listing it, and it counts toward the retention window below, so it can push
   * a REAL dump out of the retained set. The success path already refuses a
   * zero-byte result; the failure path has to as well.
   */
  rmSync(outPath, { force: true });
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

/*
 * OFF-HOST, OR IT IS NOT A BACKUP.
 *
 * The header above already says a dump beside the database it came from is not
 * a backup, and until now the script could not do anything about it: it wrote
 * to a local directory and stopped (audit PA-1 §19). `BACKUP_S3_URI` is that
 * missing half — the dump is copied to object storage, on credentials the
 * running application never holds, which is what makes it survive both a lost
 * host and a compromised one.
 *
 * `aws s3 cp` rather than a signing implementation here: it is present on CI
 * runners and every ops box, it honours the standard credential chain, and a
 * root script in this repository deliberately carries no dependencies. If the
 * CLI is missing the backup FAILS — a dump that was supposed to leave the host
 * and silently did not is the worst of both, because it reports success.
 *
 * The alternative, for an operator who mounts a bucket as a filesystem, is to
 * point BACKUP_DIR at the mount and leave this unset.
 */
const s3Uri = process.env["BACKUP_S3_URI"] ?? "";
if (s3Uri !== "") {
  const destination = `${s3Uri.replace(/\/$/, "")}/${fileName}`;
  console.log(`copying off-host → ${destination}`);
  try {
    execFileSync("aws", ["s3", "cp", outPath, destination], { stdio: "inherit" });
  } catch (error) {
    console.error(
      `backup FAILED: could not copy the dump off-host (${String(error)}).\n` +
        "The local dump is kept, but this run has NOT produced an off-site backup.\n" +
        "Check that the aws CLI is installed and its credentials can write to " +
        `${s3Uri}.`,
    );
    process.exit(1);
  }
  console.log("off-host copy complete");
} else {
  console.log(
    "BACKUP_S3_URI unset — this dump exists only on this host.\n" +
      "That is a staging copy, not a backup: set BACKUP_S3_URI, or point " +
      "BACKUP_DIR at a mounted bucket.",
  );
}

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
