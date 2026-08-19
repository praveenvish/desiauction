/**
 * GRANT DRIFT GATE (audit 2026-08-18, P0-1).
 *
 * The four-role recipe in `ops/db/create-app-role.sql` enumerates what each
 * runtime role may write. Code moves; that file did not. For twelve migrations
 * the engine had no UPDATE on `registrations` — the table every sale writes —
 * and the app role had no privileges at all on six newer tables. Nothing went
 * red, because every local process (web, engine, runner, seed, e2e) connects as
 * the database OWNER, which bypasses the grant model completely.
 *
 * This script closes that loop by asserting the grants a running system needs,
 * against a real database, under the real role names. It is deliberately a
 * DECLARED MANIFEST rather than a scrape of the source: the point is that a
 * human states what each role should be able to touch, and the database is
 * asked whether that is true. A new write path fails here until someone extends
 * both the recipe and this list — which is the conversation that was missing.
 *
 *   pnpm --filter @desiauction/web grants:verify
 *
 * Exit 0 = every expectation holds. Exit 1 = drift, printed with the fix.
 * Requires DATABASE_URL pointing at a database where the roles exist; it uses
 * `has_table_privilege`, so it needs no passwords and connects only once.
 */

import { createDb } from "@desiauction/db";
import { sql } from "drizzle-orm";

type Verb = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

interface Expectation {
  role: string;
  table: string;
  verb: Verb;
  allowed: boolean;
  why: string;
}

/** Tables the ENGINE mutates (packages/auction aggregate write paths). */
const ENGINE_WRITES = [
  "auctions",
  "lots",
  "bids",
  "paddles",
  "paddle_grants",
  "auction_owner_invites",
];

/** Tables the RUNNER mutates (packages/financial-operations write paths). */
const RUNNER_WRITES = [
  "finops_documents",
  "finops_dispatches",
  "finops_exports",
  "finops_jobs",
  "finops_cursors",
  "finops_periods",
  "finops_period_days",
  "finops_profiles",
  "finops_series",
  "finops_schedules",
];

/**
 * Append-only evidence. Every runtime role may INSERT and none may rewrite:
 * these are what the projections are rebuilt FROM, so a role that can edit them
 * can make the replay agree with a lie.
 */
const APPEND_ONLY = ["auction_events", "settlement_events", "finops_events", "audit_log"];

const RUNTIME_ROLES = ["desiauction_app", "desiauction_engine", "desiauction_runner"];

/**
 * Tables the SYSTEM pool must be able to read.
 *
 * This role was designed for two pre-tenant token paths and has quietly become
 * the backing pool for the admin explorer, the account screen and the
 * cross-org listings. Under the documented recipe those routes returned 500s
 * that no local run could reproduce, because local runs connect as the owner.
 *
 * Pinned here so the list is a decision, not a leak: adding a system-pool read
 * now fails this gate until someone extends both the recipe and this array —
 * and has to look at the comment in create-app-role.sql explaining why every
 * addition widens what an RLS-EXEMPT connection can see.
 */
const SYSTEM_READS = [
  "invites",
  "organizations",
  "org_members",
  "auction_owner_invites",
  "auctions",
  "competitions",
  "teams",
  "tournaments",
  "fixtures",
  "grounds",
  "venues",
  "audit_log",
  "settlement_cases",
  "suppressions",
  "grants",
  "people",
  "registrations",
  "notification_preferences",
  "finops_profiles",
];

