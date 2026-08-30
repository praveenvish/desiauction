// The platform.admin grant seed (PX-1 02 G1: "⚙ seeded by script, no UI to
// issue it in beta").
//
// This script is the ONLY way a platform administrator comes into existence,
// and that is a structural fact rather than a convention:
//
//   `grants_tenant`'s WITH CHECK (migration 0004) admits `scope_type = 'org'`
//   and nothing else. Every connection the application makes uses the
//   non-BYPASSRLS app role, so no server action, no invite acceptance, no
//   settlement or finops grant issuer — and no compromised one — can insert a
//   platform-scoped grant AT ALL. The row is only insertable on the RLS-exempt
//   SYSTEM pool, which is reachable from here and from nowhere a request can
//   travel. PX-9 ships no UI that issues this grant, and could not honour one.
//
// Idempotent: re-running for the same person is a no-op, so it is safe in
// setup:local and safe to re-run against a live database.
//
// Run: pnpm --filter @desiauction/web seed:admin -- <phone>
//   e.g. pnpm --filter @desiauction/web seed:admin -- +919999000001
//        pnpm --filter @desiauction/web seed:admin -- --revoke +919999000001
import { auditLog, createDb, grants, newId, people } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "../src/server/admin/capabilities.js";

/**
 * WHICH PLATFORM GRANT.
 *
 * `platform:admin` sees the console. `platform:billing` answers a season's pass
 * request — a different act of trust, deliberately not a superset, so nobody
 * acquires the power to change what a customer is entitled to by being handed
 * the power to look at them. `platform:demo` answers the people who asked to be
 * SHOWN the product: names and mobile numbers belonging to strangers with no
 * account here, plus the power to publish, in the company's name, the hours
 * somebody will pick up the phone. None of the three is a superset of another.
 *
 * All are platform-scoped, and RLS makes all equally uninsertable by the
 * application role: this script is the only route.
 *
 *   pnpm --filter @desiauction/web seed:admin -- <phone>
 *   pnpm --filter @desiauction/web seed:admin -- --set platform:billing <phone>
 *   pnpm --filter @desiauction/web seed:admin -- --set platform:demo <phone>
 */
const SETS = ["platform:admin", "platform:billing", "platform:demo"] as const;
const setFlagAt = process.argv.indexOf("--set");
const requestedSet = setFlagAt === -1 ? "platform:admin" : process.argv[setFlagAt + 1];
if (!(SETS as readonly string[]).includes(requestedSet ?? "")) {
  throw new Error(`--set must be one of ${SETS.join(", ")}`);
}
const SET = requestedSet as (typeof SETS)[number];

// The system pool: RLS-exempt, so it can write the one row RLS forbids the app
// to write. Falls back to DATABASE_URL, which locally is the same superuser.
const URL_ = process.env["SYSTEM_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (URL_ === undefined) {
  throw new Error("DATABASE_URL is required (run via pnpm --filter @desiauction/web seed:admin)");
}
const handle = createDb(URL_);
const db = handle.db;

function normalizePhone(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith("+") ? trimmed : `+91${trimmed.replace(/^0+/, "")}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const revoke = args.includes("--revoke");
  // `--set <value>` consumes its own argument, so the value must not be
  // mistaken for the phone number. Guarded on the flag being PRESENT: an
  // `indexOf` of -1 plus one is 0, which excluded the first argument — the
  // phone — on every invocation that did not pass --set at all.
  const setFlagIndex = args.indexOf("--set");
  const phoneArg = args.find(
    (arg, index) => !arg.startsWith("--") && (setFlagIndex === -1 || index !== setFlagIndex + 1),
  );
  if (phoneArg === undefined) {
    throw new Error(
      "Usage: pnpm --filter @desiauction/web seed:admin -- [--revoke] [--set <set>] <phone>\n" +
        "  e.g. pnpm --filter @desiauction/web seed:admin -- +919999000001\n" +
        "       pnpm --filter @desiauction/web seed:admin -- --set platform:billing +919999000001",
    );
  }
  const phone = normalizePhone(phoneArg);

  const [person] = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.phone, phone))
    .limit(1);
  if (person === undefined) {
    throw new Error(
      `No person with phone ${phone}. They must sign in once before they can be made a platform admin.`,
    );
  }

  const [existing] = await db
    .select({ id: grants.id })
    .from(grants)
    .where(
      and(
        eq(grants.personId, person.id),
        eq(grants.scopeType, PLATFORM_SCOPE_TYPE),
        eq(grants.scopeId, PLATFORM_SCOPE_ID),
        eq(grants.capabilitySet, SET),
        isNull(grants.revokedAt),
      ),
    )
    .limit(1);

  if (revoke) {
    if (existing === undefined) {
      console.log(`${person.name ?? phone} is not a platform admin. Nothing to revoke.`);
      return;
    }
    await db.transaction(async (tx) => {
      await tx.update(grants).set({ revokedAt: new Date() }).where(eq(grants.id, existing.id));
      await tx.insert(auditLog).values({
        id: newId(),
        // Self-granted by construction: this runs out-of-band, with no session.
        // The audit row says so rather than inventing an actor.
        actor: person.id,
        action: "grant.revoked",
        scopeType: PLATFORM_SCOPE_TYPE,
        scopeId: PLATFORM_SCOPE_ID,
        subject: person.id,
        meta: { capabilitySet: SET, domain: "platform", via: "seed:admin" },
      });
    });
    console.log(`Revoked platform.admin from ${person.name ?? phone}.`);
    return;
  }

  if (existing !== undefined) {
    console.log(`${person.name ?? phone} is already a platform admin. Nothing to do.`);
    return;
  }

  const grantId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(grants).values({
      id: grantId,
      personId: person.id,
      scopeType: PLATFORM_SCOPE_TYPE,
      scopeId: PLATFORM_SCOPE_ID,
      capabilitySet: SET,
      grantedBy: person.id,
    });
    await tx.insert(auditLog).values({
      id: newId(),
      actor: person.id,
      action: "grant.issued",
      scopeType: PLATFORM_SCOPE_TYPE,
      scopeId: PLATFORM_SCOPE_ID,
      subject: person.id,
      meta: { capabilitySet: SET, domain: "platform", via: "seed:admin" },
    });
  });
  console.log(`\n  ${person.name ?? phone} is now a platform admin.`);
  console.log(`  Sign in as ${phone} → avatar menu → Platform admin (or go to /admin).\n`);
}

main()
  .then(async () => {
    await handle.sql.end();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await handle.sql.end();
    process.exitCode = 1;
  });
