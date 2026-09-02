// PERMANENT PLATFORM-ADMINISTRATION FOUNDATION REGRESSION SUITE (PX-9).
//
// Encodes the contract PX-9 is built on, against LIVE Postgres:
//
//   1 · the FOURTH capability partition, symmetrical in all twelve directions —
//       `org:owner`, `settlement:controller` and `finops:controller` confer
//       ZERO platform power, and `platform:admin` confers ZERO org, money or
//       finance power;
//   2 · the SINGLETON scope — a `platform:admin` grant written against an ORG
//       scope confers nothing, so a real org grant can never be mistaken for
//       platform authority;
//   3 · the RLS lock — the application role CANNOT insert a platform-scoped
//       grant at all, so the surface's own gate is not the only thing standing
//       between a tenant and the platform console;
//   4 · the READ-ONLY guarantee, proved at RUNTIME rather than asserted: every
//       admin projection is driven through a db handle that throws on any
//       mutation, and the whole suite must still go green.
import { capabilitiesOf, hasCapability } from "@desiauction/core";
import {
  auctions,
  auditLog,
  createDb,
  finopsProfiles,
  grants as grantsTable,
  newId,
  orgMembers,
  people,
  type DbHandle,
} from "@desiauction/db";
import { hasFinopsCapability, finopsCapabilitiesOf } from "@desiauction/financial-operations";
import { runnerHealthSnapshot } from "@desiauction/financial-operations/server";
import { hasSettlementCapability, settlementCapabilitiesOf } from "@desiauction/settlement";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { grantsFor } from "../orgs/authz";
import { webFinopsDeps } from "../financial-operations/deps";
import { recordAdminAccess } from "./access-log";
import {
  ADMIN_ACCESS_ACTION,
  PLATFORM_SCOPE_ID,
  PLATFORM_SCOPE_TYPE,
  hasPlatformCapability,
  isPlatformCapabilitySet,
  platformCapabilitiesOf,
} from "./capabilities";
import {
  attentionQueue,
  auditExplorer,
  organizationDetail,
  organizationDirectory,
  organizationExists,
  personExists,
  messagingOverview,
  platformHealth,
  platformOverview,
  runnerVerdictOf,
  userDetail,
  userDirectory,
} from "./views";
import { passQueue } from "./passes";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
const PHONE_ADMIN = `+9193${RUN}1`;
const PHONE_OWNER = `+9194${RUN}2`;
const TEST_PHONES = [PHONE_ADMIN, PHONE_OWNER];

let adminId = "";
let ownerId = "";
let orgId = "";
let orgSlug = "";

async function person(phone: string, name: string): Promise<string> {
  const id = newId();
  await db.insert(people).values({ id, phone, name });
  return id;
}

beforeAll(async () => {
  await db.delete(people).where(inArray(people.phone, TEST_PHONES));
  adminId = await person(PHONE_ADMIN, "PX9 Platform Admin");
  ownerId = await person(PHONE_OWNER, "PX9 Org Owner");
  const org = await createOrg(db, ownerId, `PX9 Admin Org ${RUN}`);
  orgId = org.id;
  orgSlug = org.slug;

  // The platform grant, on the singleton scope — as the seed writes it.
  await db.insert(grantsTable).values({
    id: newId(),
    personId: adminId,
    scopeType: PLATFORM_SCOPE_TYPE,
    scopeId: PLATFORM_SCOPE_ID,
    capabilitySet: "platform:admin",
    grantedBy: adminId,
  });
  // The org owner also holds the money sets — the strongest an ORG can confer.
  for (const set of ["settlement:controller", "finops:controller"]) {
    await db.insert(grantsTable).values({
      id: newId(),
      personId: ownerId,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: set,
      grantedBy: ownerId,
    });
  }
}, 60_000);

afterAll(async () => {
  await db.delete(grantsTable).where(inArray(grantsTable.personId, [adminId, ownerId]));
  // createOrg() also writes an org_members row, which references `people`
  // under RESTRICT (0040): the person cannot go while the membership stands.
  await db.delete(orgMembers).where(inArray(orgMembers.personId, [adminId, ownerId]));
  await db.delete(people).where(inArray(people.phone, TEST_PHONES));
  await handle.sql.end({ timeout: 5 });
});

