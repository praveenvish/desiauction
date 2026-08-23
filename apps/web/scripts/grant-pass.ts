// ANSWERING A SEASON'S PASS REQUEST (0028).
//
// This script is how a pass request is answered, and that is a structural
// choice rather than a shortcut:
//
//   `server/admin/capabilities.ts` says "Administration is an observation
//   surface, so the vocabulary stays one word wide — there is no write to
//   tier." The console's read-only guarantee is proved at runtime (PX-9) and
//   sold to customers on the releases page. Changing what a customer's pass
//   covers is a PLATFORM-level commercial act, and every platform-level act in
//   this repository is performed the same way: out-of-band, on the RLS-exempt
//   system pool, by somebody who can reach it — exactly like `seed:admin`,
//   which is the only way a platform administrator comes into existence.
//
//   Putting it in the console instead would need a SECOND platform capability,
//   distinct from `platform:admin` (seeing everything and changing a commercial
//   term are different acts of trust), plus a copy change everywhere the
//   product currently promises administration only observes. That is a
//   deliberate governance decision, not a refactor.
//
// The logic lives in `src/server/competition/pass-grant.ts` so it is tested
// against a real database, and so a future UI has something to call.
//
// Run:
//   pnpm --filter @desiauction/web pass:grant -- --season <slug>
//   pnpm --filter @desiauction/web pass:grant -- --season <slug> --tier association
//   pnpm --filter @desiauction/web pass:grant -- --season <slug> --decline --note "..."
//   pnpm --filter @desiauction/web pass:grant -- --list
import { createDb, passUpgradeRequests, competitions, people } from "@desiauction/db";
import { asc, eq, isNull } from "drizzle-orm";

import { grantSummary, resolvePassRequest } from "../src/server/competition/pass-grant.js";

const URL_ = process.env["SYSTEM_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (URL_ === undefined) {
  throw new Error("DATABASE_URL is required (run via pnpm --filter @desiauction/web pass:grant)");
}
const handle = createDb(URL_);
const db = handle.db;

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};
const has = (name: string): boolean => argv.includes(`--${name}`);

async function list(): Promise<void> {
  const rows = await db
    .select({
      slug: competitions.slug,
      name: competitions.name,
      fromTier: passUpgradeRequests.fromTier,
      requestedTier: passUpgradeRequests.requestedTier,
      note: passUpgradeRequests.note,
      at: passUpgradeRequests.createdAt,
      by: people.name,
      phone: people.phone,
    })
    .from(passUpgradeRequests)
    .innerJoin(competitions, eq(competitions.id, passUpgradeRequests.competitionId))
    .leftJoin(people, eq(people.id, passUpgradeRequests.requestedBy))
    .where(isNull(passUpgradeRequests.resolvedAt))
    .orderBy(asc(passUpgradeRequests.createdAt));
  if (rows.length === 0) {
    console.log("No open pass requests.");
    return;
  }
  console.log(`${String(rows.length)} open request(s):\n`);
  for (const row of rows) {
    console.log(`  ${row.slug}  ${row.fromTier} → ${row.requestedTier}`);
    console.log(`    ${row.name}`);
    console.log(
      `    asked by ${row.by ?? row.phone ?? "unknown"} on ${row.at.toISOString().slice(0, 10)}`,
    );
    if (row.note !== null && row.note !== "") {
      console.log(`    "${row.note}"`);
    }
    console.log("");
  }
}

async function main(): Promise<void> {
  if (has("list") || argv.length === 0) {
    await list();
    return;
  }
  const slug = flag("season");
  if (slug === undefined) {
    console.error("--season <slug> is required (or --list to see what is open)");
    process.exitCode = 1;
    return;
  }
  // The actor. Platform acts are performed by a person, and the audit row says
  // which one; there is no "system" actor in this product and inventing one
  // would put an unanswerable name on a commercial decision.
  const actorPhone = flag("as") ?? process.env["PASS_GRANT_ACTOR"];
  if (actorPhone === undefined) {
    console.error(
      "--as <phone> is required (or set PASS_GRANT_ACTOR): the audit row records who answered",
    );
    process.exitCode = 1;
    return;
  }
  const normalized = actorPhone.startsWith("+") ? actorPhone : `+91${actorPhone}`;
  const [actor] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.phone, normalized))
    .limit(1);
  if (actor === undefined) {
    console.error(`No person with phone ${normalized}.`);
    process.exitCode = 1;
    return;
  }

  const result = await resolvePassRequest(db, {
    slug,
    outcome: has("decline") ? "declined" : "granted",
    ...(flag("tier") !== undefined ? { tier: flag("tier") as string } : {}),
    actorId: actor.id,
    ...(flag("note") !== undefined ? { note: flag("note") as string } : {}),
  });
  if (!result.ok) {
    console.error(`✗ ${result.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${grantSummary(result)}`);
}

await main();
await handle.sql.end();
