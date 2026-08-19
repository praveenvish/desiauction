#!/usr/bin/env node
// SNAPSHOT CHAIN GUARD (audit 2026-08-18, P2-9).
//
// drizzle-kit generates a migration by diffing schema.ts against the LAST
// SNAPSHOT in migrations/meta. Migrations 0019-0026 were hand-authored, so no
// snapshots were written for them: the chain stops at 0018 while the journal
// runs to 0026. Anyone running `db:generate` today gets a diff against a schema
// eight migrations stale - which silently emits DDL that already exists, or
// drops things it wrongly believes were removed.
//
// This does not repair the chain (rebuilding eight snapshots by hand is how you
// author a wrong migration). It STOPS, loudly, with the two honest options.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const meta = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "meta");
const journal = JSON.parse(readFileSync(join(meta, "_journal.json"), "utf8"));
const snapshots = readdirSync(meta).filter((f) => /^\d+_snapshot\.json$/.test(f));

const latestJournal = journal.entries.at(-1);
if (latestJournal === undefined) {
  process.exit(0);
}
const highestSnapshot = snapshots
  .map((f) => Number(f.slice(0, 4)))
  .reduce((a, b) => Math.max(a, b), -1);
const journalIdx = latestJournal.idx;

if (highestSnapshot >= journalIdx) {
  console.log(`snapshot chain OK - ${String(journalIdx)} is the head and it has a snapshot.`);
  process.exit(0);
}

console.error(
  [
    "",
    "REFUSING TO GENERATE - the drizzle snapshot chain is behind the journal.",
    "",
    `  journal head : ${String(journalIdx).padStart(4, "0")} ${latestJournal.tag}`,
    `  last snapshot: ${String(highestSnapshot).padStart(4, "0")}`,
    "",
    "drizzle-kit diffs schema.ts against the LAST SNAPSHOT, so generating now",
    `would produce a migration against a schema ${String(journalIdx - highestSnapshot)} migration(s) stale -`,
    "emitting DDL that already exists, or dropping objects it believes were removed.",
    "",
    "Two honest options:",
    "  1. Hand-author the migration (what 0019-0026 did) and add it to the",
    "     journal yourself, bumping `when` past the existing future-dated",
    "     entries or drizzle will silently skip it.",
    "  2. Rebuild the snapshot chain deliberately, against a database with every",
    "     migration applied, and review the result before trusting it.",
    "",
  ].join("\n"),
);
process.exit(1);