describe("RH-1g · The platform engine's second set", () => {
  /*
   * Administration could only observe until a pass request needed answering.
   * The answer is a SECOND SET, not a second word in the first one: seeing
   * every organization's money and changing what a customer is entitled to are
   * different acts of trust, and nobody should acquire the second by being
   * handed the first.
   */
  const platformGrant = (set: string) => [
    {
      capabilitySet: set,
      scopeType: PLATFORM_SCOPE_TYPE,
      scopeId: PLATFORM_SCOPE_ID,
      revokedAt: null,
    },
  ];

  it("admin sees, and cannot answer", () => {
    const grants = platformGrant("platform:admin");
    expect(hasPlatformCapability(grants, "platform.admin")).toBe(true);
    expect(hasPlatformCapability(grants, "platform.pass")).toBe(false);
  });

  it("billing answers, and cannot see", () => {
    const grants = platformGrant("platform:billing");
    expect(hasPlatformCapability(grants, "platform.pass")).toBe(true);
    expect(hasPlatformCapability(grants, "platform.admin")).toBe(false);
  });

  it("an operator who does both holds both, on purpose", () => {
    const grants = [...platformGrant("platform:admin"), ...platformGrant("platform:billing")];
    expect(hasPlatformCapability(grants, "platform.admin")).toBe(true);
    expect(hasPlatformCapability(grants, "platform.pass")).toBe(true);
  });

  it("no org, settlement or finops set reaches the new capability either", () => {
    for (const set of ["org:owner", "org:staff", "settlement:controller", "finops:controller"]) {
      expect(hasPlatformCapability(platformGrant(set), "platform.pass")).toBe(false);
    }
  });

  it("a revoked or wrongly-scoped billing grant confers nothing", () => {
    expect(
      hasPlatformCapability(
        [
          {
            capabilitySet: "platform:billing",
            scopeType: PLATFORM_SCOPE_TYPE,
            scopeId: PLATFORM_SCOPE_ID,
            revokedAt: new Date(),
          },
        ],
        "platform.pass",
      ),
    ).toBe(false);
    // The singleton scope is pinned: an org-scoped row with the same set is
    // structurally unable to match, which is what RLS relies on.
    expect(
      hasPlatformCapability(
        [
          {
            capabilitySet: "platform:billing",
            scopeType: "org",
            scopeId: "01ABCDEFGHJKMNPQRSTVWXYZ00",
            revokedAt: null,
          },
        ],
        "platform.pass",
      ),
    ).toBe(false);
  });
});

describe("PX-9 · The fourth capability partition", () => {
  it("unknown sets expand to nothing — the platform engine fails CLOSED", () => {
    expect(platformCapabilitiesOf("platform:admin")).toEqual(["platform.admin"]);
    expect(platformCapabilitiesOf("platform:superuser")).toEqual([]);
    expect(platformCapabilitiesOf("")).toEqual([]);
    expect(isPlatformCapabilitySet("org:owner")).toBe(false);
  });

  it("PARTITION, all twelve directions: no engine honours another's sets", () => {
    // The platform engine expands the other three engines' sets to nothing…
    for (const foreign of [
      "org:owner",
      "org:staff",
      "viewer",
      "settlement:officer",
      "settlement:controller",
      "finops:clerk",
      "finops:accountant",
      "finops:controller",
    ]) {
      expect(platformCapabilitiesOf(foreign)).toEqual([]);
    }
    // …and the other three expand the platform's set to nothing.
    expect(capabilitiesOf("platform:admin")).toEqual([]);
    expect(settlementCapabilitiesOf("platform:admin")).toEqual([]);
    expect(finopsCapabilitiesOf("platform:admin")).toEqual([]);
  });

  it("org:owner + settlement:controller + finops:controller confer ZERO platform power", async () => {
    const held = await grantsFor(db, ownerId);
    // The owner genuinely holds the strongest authority an org can confer…
    expect(hasCapability(held, { scopeType: "org", scopeId: orgId }, "org.manage")).toBe(true);
    expect(
      hasSettlementCapability(held, { scopeType: "org", scopeId: orgId }, "settlement.override"),
    ).toBe(true);
    expect(hasFinopsCapability(held, { scopeType: "org", scopeId: orgId }, "finops.close")).toBe(
      true,
    );
    // …and none of it reaches the platform.
    expect(hasPlatformCapability(held, "platform.admin")).toBe(false);
  });

  it("platform:admin confers ZERO org, settlement and finops power", async () => {
    const held = await grantsFor(db, adminId);
    expect(hasPlatformCapability(held, "platform.admin")).toBe(true);
    expect(hasCapability(held, { scopeType: "org", scopeId: orgId }, "org.manage")).toBe(false);
    expect(hasCapability(held, { scopeType: "org", scopeId: orgId }, "auction.conduct")).toBe(
      false,
    );
    expect(
      hasSettlementCapability(held, { scopeType: "org", scopeId: orgId }, "settlement.view"),
    ).toBe(false);
    expect(hasFinopsCapability(held, { scopeType: "org", scopeId: orgId }, "finops.view")).toBe(
      false,
    );
  });

  it("SINGLETON scope: a platform:admin grant on an ORG scope confers nothing", async () => {
    const strayId = newId();
    await db.insert(grantsTable).values({
      id: strayId,
      personId: ownerId,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: "platform:admin",
      grantedBy: ownerId,
    });
    try {
      // Both scope_type AND scope_id are pinned, so this row is inert. Without
      // the scope pin, anyone holding `grant.issue` on their own org could mint
      // themselves the platform console.
      expect(hasPlatformCapability(await grantsFor(db, ownerId), "platform.admin")).toBe(false);
    } finally {
      await db.delete(grantsTable).where(eq(grantsTable.id, strayId));
    }
  });

  it("a REVOKED platform grant confers nothing", async () => {
    await db
      .update(grantsTable)
      .set({ revokedAt: new Date() })
      .where(eq(grantsTable.personId, adminId));
    expect(hasPlatformCapability(await grantsFor(db, adminId), "platform.admin")).toBe(false);
    await db.update(grantsTable).set({ revokedAt: null }).where(eq(grantsTable.personId, adminId));
    expect(hasPlatformCapability(await grantsFor(db, adminId), "platform.admin")).toBe(true);
  });
});

