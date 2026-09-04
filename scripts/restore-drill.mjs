#!/usr/bin/env node
// THE RESTORE DRILL (PA-1R Phase 8.4).
//
// `scripts/backup-database.mjs` produces a dump and the nightly workflow stores
// it off-host. `apps/web/scripts/restore-verify.ts` proves a restored copy
// carries the dump's row counts. Neither answers the question an incident
// actually asks, which is not "did the bytes survive" but:
//
//   HOW LONG does it take to get from a dump to a database that can run an
//   auction, and does anything have to be discovered on the way?
//
// This walks RESTORE_RUNBOOK steps 2–6 end to end, timing each one, and then —
// with `--rehearse` — conducts a whole auction night on the restored database
// under the four production roles. That last step is the part no count
// comparison can give you: `pg_dump --no-owner --no-acl` deliberately drops the
// role model, so a restored database has the data and NONE of the grants or
// policies until the recipe is re-applied. A drill that stops at row counts
// would call that a success and hand an operator a database the application
// cannot write to.
//
//   node scripts/restore-drill.mjs                 # dump → restore → roles → verify
//   node scripts/restore-drill.mjs --rehearse      # …then run a night on it
//   node scripts/restore-drill.mjs --keep          # leave the scratch DB behind
//
// Env:
//   DATABASE_URL         the source to dump (owner credentials).
//   DRILL_CONTAINER      docker container with version-matched pg tools
//                        (default desiauction-postgres). Set to "" to use host
//                        tools against DATABASE_URL's host — the production form.
//   *_DB_PASSWORD        role passwords for the recipe (local defaults below).
//
// Steps 1 and 7 of the runbook — stopping writers and cutting production over —
// are deliberately NOT here. They are decisions about live traffic, not commands.

import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("restore-drill needs DATABASE_URL (the source database, owner credentials)");
  process.exit(2);
}

const rehearse = process.argv.includes("--rehearse");
const keep = process.argv.includes("--keep");
const container = process.env["DRILL_CONTAINER"] ?? "desiauction-postgres";

const source = new URL(url);
const sourceDb = source.pathname.slice(1);
const admin = decodeURIComponent(source.username);
const password = decodeURIComponent(source.password);
const port = source.port === "" ? "5432" : source.port;
const scratch = `restore_drill_${String(Date.now())}`;
const dumpPath = `/tmp/${scratch}.dump`;

/** Run a Postgres tool, in the container or on the host, with the source password. */
function pg(tool, args, options = {}) {
  // `docker exec` does not attach stdin unless asked, and a psql reading `-f -`
  // from an unattached stdin exits 0 having executed nothing. That is how the
  // first run of this drill "re-applied" the role recipe in 0.1s and then found
  // the app role could not read `otp_codes` — the failure was two steps away
  // from its cause, which is exactly the shape of bug a drill exists to catch.
  const stdin = options.input === undefined ? [] : ["-i"];
  const argv =
    container === ""
      ? [tool, "-h", source.hostname, "-p", port, ...args]
      : ["docker", "exec", ...stdin, "-e", `PGPASSWORD=${password}`, container, tool, ...args];
  const [command, ...rest] = argv;
  return execFileSync(command, rest, {
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: password },
    // stdin must be a pipe when there is input to feed — "ignore" silently
    // discards it, which is the second half of the same bug as the missing
    // `docker exec -i` above: psql read nothing and exited 0.
    stdio:
      options.inherit === true
        ? "inherit"
        : [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    ...(options.input === undefined ? {} : { input: options.input }),
  });
}

const timings = [];
async function timed(label, fn) {
  const started = performance.now();
  process.stdout.write(`  ${label} … `);
  try {
    const result = await fn();
    const seconds = (performance.now() - started) / 1000;
    timings.push({ label, seconds });
    console.log(`${seconds.toFixed(1)}s`);
    return result;
  } catch (error) {
    console.log("FAILED");
    throw error;
  }
}

/** Per-table row counts, the comparison the restore is judged on. */
const COUNT_SQL = `
  select relname || ':' || (xpath('/row/cnt/text()',
    query_to_xml('select count(*) as cnt from public.' || quote_ident(relname), false, true, '')
  ))[1]::text::bigint
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by relname
`;

