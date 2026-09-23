#!/usr/bin/env node
// MIGRATION JOURNAL GUARD (go-live gate P3).
//
// The drizzle migrator does not apply "the migrations that have not run". It
// reads the newest `created_at` in drizzle.__drizzle_migrations and applies
// every journal entry whose `when` is LATER than that. So a new entry whose
// `when` is not strictly greater than the one before it is skipped — silently,
// on every database that already applied its predecessor, which is every
// database that matters. The migration exists, CI's fresh database applies it
// (nothing is recorded yet there), and production never sees it.
//
// That has bitten here before: the journal's `when` values are hand-spaced
// future dates, so the obvious `Date.now()` for a new entry lands BEFORE them.
// This makes the rule a gate instead of a memory. It also catches the two
// neighbouring mistakes — an `idx` out of sequence, and a journal entry and a
// .sql file that do not match up — since either one means the file on disk and
// the history the migrator believes in have drifted apart.
//
//   node packages/db/scripts/check-journal.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const folder = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
const files = new Set(
  readdirSync(folder)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -4)),
);

const problems = [];
let previous;
journal.entries.forEach((entry, position) => {
  if (entry.idx !== position) {
    problems.push(`${entry.tag}: idx ${String(entry.idx)} but it is entry #${String(position)}`);
  }
  if (previous !== undefined && !(entry.when > previous.when)) {
    problems.push(
      `${entry.tag}: when ${String(entry.when)} is not after ${previous.tag} ` +
        `(${String(previous.when)}) — the migrator will SKIP it on any database that ` +
        `applied ${previous.tag}. Use a value greater than ${String(previous.when)}.`,
    );
  }
  if (!files.has(entry.tag)) {
    problems.push(`${entry.tag}: in the journal, but migrations/${entry.tag}.sql does not exist`);
  }
  files.delete(entry.tag);
  previous = entry;
});
for (const orphan of files) {
  problems.push(`${orphan}.sql: on disk, but no journal entry — the migrator will never run it`);
}

if (problems.length > 0) {
  console.error(`migration journal FAILED — ${String(problems.length)} problem(s):\n`);
  for (const problem of problems) {
    console.error(`  ✗ ${problem}`);
  }
  console.error("");
  process.exit(1);
}
console.log(
  `migration journal OK — ${String(journal.entries.length)} entries, idx sequential, ` +
    "`when` strictly increasing, every entry has its file.",
);