describe("PX-9 · RLS: the platform grant is unforgeable from the application role", () => {
  it("RLS PROOF: the app role CANNOT insert a platform-scoped grant, in any context", async () => {
    const role = `rls_admin_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select, insert, update, delete on grants to ${role}`);

    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    try {
      // 1 · Holding a legitimate org context, try to mint platform authority.
      //     `grants_tenant`'s WITH CHECK admits scope_type = 'org' ONLY.
      await expect(
        probe.begin(async (tx) => {
          await tx`select set_config('app.org_id', ${orgId}, true)`;
          await tx`select set_config('app.person_id', ${ownerId}, true)`;
          await tx`insert into grants (id, person_id, scope_type, scope_id, capability_set, granted_by)
                   values (${newId()}, ${ownerId}, ${PLATFORM_SCOPE_TYPE}, ${PLATFORM_SCOPE_ID}, 'platform:admin', ${ownerId})`;
        }),
      ).rejects.toThrow(/row-level security/i);

      // 2 · The self-row escape hatch is closed on the write side too (RC-4).
      await expect(
        probe.begin(async (tx) => {
          await tx`select set_config('app.person_id', ${ownerId}, true)`;
          await tx`insert into grants (id, person_id, scope_type, scope_id, capability_set, granted_by)
                   values (${newId()}, ${ownerId}, ${PLATFORM_SCOPE_TYPE}, ${PLATFORM_SCOPE_ID}, 'platform:admin', ${ownerId})`;
        }),
      ).rejects.toThrow(/row-level security/i);

      // 3 · An ordinary org grant still writes — the lock is specific, not blunt.
      const allowed = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgId}, true)`;
        const id = newId();
        await tx`insert into grants (id, person_id, scope_type, scope_id, capability_set, granted_by)
                 values (${id}, ${ownerId}, 'org', ${orgId}, 'viewer', ${ownerId})`;
        await tx`delete from grants where id = ${id}`;
        return true;
      });
      expect(allowed).toBe(true);

      // 4 · READ side: a person can still see their OWN platform grant under
      //     RLS — which is exactly what platformAdminGate relies on, so the
      //     gate never needs the RLS-exempt pool to decide access.
      const own = await probe.begin(async (tx) => {
        await tx`select set_config('app.person_id', ${adminId}, true)`;
        const rows = await tx`select capability_set from grants where person_id = ${adminId}`;
        return rows.map((row) => String(row["capability_set"]));
      });
      expect(own).toContain("platform:admin");

      // 5 · …and CANNOT see anyone else's.
      const others = await probe.begin(async (tx) => {
        await tx`select set_config('app.person_id', ${ownerId}, true)`;
        const rows = await tx`select count(*)::int as n from grants where person_id = ${adminId}`;
        return Number(rows[0]?.["n"]);
      });
      expect(others).toBe(0);
    } finally {
      await probeHandle.sql.end({ timeout: 5 });
      await handle.sql.unsafe(`revoke all on grants from ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  }, 60_000);
});

