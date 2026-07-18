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
import { createDb, grants as grantsTable, newId, people, type DbHandle } from "@desiauction/db";
import { hasFinopsCapability, finopsCapabilitiesOf } from "@desiauction/financial-operations";
import { hasSettlementCapability, settlementCapabilitiesOf } from "@desiauction/settlement";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { grantsFor } from "../orgs/authz";
import { webFinopsDeps } from "../financial-operations/deps";
import {
  PLATFORM_SCOPE_ID,
  PLATFORM_SCOPE_TYPE,
  hasPlatformCapability,
  isPlatformCapabilitySet,
  platformCapabilitiesOf,
} from "./capabilities";
import {
  adminSearch,
  auditExplorer,
  organizationDetail,
  organizationDirectory,
  platformHealth,
  platformOverview,
  userDetail,
  userDirectory,
} from "./views";

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
  await db.delete(people).where(inArray(people.phone, TEST_PHONES));
  await handle.sql.end({ timeout: 5 });
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

    const hits = await adminSearch(ro, "PX9");
    expect(hits.length).toBeGreaterThan(0);
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

  it("command search is navigation only — every hit is a route, never a command", async () => {
    const hits = await adminSearch(db, `PX9 Admin Org ${RUN}`);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.href.startsWith("/")).toBe(true);
    }
    expect(hits.some((hit) => hit.href === `/admin/orgs/${orgSlug}`)).toBe(true);
    // A one-character query returns nothing rather than the whole platform.
    expect(await adminSearch(db, "P")).toEqual([]);
  });
});
