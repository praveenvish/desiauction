/**
 * SERVER RESPONSE TIME PER ROUTE, PER ROLE (launch polish, Phase 1).
 *
 * Mints a short-lived session straight into `sessions` for each seeded demo
 * identity (no OTP spent, no /login round trip), then times time-to-first-byte
 * for each route: one cold hit discarded, then RUNS warm hits, median reported.
 * The session rows are revoked on exit.
 *
 * Against `next dev` the warm number is still meaningful for DATABASE work —
 * the compile is paid on the discarded first hit — so before/after comparisons
 * of query changes hold. Absolute numbers belong to a production build
 * (`pnpm --filter @desiauction/web preview`, then PERF_BASE=http://127.0.0.1:3100).
 *
 *   pnpm --filter @desiauction/web perf:routes [-- --json out.json]
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import { createDb } from "@desiauction/db";

const BASE = process.env["PERF_BASE"] ?? "http://localhost:3000";
const RUNS = Number(process.env["PERF_RUNS"] ?? "5");
const handle = createDb(
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5436/desiauction",
);
const sql = handle.sql;

const ROLES = [
  {
    role: "guest",
    phone: null,
    routes: ["/", "/pricing", "/features", "/help", "/login", "/c", "/legal"],
  },
  {
    role: "organizer",
    phone: "+919999000003",
    routes: [
      "/home",
      "/tournaments",
      "/orgs",
      "/org/demo-club",
      "/seasons/demo-premier-league",
      "/seasons/demo-premier-league/teams",
      "/seasons/demo-premier-league/registrations",
      "/account",
      "/inbox",
    ],
  },
  { role: "viewer", phone: "+919999000007", routes: ["/home", "/account", "/tournaments"] },
  { role: "founder", phone: "+919999000001", routes: ["/admin", "/money"] },
];

async function mintSession(phone: string): Promise<{ id: string; token: string }> {
  const [person] = await sql<
    { id: string }[]
  >`select id from people where phone = ${phone} limit 1`;
  if (!person) throw new Error(`no seeded person for ${phone} — run pnpm seed:demo`);
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const id = `PERF${randomBytes(11).toString("hex").toUpperCase()}`.slice(0, 26);
  await sql`insert into sessions (id, person_id, token_hash, expires_at, user_agent)
            values (${id}, ${person.id}, ${hash}, now() + interval '1 hour', 'perf-routes')`;
  return { id, token };
}

// `next dev` restarts itself at its memory threshold and resets the sockets in
// flight; one retry keeps a restart from ending the run.
async function ttfb(
  route: string,
  cookie: string | undefined,
): Promise<{ status: number; ms: number }> {
  try {
    return await ttfbOnce(route, cookie);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return ttfbOnce(route, cookie);
  }
}

async function ttfbOnce(
  route: string,
  cookie: string | undefined,
): Promise<{ status: number; ms: number }> {
  const started = performance.now();
  const response = await fetch(`${BASE}${route}`, {
    redirect: "manual",
    headers: cookie ? { cookie: `da_session=${cookie}` } : {},
  });
  const reader = response.body?.getReader();
  await reader?.read(); // first byte of the body
  const elapsed = performance.now() - started;
  await reader?.cancel().catch(() => undefined);
  return { status: response.status, ms: elapsed };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const minted: string[] = [];
const rows: { role: string; route: string; status: number; coldMs: number; warmMs: number }[] = [];
try {
  for (const { role, phone, routes } of ROLES) {
    const session = phone ? await mintSession(phone) : null;
    if (session) minted.push(session.id);
    for (const route of routes) {
      const cold = await ttfb(route, session?.token);
      const warm: number[] = [];
      for (let i = 0; i < RUNS; i++) warm.push((await ttfb(route, session?.token)).ms);
      const row = {
        role,
        route,
        status: cold.status,
        coldMs: Math.round(cold.ms),
        warmMs: Math.round(median(warm)),
      };
      rows.push(row);
      console.log(
        `${role.padEnd(10)} ${route.padEnd(46)} ${String(row.status).padEnd(4)} cold ${String(row.coldMs).padStart(6)}ms  warm ${String(row.warmMs).padStart(5)}ms`,
      );
    }
  }
} finally {
  if (minted.length > 0)
    await sql`update sessions set revoked_at = now() where id in ${sql(minted)}`;
  await sql.end();
}

const outIndex = process.argv.indexOf("--json");
if (outIndex >= 0)
  writeFileSync(
    process.argv[outIndex + 1] ?? "perf-routes.json",
    JSON.stringify({ base: BASE, runs: RUNS, rows }, null, 2),
  );