/**
 * The read-only PROOF.
 *
 * A dependency rule keeps administration from IMPORTING a writer; this proves
 * the stronger property at runtime — that no admin projection mutates anything,
 * by any route, including raw SQL. Every view is driven through a handle whose
 * mutation verbs throw. If a future change adds a write to any of them, this
 * suite fails loudly rather than shipping a console that can act.
 */
function readOnlyDb(): typeof db {
  const forbid = (verb: string) => () => {
    throw new Error(`READ-ONLY VIOLATION: administration called db.${verb}()`);
  };
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "insert" || property === "update" || property === "delete") {
        return forbid(property);
      }
      if (property === "execute") {
        // Raw SQL is the back door a Proxy on the verbs alone would miss.
        return (query: Parameters<typeof db.execute>[0]) => {
          const text = JSON.stringify(query).toLowerCase();
          if (/\b(insert|update|delete|truncate|drop|alter|create)\b/.test(text)) {
            throw new Error(`READ-ONLY VIOLATION: administration executed "${text}"`);
          }
          return db.execute(query);
        };
      }
      if (property === "transaction") {
        return () => {
          throw new Error("READ-ONLY VIOLATION: administration opened a write transaction");
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

describe("PX-9 · The read-only guarantee, proved at runtime", () => {
  it("EVERY admin projection runs to completion against a db that refuses to mutate", async () => {
    const ro = readOnlyDb();
    const deps = webFinopsDeps(ro);

    // The whole console, driven. Each returns data; none writes.
    const overview = await platformOverview(deps, ro);
    expect(overview.totals.orgs).toBeGreaterThan(0);
    expect(overview.totals.people).toBeGreaterThan(0);

    const directory = await organizationDirectory(ro, {});
    expect(directory.total).toBeGreaterThan(0);

    const detail = await organizationDetail(ro, orgSlug);
    expect(detail?.org.id).toBe(orgId);

    const users = await userDirectory(ro, "PX9");
    expect(users.rows.length).toBeGreaterThan(0);

    const user = await userDetail(ro, adminId);
    expect(user?.person.id).toBe(adminId);

    const audit = await auditExplorer(ro, {});
    expect(Array.isArray(audit.rows)).toBe(true);

    const health = await platformHealth(deps, ro);
    expect(Array.isArray(health.orgs)).toBe(true);

    const messaging = await messagingOverview(ro, {});
    // Driven with an EMPTY environment on purpose: the honest reading of a
    // deployment with no registered ids is "nothing can be sent", and a
    // projection that quietly reported them configured would hide the one
    // failure this surface exists to make visible.
    expect(messaging.total).toBeGreaterThan(0);
    expect(messaging.configured).toBe(0);
    expect(Array.isArray(messaging.recent)).toBe(true);

    // RH-1g: administration gained the power to answer a pass request, and the
    // guarantee narrowed to exactly that — the WRITE lives in its own module
    // behind its own grant, and the queue that feeds it is a projection like
    // every other one. Driven here so it can never quietly start mutating.
    const passes = await passQueue(ro);
    expect(Array.isArray(passes.open)).toBe(true);
    expect(Array.isArray(passes.recent)).toBe(true);
  }, 120_000);

  it("the proof harness itself has teeth — a write through it throws", () => {
    const ro = readOnlyDb();
    expect(() => ro.insert(people)).toThrow(/READ-ONLY VIOLATION/);
    expect(() => ro.delete(people)).toThrow(/READ-ONLY VIOLATION/);
    expect(() => ro.update(people)).toThrow(/READ-ONLY VIOLATION/);
    expect(() => ro.transaction(() => Promise.resolve(undefined))).toThrow(/READ-ONLY VIOLATION/);
  });
});

describe("PX-9 · The projections tell the truth", () => {
  it("the org directory reports the domains' own counts, and search narrows it", async () => {
    const found = await organizationDirectory(db, { query: `PX9 Admin Org ${RUN}` });
    expect(found.rows).toHaveLength(1);
    const row = found.rows[0];
    expect(row?.slug).toBe(orgSlug);
    expect(row?.competitions).toBe(0);
    expect(row?.financeDeclared).toBe(false);

    const missing = await organizationDirectory(db, { query: `no-such-org-${RUN}` });
    expect(missing.rows).toHaveLength(0);
  });

  it("the user inspector shows the platform grant as the ordinary row it is", async () => {
    const detail = await userDetail(db, adminId);
    const platform = detail?.grants.find((grant) => grant.scopeType === PLATFORM_SCOPE_TYPE);
    expect(platform?.capabilitySet).toBe("platform:admin");
    expect(platform?.scopeLabel).toBe("The platform");
    expect(platform?.revokedAt).toBeNull();
  });

  it("the audit explorer filters by actor and folds to zero for a stranger", async () => {
    const mine = await auditExplorer(db, { actor: ownerId });
    // createOrg audits; every row returned must be the actor asked for.
    expect(mine.rows.every((row) => row.actor === ownerId)).toBe(true);

    const none = await auditExplorer(db, { actor: newId() });
    expect(none.rows).toHaveLength(0);
    expect(none.total).toBe(0);
  });
});

/**
 * THE READ-ONLY PROOF, RE-ARMED (Screen 21).
 *
 * Administration now writes exactly one thing: its own access record (see
 * `access-log.ts` for the decision and its justification). The runtime proof
 * above is unchanged and still drives every projection through a handle that
 * refuses to mutate — but a runtime proof can only see the code paths it
 * happens to drive, and a write introduced in a module it does not call would
 * have slipped past it.
 *
 * So the guarantee is also asserted STATICALLY, over the source. Every file
 * under administration is read, and a mutation verb in any of them fails the
 * suite — except in `access-log.ts`, which is allowed exactly the one insert it
 * exists for. The test is strictly stronger than before: it fails on any write
 * that is not the access log, wherever that write is added.
 */
describe("PX-9 · Administration holds ONE write, and the source proves it", () => {
  const ADMIN_DIRS = [
    resolve(import.meta.dirname, "."),
    resolve(import.meta.dirname, "../../app/admin"),
  ];
  const WRITE_VERB = /\.(insert|update|delete|transaction)\s*\(/;
  const ALLOWED = "access-log.ts";

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(full);
      }
      return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [full] : [];
    });
  }

  it("no module under administration mutates, except the named access log", () => {
    const offenders = ADMIN_DIRS.flatMap(sourceFiles)
      .filter((file) => !file.endsWith(ALLOWED))
      .filter((file) => WRITE_VERB.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(resolve(import.meta.dirname, "../../../.."), ""));
    expect(offenders, "a write appeared in administration outside the access log").toEqual([]);
  });

  it("the access log holds exactly ONE write, and it is an INSERT", () => {
    const source = readFileSync(join(import.meta.dirname, ALLOWED), "utf8");
    const writes = source.match(new RegExp(WRITE_VERB, "g")) ?? [];
    expect(writes).toEqual([".insert("]);
    // …of exactly one action, on the platform singleton scope.
    expect(source).toContain("ADMIN_ACCESS_ACTION");
    expect(source).toContain("PLATFORM_SCOPE_ID");
  });

  it("the access log writes one row, naming the actor, the surface and nothing else", async () => {
    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(eq(auditLog.actor, adminId));
    await recordAdminAccess({ personId: adminId }, "users", null);
    const rows = await db
      .select({
        action: auditLog.action,
        scopeType: auditLog.scopeType,
        scopeId: auditLog.scopeId,
        meta: auditLog.meta,
      })
      .from(auditLog)
      .where(and(eq(auditLog.actor, adminId), eq(auditLog.action, ADMIN_ACCESS_ACTION)));
    expect(rows).toHaveLength((before[0]?.n ?? 0) + 1);
    expect(rows[0]?.scopeType).toBe(PLATFORM_SCOPE_TYPE);
    // Never the inspected org's scope: an admin READING an organization is not
    // that organization's activity and must not appear in its timeline.
    expect(rows[0]?.scopeId).toBe(PLATFORM_SCOPE_ID);
    expect(rows[0]?.meta).toEqual({ surface: "users" });
    await db.delete(auditLog).where(eq(auditLog.actor, adminId));
  });
});

