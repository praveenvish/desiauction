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
// This is the enforcement. Two questions, no dependencies beyond psql:
//
//   1. Is an auction live or paused RIGHT NOW?
//   2. Is one ABOUT to be? (PRR 2026-09-29.) The first question alone let a
//      deploy dispatched at 19:50 through for an auction announced for 20:00:
//      nothing was live when it asked, the organizer pressed Start while the
//      images were pulling, and the engine was swapped under the first lot.
//      Seasons carry the announced start (`competitions.auction_starts_at`,
//      0095), so the freeze now opens LEAD minutes before it and stays open
//      LATE minutes after it for a night that is running behind — for as long
//      as the auction has not started. Once it starts, question 1 holds it.
//
//   node scripts/check-live-window.mjs          # refuse inside a live window
//   node scripts/check-live-window.mjs --warn   # report, exit 0 (staging)
//
// Env:
//   DATABASE_URL   the environment being deployed to.
//   DEPLOY_ANYWAY  set to "1" to override — an operator MUST type this, and it
//                  is echoed loudly, because there are real reasons to deploy
//                  during a live window and "the engine is already broken" is
//                  the main one.
//   LIVE_WINDOW_LEAD_MINUTES  how long before an announced start the freeze
//                  opens (default 120).
//   LIVE_WINDOW_LATE_MINUTES  how long after it the freeze holds while the
//                  auction still has not started (default 180).
//
// Exit 0 = clear to deploy. Exit 1 = a live window. Exit 2 = could not tell,
// which is also a refusal: an unreachable database is not evidence of safety.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEFAULT_LEAD_MINUTES = 120;
export const DEFAULT_LATE_MINUTES = 180;

/**
 * `paused` counts as live, and that is the point rather than an edge case.
 *
 * A paused auction is a room of people waiting — a dispute being settled, a
 * phone call — with a lot still on the block and its remaining time banked in
 * `held_remaining_ms`. Restarting into that is worse than restarting into an
 * active lot, because nobody is watching a clock that would show them the
 * problem.
 */
export const LIVE_QUERY = `
  select a.name, a.status, c.name as competition
    from auctions a
    join competitions c on c.id = a.competition_id
   where a.status in ('live', 'paused')
   order by a.name
`;

/**
 * A season whose auction is announced inside the window and has not started.
 *
 * "Has not started" is "no auction row past `scheduled`": a season with no
 * auction row yet counts (creating one takes a minute, and the organizer is
 * about to), a completed or abandoned one does not (the night is over, however
 * recently). The minutes arrive as psql variables, never spliced into the text.
 */
export const IMMINENT_QUERY = `
  select c.name,
         to_char(c.auction_starts_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') as starts_ist
    from competitions c
   where c.auction_starts_at is not null
     and c.auction_starts_at >= now() - make_interval(mins => :late)
     and c.auction_starts_at <= now() + make_interval(mins => :lead)
     and not exists (
           select 1 from auctions a
            where a.competition_id = c.id
              and a.status <> 'scheduled'
         )
   order by c.auction_starts_at
`;

/**
 * The connection, as libpq environment variables.
 *
 * THE URL USED TO BE AN ARGUMENT TO psql (PRR 2026-09-29). Node puts the whole
 * command line into the message of the error it throws when a child exits
 * non-zero — "Command failed: psql postgres://owner:PASSWORD@host/db ..." — and
 * this script printed that message. So any failure other than the one it
 * recognised wrote the database OWNER's password into the deploy log, which is
 * kept by GitHub and shipped to the log store. It is also visible in the
 * process list for as long as psql runs.
 *
 * In the environment it is in neither place. Every part is decoded, because a
 * URL carries them percent-encoded and libpq reads these variables literally.
 */
export function connectionEnv(databaseUrl) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL is not a postgres URL");
  }
  const env = {
    PGHOST: decodeURIComponent(url.hostname),
    PGPORT: url.port === "" ? "5432" : url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    PGCONNECT_TIMEOUT: "10",
    PGAPPNAME: "check-live-window",
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode !== null && sslmode !== "") {
    env.PGSSLMODE = sslmode;
  }
  return env;
}

/**
 * What may be printed about a failure: psql's own words, and never ours.
 *
 * psql's stderr names the host and the reason and does not echo credentials,
 * but a connection URL can still reach it through a server message, so anything
 * URL-shaped loses its userinfo and the password is removed wherever it occurs,
 * in both the form it is typed and the form a URL carries it.
 */
