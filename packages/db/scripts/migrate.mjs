#!/usr/bin/env node
// MIGRATE WITH A LOCK TIMEOUT AND A DEPLOY LOCK.
//
// `drizzle-kit migrate` runs the pending batch in one transaction, which is a
// good property — a failure rolls the whole batch back. What it does not do is
// protect the two things that bite on a real database (audit PA-1 §7):
//
//   NO `lock_timeout`. An `ALTER TABLE` needs ACCESS EXCLUSIVE. If any
//   long-running read holds the table — a settlement fold, an export, an
//   analyst's query — the ALTER waits, and every statement arriving behind it
//   queues behind THAT, because a pending exclusive lock blocks new shared
//   locks. One slow reader plus one deploy is a total outage of that table, and
//   it looks like the application hanging rather than like a migration.
//
//   NO advisory lock. Two deploys, or a deploy racing a manual run, both read
//   the same journal and both apply the same batch.
//
// So: take a session advisory lock first (the second deployer waits, then finds
// nothing pending and exits clean), set a short `lock_timeout` so a blocked
// ALTER fails FAST and loudly instead of freezing the tenant, and only then
// migrate. Failing a deploy is cheap; freezing every read of `registrations`
// during an auction is not.
//
//   node scripts/migrate.mjs [--folder=./migrations] [--lock-timeout=5s]
//
// Env: DATABASE_URL. MIGRATE_LOCK_TIMEOUT overrides the default.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("db:migrate needs DATABASE_URL");
  process.exit(2);
}

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const folder = arg("folder", "./migrations");
const lockTimeout = arg("lock-timeout", process.env["MIGRATE_LOCK_TIMEOUT"] ?? "5s");

/**
 * One connection, because both the advisory lock and `lock_timeout` are
 * SESSION state — a pool would hand the migration a different backend than the
 * one holding the lock.
 */
const sql = postgres(url, { max: 1, onnotice: () => undefined });

/** A constant, so every deployer of this database competes for the same lock. */
const DEPLOY_LOCK = 4_120_250_905;

let held = false;
try {
  const [lock] = await sql`select pg_try_advisory_lock(${DEPLOY_LOCK}) as ok`;
  if (lock?.ok !== true) {
    // Not an error: the other deployer is applying the same batch. Wait for it
    // to finish and then confirm there is nothing left rather than racing it.
    console.log("another migration holds the deploy lock — waiting for it");
    await sql`select pg_advisory_lock(${DEPLOY_LOCK})`;
  }
  held = true;

  await sql.unsafe(`set lock_timeout = '${lockTimeout}'`);
  // A statement timeout would also cap a legitimate VALIDATE on a large table,
  // so only the LOCK wait is bounded here: we refuse to queue, not to work.
  console.log(`migrating with lock_timeout=${lockTimeout}`);

  await migrate(drizzle(sql), { migrationsFolder: folder });
  console.log("migrations applied");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("lock timeout") || message.includes("55P03")) {
    console.error(
      `\nMigration could not take its lock within ${lockTimeout}.\n` +
        "Something long-running is holding one of these tables. Nothing was\n" +
        "applied and nothing is queued behind it — which is the point: waiting\n" +
        "would have blocked every reader of that table too.\n\n" +
        "Find it with:\n" +
        "  select pid, state, wait_event_type, left(query, 120)\n" +
        "    from pg_stat_activity where state <> 'idle' order by query_start;\n",
    );
  } else {
    console.error(message);
  }
  process.exitCode = 1;
} finally {
  if (held) {
    await sql`select pg_advisory_unlock(${DEPLOY_LOCK})`;
  }
  await sql.end({ timeout: 5 });
}
