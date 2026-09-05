#!/usr/bin/env node
// THE LIVE-WINDOW FREEZE (Canon C-22).
//
// "No production deploy, migration, or risky maintenance while any auction is
// LIVE; the platform knows its own live windows and enforces the freeze."
//
// It knew its own live windows and enforced nothing (audit PA-1 §19): both
// deploy workflows went straight to `flyctl deploy`, and a deploy restarts the
// engine. The engine is the single writer and holds every lot timer in memory,
// so a restart mid-auction stops the countdown on every screen in the room —
// and until PA-1R Phase 1.4 it did not resume until somebody touched the
// auction, which during a lot nobody does.
//
// This is the enforcement. One query, no dependencies beyond psql:
//
//   node scripts/check-live-window.mjs          # refuse if any auction is live
//   node scripts/check-live-window.mjs --warn   # report, exit 0 (staging)
//
// Env:
//   DATABASE_URL   the environment being deployed to.
//   DEPLOY_ANYWAY  set to "1" to override — an operator MUST type this, and it
//                  is echoed loudly, because there are real reasons to deploy
//                  during a live window and "the engine is already broken" is
//                  the main one.
//
// Exit 0 = clear to deploy. Exit 1 = a live window. Exit 2 = could not tell,
// which is also a refusal: an unreachable database is not evidence of safety.

import { execFileSync } from "node:child_process";

const url = process.env["DATABASE_URL"];
const warnOnly = process.argv.includes("--warn");
const override = process.env["DEPLOY_ANYWAY"] === "1";

if (url === undefined || url === "") {
  console.error("check-live-window needs DATABASE_URL");
  process.exit(warnOnly ? 0 : 2);
}

/**
 * `paused` counts as live, and that is the point rather than an edge case.
 *
 * A paused auction is a room of people waiting — a dispute being settled, a
 * phone call — with a lot still on the block and its remaining time banked in
 * `held_remaining_ms`. Restarting into that is worse than restarting into an
 * active lot, because nobody is watching a clock that would show them the
 * problem.
 */
const QUERY = `
  select a.id, a.name, a.status, c.name as competition
    from auctions a
    join competitions c on c.id = a.competition_id
   where a.status in ('live', 'paused')
   order by a.name
`;

let rows;
try {
  const out = execFileSync(
    "psql",
    [url, "-X", "-q", "-t", "-A", "-F", "", "-v", "ON_ERROR_STOP=1", "-c", QUERY],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  rows = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.split(""));
} catch (error) {
  // Could not ask. That is not a "no".
  console.error(
    "\nCould not determine whether an auction is live:\n" +
      `  ${error instanceof Error ? error.message : String(error)}\n\n` +
      "Refusing rather than assuming. An unreachable database is not evidence\n" +
      "that the room is empty.\n",
  );
  process.exit(warnOnly ? 0 : 2);
}

if (rows.length === 0) {
  console.log("live-window check: no auction is live or paused — clear to deploy.");
  process.exit(0);
}

console.error(`\nLIVE WINDOW — ${String(rows.length)} auction(s) in progress:\n`);
for (const [, name, status, competition] of rows) {
  console.error(`  · ${competition ?? "?"} — ${name ?? "?"} (${status ?? "?"})`);
}
console.error(
  "\nDeploying restarts the engine. It is the single writer and holds every lot\n" +
    "timer, so a restart mid-auction stops the countdown in the room. C-22 says\n" +
    "not during a live window.\n\n" +
    "Wait for the auction to complete, or — if the engine is ALREADY broken and\n" +
    "the deploy is the repair — re-run with DEPLOY_ANYWAY=1.\n",
);

if (override) {
  console.error("DEPLOY_ANYWAY=1 — proceeding into a live window on the operator's authority.\n");
  process.exit(0);
}
process.exit(warnOnly ? 0 : 1);