describe("PX-9 · The filters are the database's, and the list has an end", () => {
  it("FILTERS RUN IN SQL, not over the newest fifty rows", async () => {
    // The old code took 50 rows ordered by created_at desc and filtered them in
    // Node, so "Finance declared" reported 1 of the 3 orgs that had declared —
    // the other two sat at ranks 252 and 271 of 349 — and "Open cases" reported
    // zero while asserting "This filter has no organizations yet."
    const declared = await db.select({ n: sql<number>`count(*)::int` }).from(finopsProfiles);
    const finance = await organizationDirectory(db, { filter: "finance" });
    expect(finance.total).toBe(declared[0]?.n ?? 0);
    expect(finance.rows.every((row) => row.financeDeclared)).toBe(true);

    // …and the denominator stays the denominator.
    expect(finance.platformTotal).toBeGreaterThanOrEqual(finance.total);

    const quiet = await organizationDirectory(db, { filter: "quiet" });
    expect(quiet.rows.every((row) => row.competitions === 0)).toBe(true);

    const settling = await organizationDirectory(db, { filter: "settling" });
    expect(settling.rows.every((row) => row.openCases + row.settledCases > 0)).toBe(true);
  }, 60_000);

  it("PAGINATION reaches past row 50, and page two never repeats page one", async () => {
    const first = await organizationDirectory(db, {});
    if (first.nextCursor === null) {
      // Small database: nothing to page. The assertion below would be vacuous.
      expect(first.rows.length).toBeLessThan(50);
      return;
    }
    const second = await organizationDirectory(db, { after: first.nextCursor });
    expect(second.rows.length).toBeGreaterThan(0);
    const firstIds = new Set(first.rows.map((row) => row.id));
    expect(second.rows.some((row) => firstIds.has(row.id))).toBe(false);
    // The denominator is the same question on both pages.
    expect(second.platformTotal).toBe(first.platformTotal);
  }, 60_000);

  it("a forged or stale cursor yields page one rather than an error", async () => {
    const page = await organizationDirectory(db, { after: newId() });
    expect(page.rows.length).toBeGreaterThan(0);
  }, 30_000);

  it("EXISTENCE is answerable before the boundary opens, for real and malformed ids", async () => {
    expect(await organizationExists(db, orgSlug)).toBe(true);
    expect(await organizationExists(db, `no-such-org-${RUN}`)).toBe(false);
    expect(await personExists(db, adminId)).toBe(true);
    expect(await personExists(db, PLATFORM_SCOPE_ID)).toBe(false);
    // A malformed id must MISS, not throw: the audit explorer links to
    // whatever the actor column holds, and 704 of those are not people.
    expect(await personExists(db, "NOTAULID")).toBe(false);
  }, 30_000);
});