function expectations(allTables: string[]): Expectation[] {
  const out: Expectation[] = [];

  // The web tier reads and writes every tenant table — RLS, not grants, is what
  // scopes it. Anything the app role cannot even SELECT is a 500 in production
  // and a green test locally.
  for (const table of allTables) {
    if (table === "finops_events") continue; // freeze §8.2: runner is the writer
    out.push({
      role: "desiauction_app",
      table,
      verb: "SELECT",
      allowed: true,
      why: "the web tier reads every tenant table; RLS scopes the rows, not the grant",
    });
  }

  for (const table of ENGINE_WRITES) {
    for (const verb of ["INSERT", "UPDATE", "DELETE"] as const) {
      out.push({
        role: "desiauction_engine",
        table,
        verb,
        allowed: true,
        why: "the engine is the single writer of auction truth",
      });
    }
  }
  // The regression this whole gate exists for.
  out.push({
    role: "desiauction_engine",
    table: "registrations",
    verb: "UPDATE",
    allowed: true,
    why: "closeLot stamps registrations.team_id on every SOLD lot (P0-1)",
  });

  for (const table of RUNNER_WRITES) {
    for (const verb of ["INSERT", "UPDATE", "DELETE"] as const) {
      out.push({
        role: "desiauction_runner",
        table,
        verb,
        allowed: true,
        why: "the runner is the single FinOps writer",
      });
    }
  }

  for (const table of SYSTEM_READS) {
    out.push({
      role: "desiauction_system",
      table,
      verb: "SELECT",
      allowed: true,
      why: "a documented pre-tenant or cross-org read runs on the system pool",
    });
  }

  for (const table of APPEND_ONLY) {
    for (const role of RUNTIME_ROLES) {
      for (const verb of ["UPDATE", "DELETE"] as const) {
        out.push({
          role,
          table,
          verb,
          allowed: false,
          why: "append-only ledger: evidence may be added to, never rewritten",
        });
      }
    }
  }
  out.push({
    role: "desiauction_engine",
    table: "auction_events",
    verb: "INSERT",
    allowed: true,
    why: "the engine appends the auction event stream",
  });
  out.push({
    role: "desiauction_runner",
    table: "finops_events",
    verb: "INSERT",
    allowed: true,
    why: "the runner appends the finops event stream",
  });
  out.push({
    role: "desiauction_app",
    table: "finops_events",
    verb: "INSERT",
    allowed: false,
    why: "freeze §8.2: the web tier cannot write finops truth",
  });

  return out;
}

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    console.error("grants:verify needs DATABASE_URL");
    process.exit(1);
  }
  const handle = createDb(url);
  try {
    const roleRows = await handle.sql<{ rolname: string }[]>`
      select rolname from pg_roles where rolname like 'desiauction\\_%'`;
    const present = new Set(roleRows.map((row) => row.rolname));
    const missing = [...RUNTIME_ROLES, "desiauction_system"].filter((r) => !present.has(r));
    if (missing.length > 0) {
      console.error(
        `grants:verify — these roles do not exist: ${missing.join(", ")}\n` +
          `  fix: psql -v app_password=… -v system_password=… -v engine_password=… ` +
          `-v runner_password=… -f ops/db/create-app-role.sql`,
      );
      process.exit(1);
    }

    const tableRows = await handle.sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' order by tablename`;
    const allTables = tableRows.map((row) => row.tablename);

    const failures: string[] = [];
    for (const expectation of expectations(allTables)) {
      const [row] = await handle.sql<{ ok: boolean }[]>`
        select has_table_privilege(${expectation.role}, ${"public." + expectation.table},
          ${expectation.verb}) as ok`;
      const actual = row?.ok ?? false;
      if (actual !== expectation.allowed) {
        failures.push(
          `  ${expectation.role} ${expectation.allowed ? "MUST" : "MUST NOT"} ` +
            `${expectation.verb} ${expectation.table} — ${expectation.why}`,
        );
      }
    }

    if (failures.length > 0) {
      console.error(
        `grants:verify FAILED — ${String(failures.length)} expectation(s) drifted:\n` +
          failures.join("\n") +
          `\n\n  fix: re-run ops/db/create-app-role.sql with all four passwords, and if a new\n` +
          `  write path was added, extend BOTH that file and this script's manifest.`,
      );
      process.exit(1);
    }
    console.log(
      `GRANTS VERIFIED — ${String(expectations(allTables).length)} expectations across ` +
        `${String(allTables.length)} tables and 4 roles.`,
    );
  } finally {
    await handle.sql.end();
  }
}

await main();
