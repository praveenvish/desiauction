// Unit tests for the live-window freeze. Run: pnpm test:scripts
//
// The two questions themselves need a database and are proved against one in
// the PRR (2026-09-29); what is pinned here is everything that must hold
// WITHOUT one — above all that a failure can never print the owner's password.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LEAD_MINUTES,
  IMMINENT_QUERY,
  LIVE_QUERY,
  connectionEnv,
  minutesFrom,
  printableFailure,
} from "./check-live-window.mjs";

const SCRIPT = fileURLToPath(new URL("./check-live-window.mjs", import.meta.url));
const SECRET = "s3cr3t-Owner+Pass/word";
const URL_WITH_SECRET = `postgres://postgres:${encodeURIComponent(SECRET)}@127.0.0.1:1/desiauction`;

test("the connection travels as libpq variables, decoded", () => {
  const env = connectionEnv(
    "postgresql://desi%40owner:p%40ss%2Fword@db.internal:6432/desi%2Dauction?sslmode=require",
  );
  assert.equal(env.PGHOST, "db.internal");
  assert.equal(env.PGPORT, "6432");
  assert.equal(env.PGUSER, "desi@owner");
  assert.equal(env.PGPASSWORD, "p@ss/word");
  assert.equal(env.PGDATABASE, "desi-auction");
  assert.equal(env.PGSSLMODE, "require");
});

test("the default port is named, and a URL that is not postgres is refused", () => {
  assert.equal(connectionEnv("postgres://u:p@h/d").PGPORT, "5432");
  assert.throws(() => connectionEnv("https://u:p@h/d"));
});

test("a failure prints psql's words, without userinfo and without the password", () => {
  const error = Object.assign(new Error(`Command failed: psql ${URL_WITH_SECRET} -X -q`), {
    stderr: `psql: error: connection to "${URL_WITH_SECRET}" failed: refused (${SECRET})\n`,
  });
  const printed = printableFailure(error, SECRET);
  assert.ok(!printed.includes(SECRET), printed);
  assert.ok(!printed.includes(encodeURIComponent(SECRET)), printed);
  assert.ok(printed.includes("postgres://***@127.0.0.1:1/desiauction"), printed);
  assert.ok(printed.includes("refused"), printed);
  // The error's own message — the one that carries the command line — is never used.
  assert.ok(!printed.includes("Command failed"), printed);
});

test("a failure with nothing on stderr still says something, and nothing secret", () => {
  const printed = printableFailure(new Error(`Command failed: psql ${URL_WITH_SECRET}`), SECRET);
  assert.equal(printed, "psql exited without saying why");
});

test("minutes come from the environment only when they are sane", () => {
  assert.equal(minutesFrom("45", 120), 45);
  assert.equal(minutesFrom("0", 120), 0);
  for (const bad of [undefined, "", "soon", "-5", "1.5", "100000", "12; drop table auctions"]) {
    assert.equal(minutesFrom(bad, DEFAULT_LEAD_MINUTES), DEFAULT_LEAD_MINUTES, String(bad));
  }
});

test("the questions are the two the freeze is for", () => {
  assert.match(LIVE_QUERY, /status in \('live', 'paused'\)/);
  assert.match(IMMINENT_QUERY, /auction_starts_at <= now\(\) \+ make_interval\(mins => :lead\)/);
  assert.match(IMMINENT_QUERY, /auction_starts_at >= now\(\) - make_interval\(mins => :late\)/);
  // Only an auction that EXISTS and is waiting: one that has started is
  // question one's, one that is over is nobody's, and a date on a season with
  // no auction at all is a plan — it must not be able to freeze a deploy.
  assert.match(
    IMMINENT_QUERY,
    /join auctions a on a\.competition_id = c\.id and a\.status = 'scheduled'/,
  );
});

test("END TO END: an unreachable database refuses (exit 2) and the password is nowhere in the output", () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: URL_WITH_SECRET, DEPLOY_ANYWAY: "" },
  });
  // psql missing on this machine is also "could not tell": same exit, same rule.
  assert.equal(result.status, 2, result.stderr);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.ok(!output.includes(SECRET), output);
  assert.ok(!output.includes(encodeURIComponent(SECRET)), output);
  assert.match(output, /Could not determine whether an auction is live/);
});

test("END TO END: --warn reports and exits 0, still without the password", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--warn"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: URL_WITH_SECRET },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!`${result.stdout}\n${result.stderr}`.includes(SECRET));
});

test("END TO END: no DATABASE_URL is a refusal, not a pass", () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "" },
  });
  assert.equal(result.status, 2);
});