function counts(database) {
  return pg("psql", [
    `postgres://${admin}:${password}@localhost:5432/${database}`,
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    COUNT_SQL,
  ])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

console.log(`\nRESTORE DRILL — ${sourceDb} → ${scratch}\n`);

let failed = null;
try {
  // The counts are taken FIRST, from the source, so a slow restore cannot be
  // credited with rows written while it ran.
  const before = await timed("source row counts", () => counts(sourceDb));

  await timed("pg_dump -Fc (runbook: the backup being restored)", () =>
    pg("pg_dump", ["-U", admin, "-d", sourceDb, "-Fc", "--no-owner", "--no-acl", "-f", dumpPath]),
  );

  await timed("provision a clean target (step 2)", () => pg("createdb", ["-U", admin, scratch]));

  await timed("pg_restore (step 3)", () =>
    pg("pg_restore", [
      "-U",
      admin,
      "-d",
      scratch,
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      dumpPath,
    ]),
  );

  // Step 4 (migrations newer than the dump) is a no-op when the dump is current,
  // which it always is here — the drill dumps the database it is about to
  // restore. In a real incident this is where `db:migrate` runs.

  await timed("re-create the four roles and grants (step 5)", () => {
    const recipe = execFileSync("cat", ["ops/db/create-app-role.sql"], { encoding: "utf8" });
    return pg(
      "psql",
      [
        `postgres://${admin}:${password}@localhost:5432/${scratch}`,
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        `app_password=${process.env["APP_DB_PASSWORD"] ?? "local-app"}`,
        "-v",
        `system_password=${process.env["SYSTEM_DB_PASSWORD"] ?? "local-system"}`,
        "-v",
        `engine_password=${process.env["ENGINE_DB_PASSWORD"] ?? "local-engine"}`,
        "-v",
        `runner_password=${process.env["RUNNER_DB_PASSWORD"] ?? "local-runner"}`,
        "-f",
        "-",
      ],
      { input: recipe },
    );
  });

  const after = await timed("restored row counts", () => counts(scratch));

  const drift = [];
  const restored = new Map(after.map((row) => row.split(":")));
  for (const row of before) {
    const [table, count] = row.split(":");
    const got = restored.get(table);
    if (got !== count) {
      drift.push(`${table}: ${count ?? "?"} → ${got ?? "missing"}`);
    }
  }
  if (drift.length > 0) {
    throw new Error(`restored copy differs from the source:\n    ${drift.join("\n    ")}`);
  }
  console.log(`  ✓ ${String(before.length)} tables, every row count identical`);

  // THE PART THAT MATTERS. A restored database that passes a count comparison
  // and cannot run an auction has not been restored, it has been copied.
  if (rehearse) {
    console.log("\n  Conducting a full auction night on the restored database:\n");
    await timed("rehearsal under the four roles (step 6, the real one)", () =>
      execFileSync("pnpm", ["--filter", "@desiauction/web", "rehearsal"], {
        encoding: "utf8",
        env: {
          ...process.env,
          REHEARSAL_DB_NAME: scratch,
          REHEARSAL_DB_PORT: port,
          OWNER_DATABASE_URL: `postgres://${admin}:${password}@${source.hostname}:${port}/${scratch}`,
        },
        stdio: "inherit",
      }),
    );
  } else {
    console.log("\n  (no --rehearse: the restored database was counted, not exercised)");
  }
} catch (error) {
  failed = error;
} finally {
  if (!keep) {
    try {
      pg("dropdb", ["-U", admin, "--if-exists", scratch]);
      // The dump lives wherever pg_dump ran — inside the container, or on this
      // host when DRILL_CONTAINER is empty.
      if (container === "") {
        execFileSync("rm", ["-f", dumpPath]);
      } else {
        execFileSync("docker", ["exec", container, "rm", "-f", dumpPath]);
      }
    } catch {
      console.error(`  could not clean up ${scratch} — drop it by hand`);
    }
  } else {
    console.log(`\n  --keep: ${scratch} and ${dumpPath} left in place`);
  }
}

const total = timings.reduce((sum, entry) => sum + entry.seconds, 0);
console.log(`\n  ${"—".repeat(58)}`);
for (const entry of timings) {
  console.log(`  ${entry.seconds.toFixed(1).padStart(6)}s  ${entry.label}`);
}
console.log(`  ${total.toFixed(1).padStart(6)}s  TOTAL — the RTO for this database at this size\n`);

if (failed !== null) {
  console.error(
    `RESTORE DRILL FAILED: ${failed instanceof Error ? failed.message : String(failed)}\n`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "RESTORE DRILL PASSED. Record the total above in the rehearsal table of\n" +
      "docs/operations/RESTORE_RUNBOOK.md, with the row count and the date — an\n" +
      "RTO is only meaningful next to the size of the database it was measured on.\n",
  );
}