export function printableFailure(error, password = "") {
  const stderr = typeof error?.stderr === "string" ? error.stderr : "";
  const text = stderr.trim() !== "" ? stderr.trim() : "psql exited without saying why";
  let printable = text.replace(/\b(postgres(?:ql)?:\/\/)[^@\s/]*@/gi, "$1***@");
  if (password !== "") {
    for (const form of new Set([password, encodeURIComponent(password)])) {
      printable = printable.split(form).join("***");
    }
  }
  return printable;
}

/** Minutes from the environment; anything that is not a sane number is the default. */
export function minutesFrom(raw, fallback) {
  if (typeof raw !== "string" || !/^\d{1,4}$/.test(raw)) {
    return fallback;
  }
  const value = Number(raw);
  return value <= 24 * 60 ? value : fallback;
}

const FIELD = "\u001f";

function ask(env, query, variables = {}) {
  const args = ["-X", "-q", "-t", "-A", "-F", FIELD, "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(variables)) {
    args.push("-v", `${name}=${String(value)}`);
  }
  // Over stdin: `-c` does not interpolate psql variables, a script does.
  const out = execFileSync("psql", args, {
    encoding: "utf8",
    input: query,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env, DATABASE_URL: "" },
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.split(FIELD));
}

function main() {
  const url = process.env["DATABASE_URL"];
  const warnOnly = process.argv.includes("--warn");
  const override = process.env["DEPLOY_ANYWAY"] === "1";

  if (url === undefined || url === "") {
    console.error("check-live-window needs DATABASE_URL");
    process.exit(warnOnly ? 0 : 2);
  }

  let env;
  try {
    env = connectionEnv(url);
  } catch {
    // Not the URL itself, and not the parser's message, which quotes it.
    console.error("check-live-window: DATABASE_URL could not be read as a postgres URL");
    process.exit(warnOnly ? 0 : 2);
  }

  const couldNotTell = (error) => {
    // Could not ask. That is not a "no".
    console.error(
      "\nCould not determine whether an auction is live:\n" +
        `  ${printableFailure(error, env.PGPASSWORD)}\n\n` +
        "Refusing rather than assuming. An unreachable database is not evidence\n" +
        "that the room is empty.\n",
    );
    process.exit(warnOnly ? 0 : 2);
  };

  let live;
  try {
    live = ask(env, LIVE_QUERY);
  } catch (error) {
    // A FRESH DATABASE IS THE ONE ERROR THAT IS AN ANSWER. Before the first
    // migration there is no `auctions` table, so no auction can be live — and the
    // freeze now runs on the host BEFORE migrate (deploy-host.yml), so the first
    // deploy onto an empty database would otherwise be refused forever, and
    // `DEPLOY_ANYWAY` cannot help: an unanswerable question is never overridden.
    // Only this exact error qualifies; anything else is still "could not tell".
    const stderr = String(error?.stderr ?? "");
    if (/relation "(?:public\.)?auctions" does not exist/.test(stderr)) {
      console.log(
        "live-window check: no auctions table yet (unmigrated database) — clear to deploy.",
      );
      process.exit(0);
    }
    couldNotTell(error);
  }

  const lead = minutesFrom(process.env["LIVE_WINDOW_LEAD_MINUTES"], DEFAULT_LEAD_MINUTES);
  const late = minutesFrom(process.env["LIVE_WINDOW_LATE_MINUTES"], DEFAULT_LATE_MINUTES);
  let imminent = [];
  try {
    imminent = ask(env, IMMINENT_QUERY, { lead, late });
  } catch (error) {
    // The same shape of exception as above, one migration later: a database
    // that predates 0095 has no announced starts to ask about. Anything else
    // is still "could not tell".
    const stderr = String(error?.stderr ?? "");
    if (!/column c\.auction_starts_at does not exist/.test(stderr)) {
      couldNotTell(error);
    }
  }

  if (live.length === 0 && imminent.length === 0) {
    console.log(
      "live-window check: no auction is live or paused, and none is announced to start " +
        `within ${String(lead)} minutes — clear to deploy.`,
    );
    process.exit(0);
  }

  if (live.length > 0) {
    console.error(`\nLIVE WINDOW — ${String(live.length)} auction(s) in progress:\n`);
    for (const [name, status, competition] of live) {
      console.error(`  · ${competition ?? "?"} — ${name ?? "?"} (${status ?? "?"})`);
    }
  }
  if (imminent.length > 0) {
    console.error(`\nLIVE WINDOW — ${String(imminent.length)} auction(s) about to start:\n`);
    for (const [competition, startsIst] of imminent) {
      console.error(`  · ${competition ?? "?"} — announced for ${startsIst ?? "?"} IST`);
    }
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
}

// Imported by its tests; run by the deploy.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
