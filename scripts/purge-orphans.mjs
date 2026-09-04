#!/usr/bin/env node
// THE RESIDUE THAT MAKES EVERY LATER FAILURE LOOK LIKE A PRODUCT BUG.
//
// Audit PA-1 §7 found the auction spine carries no referential integrity: of
// ~133 `*_id` columns, 14 have a foreign key and the rest are convention. On
// the development database that had already produced, silently:
//
//     220 of 332 lots referencing a registration that does not exist
//     214 sold lots pointing at a paddle that does not exist
//     100 competitions with no organization
//
// Almost certainly test-teardown residue rather than a runtime writer bug (the
// engine-integration teardown could not delete `people` for months — PA-1R
// Phase 0.1). But the effect is the same either way: read models render empty
// instead of erroring, and somebody spends an afternoon debugging the platform
// when the data was simply broken.
//
// This purges it, in foreign-key-safe order, so that PA-1R Phase 3.1 can add
// the real constraints — an `ALTER TABLE … ADD FOREIGN KEY` fails outright
// while a single orphan remains, so this must run first and come back clean.
//
//   node scripts/purge-orphans.mjs            # report only, changes nothing
//   node scripts/purge-orphans.mjs --apply    # delete the orphans
//
// Safe to run repeatedly; a clean database reports zeroes and exits 0. It
// deletes ONLY rows whose parent is missing — never a reachable row — so it
// cannot remove live data, but it is still a delete: take a dump first if the
// database is one you care about.

import { execFileSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const url = process.env["DATABASE_URL"];
if (url === undefined) {
  console.error("purge-orphans needs DATABASE_URL");
  process.exit(2);
}

/**
 * Child → parent edges.
 *
 * Order does NOT save us here, which is worth stating because it looks as
 * though it should. Deleting an orphaned `competitions` row orphans every
 * auction, team and registration beneath it — rows that an earlier edge in the
 * same pass has already inspected and found healthy. Any single ordering leaves
 * one of those two directions unswept.
 *
 * So the sweep runs to a FIXED POINT instead: repeat every edge until a whole
 * pass deletes nothing. Cheap (these are indexed anti-joins), order-independent,
 * and correct however deep the cascade goes.
 */
const EDGES = [
  ["bids", "lot_id", "lots", "id"],
  ["bids", "paddle_id", "paddles", "id"],
  ["bids", "auction_id", "auctions", "id"],
  ["lots", "registration_id", "registrations", "id"],
  ["lots", "auction_id", "auctions", "id"],
  ["auction_events", "auction_id", "auctions", "id"],
  ["paddle_grants", "auction_id", "auctions", "id"],
  ["auction_owner_invites", "auction_id", "auctions", "id"],
  ["paddles", "auction_id", "auctions", "id"],
  ["paddles", "team_id", "teams", "id"],
  ["auctions", "competition_id", "competitions", "id"],
  ["registrations", "competition_id", "competitions", "id"],
  ["teams", "competition_id", "competitions", "id"],
  ["fixtures", "competition_id", "competitions", "id"],
  ["competitions", "org_id", "organizations", "id"],
  ["tournaments", "org_id", "organizations", "id"],
  ["org_members", "org_id", "organizations", "id"],
];

/**
 * Nullable references: the row is legitimate, the pointer is not.
 *
 * `lots.sold_to_paddle_id` is the case that matters — 214 sold lots pointed at
 * a paddle that had been deleted. Deleting the LOT would destroy the record of
 * a sale; the honest repair is to null the dangling pointer and let the sale
 * stand. A CHECK constraint keeps sold-state coherent, so these are cleared
 * only where the lot is not `sold`.
 */
const NULLABLE = [["lots", "sold_to_paddle_id", "paddles", "id", "status <> 'sold'"]];

/**
 * One psql round trip per statement, matching `scripts/backup-database.mjs`:
 * root scripts shell out to the postgres client rather than carrying a driver
 * dependency, so this runs from a bare checkout with no install.
 */
function query(statement) {
  return execFileSync(
    "psql",
    [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", statement],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  ).trim();
}

const orphanPredicate = (child, column, parent, key, guard) =>
  `from ${child} c where c.${column} is not null` +
  ` and not exists (select 1 from ${parent} p where p.${key} = c.${column})` +
  (guard === undefined ? "" : ` and ${guard}`);

let totalOrphans = 0;
let totalUnfixable = 0;

{
  console.log(apply ? "purging orphans\n" : "orphan report (dry run — pass --apply to delete)\n");

  const perEdge = new Map();
  const MAX_PASSES = 12;
  let pass = 0;
  for (;;) {
    pass += 1;
    let deletedThisPass = 0;
    for (const [child, column, parent, key] of EDGES) {
      const where = orphanPredicate(child, column, parent, key);
      const count = Number(query(`select count(*) ${where}`));
      if (count === 0) continue;
      perEdge.set(
        `${child}.${column} → ${parent}`,
        (perEdge.get(`${child}.${column} → ${parent}`) ?? 0) + count,
      );
      totalOrphans += count;
      deletedThisPass += count;
      if (apply) query(`delete ${where}`);
    }
    // A dry run deletes nothing, so a second pass would report the same rows
    // for ever. One pass is all a report can honestly do.
    if (!apply || deletedThisPass === 0 || pass >= MAX_PASSES) break;
  }
  for (const [label, count] of perEdge) console.log(`  ${label}: ${String(count)}`);
  if (apply && pass > 1) {
    console.log(
      `  (settled after ${String(pass)} passes — cascades were uncovered by earlier deletes)`,
    );
  }

  for (const [child, column, parent, key, guard] of NULLABLE) {
    const count = Number(query(`select count(*) ${orphanPredicate(child, column, parent, key)}`));
    if (count === 0) continue;
    const clearableWhere = orphanPredicate(child, column, parent, key, guard);
    const clearable = Number(query(`select count(*) ${clearableWhere}`));
    totalOrphans += clearable;
    totalUnfixable += count - clearable;
    console.log(
      `  ${child}.${column} → ${parent}: ${String(count)} dangling ` +
        `(${String(clearable)} clearable, ${String(count - clearable)} on sold rows)`,
    );
    if (apply) {
      query(
        `update ${child} c set ${column} = null ${clearableWhere.replace(`from ${child} c `, "")}`,
      );
    }
  }

  if (totalOrphans === 0 && totalUnfixable === 0) {
    console.log("  none — referential integrity holds; Phase 3.1 can add the constraints");
  } else {
    console.log(
      `\n${apply ? "purged" : "found"} ${String(totalOrphans)} orphaned rows` +
        (totalUnfixable > 0 ? `, ${String(totalUnfixable)} needing a human` : ""),
    );
    if (!apply) {
      console.log(
        "A dry run sees one pass only. Deleting an orphaned parent exposes more\n" +
          "beneath it, so the real total is this or higher — --apply sweeps to a\n" +
          "fixed point and reports what it actually removed.",
      );
    }
  }

  if (totalUnfixable > 0) {
    console.log(
      "\nRows on a SOLD lot cannot be repaired mechanically: the paddle that\n" +
        "bought the player is gone, so the buyer is unrecoverable from this table\n" +
        "alone. Recover the buyer from `auction_events` (the sale is in the log)\n" +
        "before Phase 3.1 adds the constraint, or delete the dead auction outright\n" +
        "if it is test residue.",
    );
  }
}

// Non-zero only when a human is genuinely needed, so a scheduled dry run can
// gate on it without going red for residue it is about to clean itself.
process.exit(totalUnfixable > 0 ? 1 : 0);
