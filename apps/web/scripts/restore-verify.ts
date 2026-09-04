// Backup restore-verify drill (docs/62 §Verification, PRP-1 §5). Dumps the
// live database and proves the restored copy carries EXACTLY the dump's
// snapshot: source counts are taken inside a repeatable-read transaction that
// exports the snapshot pg_dump runs under, so concurrent live writes cannot
// skew the comparison. Scratch database and dump file are destroyed after.
//
// Run: pnpm db:restore-verify
// Env: RESTORE_VERIFY_CONTAINER (default desiauction-postgres) — docker
//      container with version-matched pg tools; set to "" to use host tools
//      against DATABASE_URL's host (production form).
import { execFileSync } from "node:child_process";

import { createDb } from "@desiauction/db";

const url = process.env["DATABASE_URL"];
if (url === undefined) {
  console.error("db:restore-verify needs DATABASE_URL");
  process.exit(2);
}
const container = process.env["RESTORE_VERIFY_CONTAINER"] ?? "desiauction-postgres";
const parsed = new URL(url);
const dbName = parsed.pathname.slice(1);
const pgUser = decodeURIComponent(parsed.username);
const scratch = `restore_verify_${String(Date.now())}`;
const dumpPath = `/tmp/${scratch}.dump`;

function pg(tool: string, args: string[]): string {
  const argv =
    container === ""
      ? [tool, "-h", parsed.hostname, "-p", parsed.port || "5432", ...args]
      : ["docker", "exec", container, tool, ...args];
  return execFileSync(argv[0] as string, argv.slice(1), {
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) },
  });
}

const COUNT_SQL = `
  select relname, (xpath('/row/cnt/text()',
    query_to_xml('select count(*) as cnt from public.' || quote_ident(relname), false, true, '')
  ))[1]::text::bigint as count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and relkind = 'r' order by relname`;

async function main(): Promise<void> {
  // Disable the idle-in-transaction ceiling for this connection: the drill holds
  // a repeatable-read transaction OPEN (idle) while the external pg_dump runs on
  // its exported snapshot, which can exceed the default 60s on a real database.
  // The default would kill the snapshot mid-dump (PRR re-validation regression).
  const handle = createDb(url as string, { idleTransactionTimeoutMs: 0, statementTimeoutMs: 0 });
  let sourceCounts: Record<string, string> = {};
  try {
    // Snapshot-consistent source truth: counts and pg_dump share one snapshot.
    await handle.sql.begin("isolation level repeatable read", async (tx) => {
      const [snap] = await tx<{ id: string }[]>`select pg_export_snapshot() as id`;
      const rows = await tx.unsafe<{ relname: string; count: string }[]>(COUNT_SQL);
      sourceCounts = Object.fromEntries(rows.map((r) => [r.relname, String(r.count)]));
      console.log(`1/4 dump under snapshot ${snap?.id ?? "?"} (${String(rows.length)} tables)`);
      pg("pg_dump", ["-U", pgUser, "-Fc", dbName, `--snapshot=${snap?.id ?? ""}`, "-f", dumpPath]);
    });

    console.log(`2/4 restore into scratch (${scratch})`);
    pg("psql", ["-U", pgUser, "-d", "postgres", "-c", `CREATE DATABASE ${scratch}`]);
    pg("pg_restore", ["-U", pgUser, "-d", scratch, "--no-owner", dumpPath]);

    console.log("3/4 exact row-count comparison");
    const restoredRaw = pg("psql", [
      "-U",
      pgUser,
      "-d",
      scratch,
      "-tAc",
      COUNT_SQL.replaceAll("\n", " "),
    ]);
    const restored = Object.fromEntries(
      restoredRaw
        .trim()
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.split("|") as [string, string]),
    );

    const tables = Object.keys(sourceCounts);
    const mismatches = tables.filter((t) => sourceCounts[t] !== restored[t]);
    const missing = Object.keys(restored).filter((t) => !(t in sourceCounts));
    if (mismatches.length === 0 && missing.length === 0 && tables.length > 0) {
      console.log(`RESTORE VERIFIED — ${String(tables.length)} tables, exact row counts identical`);
    } else {
      process.exitCode = 1;
      for (const t of mismatches) {
        console.error(`  ✗ ${t}: source ${sourceCounts[t] ?? "-"} restored ${restored[t] ?? "-"}`);
      }
      console.error("RESTORE MISMATCH");
    }
  } finally {
    console.log("4/4 cleanup");
    try {
      pg("psql", ["-U", pgUser, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS ${scratch}`]);
      if (container === "") {
        execFileSync("rm", ["-f", dumpPath]);
      } else {
        execFileSync("docker", ["exec", container, "rm", "-f", dumpPath]);
      }
    } catch (cleanupError) {
      console.error("cleanup failed:", cleanupError);
      process.exitCode = process.exitCode ?? 1;
    }
    await handle.sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
