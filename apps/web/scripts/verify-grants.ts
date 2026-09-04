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
const APPEND_ONLY = [
  "auction_events",
  "settlement_events",
  "finops_events",
  "audit_log",
  "auction_team_target_revisions",
];

const RUNTIME_ROLES = ["desiauction_app", "desiauction_engine", "desiauction_runner"];

/**
 * The system pool's WRITE surface — the part that must stay narrow.
 *
 * This role is BYPASSRLS and reads platform-wide by design (it backs the admin
 * explorer). Pinning its reads was tried and converged on the whole schema, so
 * the recipe grants read honestly and this gate gets the assertion that
 * actually matters: it may write to exactly three tables, and any fourth is a
 * decision somebody has to make on purpose.
 */
const SYSTEM_MAY_WRITE = ["org_members", "grants", "audit_log", "invites"];

/**
 * Tables the WEB TIER writes with no RLS underneath it (DEMO-1).
 *
 * `demo_requests` and the scheduling tables carry no `org_id` and no policies —
 * the person filling the public form is a stranger with no tenant to be scoped
 * to. That makes the app role's grant the ONLY thing standing between the
 * feature and a 500 in production, where every other tenant table has RLS as a
 * second signal that something is wrong. Default privileges cover them today;
 * this states it so a recipe rewrite that drops those defaults fails here
 * rather than on the public demo page.
 *
 * The system role is deliberately absent: it reads this queue and never writes
 * it, which is why `SYSTEM_MAY_WRITE` above is still four tables long.
 */
/**
 * Tenant tables the WEB TIER is the sole writer of, asserted by name.
 *
 * The app role's write reach comes from `ALTER DEFAULT PRIVILEGES`, which is
 * invisible per-table — so a recipe rewrite that drops those defaults would
 * surface first on a club's import screen in production rather than here. These
 * are the tables where that would be worst: naming them makes the loss fail the
 * gate instead.
 *
 * RLS still scopes the ROWS; this asserts only that the grant exists at all.
 */
const APP_WRITES_TENANT = ["org_import_mappings", "auction_team_targets", "feature_settings"];

/**
 * PRIVATE PER-TEAM PLANS (WR-1 "My plan", migration 0041).
 *
 * The web tier is the only writer and the only intended reader. The engine and
 * runner would inherit SELECT from default privileges and must not have it: a
 * service credential that can read every owner's ceiling is a leak waiting
 * for a bug, and nothing either service folds reads a plan. The system pool
 * keeps its platform read by the same reasoning as the rest of the schema;
 * what contains it there is that no admin projection imports these tables.
 *
 * Revisions are evidence: the app appends them and no role rewrites them.
 */
const PRIVATE_PLAN_TABLES = ["auction_team_targets", "auction_team_target_revisions"];

const APP_WRITES_UNPROTECTED = [
  "demo_requests",
  "demo_availability",
  "demo_blackouts",
  "demo_bookings",
];

/**
 * Person-scoped tables the WEB TIER writes with no RLS underneath (PI-1).
 *
 * `player_profiles` follows `people` and `sessions`: platform-to-person data,
 * no org column, no policy — app-layer self-scoping is the lock. As with the
 * demo tables above, the app role's grant is the ONLY thing between the
 * account page's profile form and a 500 in production, so it is asserted by
 * name rather than trusted to default privileges.
 */
const APP_WRITES_PERSON = ["player_profiles"];

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

  for (const table of APP_WRITES_TENANT) {
    for (const verb of ["INSERT", "UPDATE", "DELETE"] as const) {
      out.push({
        role: "desiauction_app",
        table,
        verb,
        allowed: true,
        why: "the web tier is the only writer; RLS scopes the rows, the grant must exist",
      });
    }
  }

  for (const table of APP_WRITES_UNPROTECTED) {
    for (const verb of ["INSERT", "UPDATE", "DELETE"] as const) {
      out.push({
        role: "desiauction_app",
        table,
        verb,
        allowed: true,
        why: "the public demo form and the operator desk both write on the app pool (no RLS to bypass)",
      });
    }
  }

  for (const table of APP_WRITES_PERSON) {
    for (const verb of ["INSERT", "UPDATE"] as const) {
      out.push({
        role: "desiauction_app",
        table,
        verb,
        allowed: true,
        why: "person-scoped profile writes ride the app pool; module self-scoping is the lock (PI-1)",
      });
    }
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

  for (const table of allTables) {
    out.push({
      role: "desiauction_system",
      table,
      verb: "SELECT",
      allowed: true,
      why: "the system pool is the platform-read role (admin explorer + token paths)",
    });
    if (!SYSTEM_MAY_WRITE.includes(table)) {
      out.push({
        role: "desiauction_system",
        table,
        verb: "INSERT",
        allowed: false,
        why: "the system pool's write surface stays narrow — this is the RLS-exempt role",
      });
    }
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

  for (const table of PRIVATE_PLAN_TABLES) {
    for (const role of ["desiauction_engine", "desiauction_runner"]) {
      out.push({
        role,
        table,
        verb: "SELECT",
        allowed: false,
        why: "a private plan is not auction or finops truth; service writers must not even read it (WR-1)",
      });
    }
  }
  out.push({
    role: "desiauction_app",
    table: "auction_team_target_revisions",
    verb: "INSERT",
    allowed: true,
    why: "the web tier appends plan history in the same transaction as each edit (WR-1)",
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
