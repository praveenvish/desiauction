// DA-01 BACKFILL. Auctions conducted before the sell path stamped
// `registrations.team_id` left their squads unreachable to the whole product:
// Teams, the roster export and the public page all key on that column, so a
// completed auction read as "no buys yet" for ever.
//
// This repairs history from the lots table, which has always held the truth
// (`sold_to_paddle_id` → paddle → team). It is idempotent: re-running changes
// nothing once the rows agree, so it is safe to run again after a partial run.
//
// Dry run is the DEFAULT. Nothing is written unless you pass --apply.
//
//   pnpm --filter @desiauction/web backfill:squads            # report only
//   pnpm --filter @desiauction/web backfill:squads --apply    # write
import { createDb, lots, paddles, registrations, type Db } from "@desiauction/db";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

const DATABASE_URL = process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) {
  throw new Error("DATABASE_URL is required (run via pnpm backfill:squads)");
}
const apply = process.argv.includes("--apply");
const handle = createDb(DATABASE_URL);

interface Row {
  registrationId: string;
  playerName: string | null;
  lotNumber: string;
  teamId: string;
  teamName: string | null;
  currentTeamId: string | null;
}

/**
 * Every sold lot whose registration does NOT already point at the winning
 * team — the exact set the old writer skipped, plus anything that has drifted.
 */
async function divergentRows(db: Db): Promise<Row[]> {
  return db
    .select({
      registrationId: registrations.id,
      playerName: sql<string | null>`people.name`,
      lotNumber: lots.lotNumber,
      teamId: paddles.teamId,
      teamName: sql<string | null>`teams.name`,
      currentTeamId: registrations.teamId,
    })
    .from(lots)
    .innerJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
    .innerJoin(registrations, eq(registrations.id, lots.registrationId))
    // LEFT, not INNER: a sold lot whose person or team row has gone missing is
    // exactly the corruption this script exists to surface. Inner joins made it
    // invisible — the run reported "nothing to repair" while 840 divergent rows
    // sat in the database, because it could not print their names.
    .leftJoin(sql`teams`, sql`teams.id = ${paddles.teamId}`)
    .leftJoin(sql`people`, sql`people.id = ${registrations.personId}`)
    .where(
      and(
        eq(lots.status, "sold"),
        or(isNull(registrations.teamId), ne(registrations.teamId, paddles.teamId)),
      ),
    )
    .orderBy(lots.lotNumber);
}

async function main(): Promise<void> {
  const rows = await divergentRows(handle.db);
  if (rows.length === 0) {
    console.log("Nothing to repair — every sold lot already points at its team.");
    return;
  }

  console.log(`${String(rows.length)} sold lot(s) with a missing or wrong squad placement:\n`);
  for (const row of rows) {
    const from = row.currentTeamId === null ? "(unassigned)" : row.currentTeamId;
    console.log(
      `  ${row.lotNumber}  ${(row.playerName ?? "(no person row)").padEnd(24)}  ${from} → ${row.teamName ?? row.teamId}`,
    );
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to repair these rows.`);
    return;
  }

  let written = 0;
  await handle.db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .update(registrations)
        .set({ teamId: row.teamId })
        .where(eq(registrations.id, row.registrationId));
      written += 1;
    }
  });
  console.log(`\nRepaired ${String(written)} registration(s).`);

  const left = await divergentRows(handle.db);
  if (left.length > 0) {
    throw new Error(`${String(left.length)} row(s) still diverge after the write`);
  }
  console.log("Verified: zero divergence remains.");
}

main()
  .then(async () => {
    await handle.sql.end();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await handle.sql.end();
    process.exit(1);
  });