describe("PX-9 · The runner verdict can go red", () => {
  it("a runner with a queue older than its own freshness budget is NOT healthy", async () => {
    const deps = webFinopsDeps(db);
    const snapshot = await runnerHealthSnapshot(deps);
    const verdict = await runnerVerdictOf(deps, db, snapshot);

    // The snapshot's own rule, restated so the divergence is visible.
    expect(snapshot.healthy).toBe(snapshot.jobs.dead === 0);

    if (verdict.oldestQueuedWaitMs !== null && verdict.oldestQueuedWaitMs > 15 * 60 * 1000) {
      // THE DEFECT: `dead === 0` reported green over 1,558 jobs whose oldest
      // had waited eleven days.
      expect(verdict.healthy).toBe(false);
      expect(verdict.detail).not.toBeNull();
    }
    if (verdict.dead > 0) {
      expect(verdict.healthy).toBe(false);
    }
    // Age is never negative, however the clock and `not_before_ms` disagree.
    expect(verdict.oldestQueuedWaitMs === null || verdict.oldestQueuedWaitMs >= 0).toBe(true);
  }, 60_000);

  it("the attention queue can see a tenant with no finance profile", async () => {
    const deps = webFinopsDeps(db);
    const snapshot = await runnerHealthSnapshot(deps);
    const verdict = await runnerVerdictOf(deps, db, snapshot);
    const queue = await attentionQueue(deps, db, verdict);
    const kinds = new Set(queue.map((row) => row.kind));

    // Whatever this database holds, the queue's REACH is no longer bounded by
    // `finops_profiles`: a stalled runner and a stuck auction are raised for
    // every tenant, and 346 of 349 orgs have no finance profile at all.
    if (verdict.oldestQueuedWaitMs !== null && verdict.oldestQueuedWaitMs > 15 * 60 * 1000) {
      expect(kinds.has("runner:stalled")).toBe(true);
    }
    const stuck = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auctions)
      .where(
        and(
          eq(auctions.status, "live"),
          lt(auctions.createdAt, new Date(Date.now() - 12 * 60 * 60 * 1000)),
        ),
      );
    if ((stuck[0]?.n ?? 0) > 0) {
      expect(kinds.has("auction:stuck-live")).toBe(true);
    }
    // Every row an admin can actually open — no link into a console that
    // `platform:admin` cannot enter.
    for (const row of queue) {
      expect(row.href === null || row.href.startsWith("/admin/")).toBe(true);
    }
  }, 90_000);
});
