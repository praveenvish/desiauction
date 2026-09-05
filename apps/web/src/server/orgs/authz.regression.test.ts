// PERMANENT AUTHORIZATION REGRESSION SUITE (M-IP2-3). Companion to the
// security suite: encodes the tenancy + capability contract. Real Postgres.
// The RLS proof runs under a throwaway NON-superuser role — the local app
// connection is the table owner/superuser, which PostgreSQL exempts from
// policies; production roles are non-BYPASSRLS, so this role mirrors prod.
import {
  auditLog,
  createDb,
  grants as grantsTable,
  invites as invitesTable,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  people,
  sessions,
  type DbHandle,
} from "@desiauction/db";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { ForbiddenError, can, requireCapability } from "./authz";
import { acceptInvite, createInvite, previewInvite, revokeInvite } from "./invites";
import { createOrg, issueGrant, membersOf, resolveTenant, revokeGrants } from "./orgs";
import { purgeOrg } from "../test-support/purge-org";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9198${RUN}2`;
const PHONE_STAFF = `+9199${RUN}3`;
const PHONE_OUTSIDER = `+9196${RUN}4`;
const TEST_PHONES = [PHONE_OWNER, PHONE_STAFF, PHONE_OUTSIDER];

let owner = "";
let staff = "";
let outsider = "";
let orgX = { id: "", name: "", slug: "" };
let orgY = { id: "", name: "", slug: "" };

async function login(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const [row] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const verified = await verifyOtp(db, phone, row?.code ?? "");
  if (!verified.ok) {
    throw new Error("login failed");
  }
  return verified.personId;
}

beforeAll(async () => {
  owner = await login(PHONE_OWNER);
  staff = await login(PHONE_STAFF);
  outsider = await login(PHONE_OUTSIDER);
  orgX = await createOrg(db, owner, `Org X ${RUN}`);
  orgY = await createOrg(db, outsider, `Org Y ${RUN}`);
});

afterAll(async () => {
  const ids = [owner, staff, outsider].filter((id) => id !== "");
  const orgIds = [orgX.id, orgY.id].filter((id) => id !== "");
  // PA-1R Phase 3: the spine these teardowns never deleted (purge-org.ts).
  for (const purgeId of orgIds) {
    await purgeOrg(db, purgeId);
  }
  if (orgIds.length > 0) {
    await db.delete(invitesTable).where(inArray(invitesTable.orgId, orgIds));
    await db.delete(orgMembers).where(inArray(orgMembers.orgId, orgIds));
    await db.delete(grantsTable).where(inArray(grantsTable.scopeId, orgIds));
    await db.delete(auditLog).where(inArray(auditLog.scopeId, [...orgIds, ...ids]));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  if (ids.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, ids));
    await db.delete(auditLog).where(inArray(auditLog.actor, ids));
    await db.delete(people).where(inArray(people.id, ids));
  }
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await handle.sql.end();
});

describe("AUTHZ REGRESSION — tenancy + capability contract", () => {
  it("creating an org makes the creator a member with the owner set", async () => {
    const members = await membersOf(db, orgX.id);
    expect(members.map((m) => m.personId)).toContain(owner);
    expect(members.find((m) => m.personId === owner)?.capabilitySets).toContain("org:owner");
  });

  it("tenant resolution: non-members and unknown slugs are indistinguishable", async () => {
    expect(await resolveTenant(db, outsider, orgX.slug)).toBeNull();
    expect(await resolveTenant(db, owner, "no-such-org")).toBeNull();
    expect(await resolveTenant(db, owner, orgX.slug)).not.toBeNull();
  });

  it("cross-tenant capability attempts are Forbidden", async () => {
    await expect(
      requireCapability(db, owner, { scopeType: "org", scopeId: orgY.id }, "org.members.invite"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("invite lifecycle: create → accept once → replay fails", async () => {
    const invite = await createInvite(db, orgX.id, owner, "org:staff");
    const first = await acceptInvite(db, staff, invite.token);
    // `orgName` joined the result so acceptance can finally CONFIRM itself:
    // the redirect used to be silent, and an unnamed account was bounced
    // straight on to /onboarding with nothing saying the invite had worked.
    expect(first).toEqual({ ok: true, orgSlug: orgX.slug, orgName: orgX.name });
    const replay = await acceptInvite(db, staff, invite.token);
    expect(replay).toEqual({ ok: false });
    expect(await previewInvite(db, invite.token)).toBeNull();
  });

  it("staff holds staff capabilities but cannot escalate", async () => {
    const scope = { scopeType: "org" as const, scopeId: orgX.id };
    expect(await can(db, staff, scope, "player.verify")).toBe(true);
    expect(await can(db, staff, scope, "grant.issue")).toBe(false);
    await expect(requireCapability(db, staff, scope, "org.members.invite")).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("expired invites are rejected", async () => {
    const invite = await createInvite(db, orgX.id, owner, "viewer");
    await db
      .update(invitesTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitesTable.orgId, orgX.id));
    expect(await acceptInvite(db, outsider, invite.token)).toEqual({ ok: false });
  });

  it("revoked invites are rejected", async () => {
    const invite = await createInvite(db, orgX.id, owner, "viewer");
    const [row] = await db
      .select()
      .from(invitesTable)
      .where(eq(invitesTable.orgId, orgX.id))
      .orderBy(desc(invitesTable.expiresAt))
      .limit(1);
    if (row !== undefined) {
      await revokeInvite(db, orgX.id, row.id, owner);
    }
    expect(await acceptInvite(db, outsider, invite.token)).toEqual({ ok: false });
  });

  it("unknown capability sets on invites are refused at creation", async () => {
    await expect(createInvite(db, orgX.id, owner, "org:superadmin")).rejects.toThrow();
  });

  it("revoking a grant removes the capability immediately, session or not", async () => {
    const scope = { scopeType: "org" as const, scopeId: orgX.id };
    await issueGrant(db, orgX.id, staff, "org:staff", owner);
    expect(await can(db, staff, scope, "player.verify")).toBe(true);
    await revokeGrants(db, orgX.id, staff, "org:staff", owner);
    expect(await can(db, staff, scope, "player.verify")).toBe(false);
  });

  it("AUDIT PROOF: a role on the production grant recipe cannot UPDATE or DELETE audit rows", async () => {
    // The D8 append-only contract as a tested fact: the app role is granted
    // SELECT + INSERT on audit_log and nothing else (the provisioning recipe
    // in docs/identity/RUNBOOKS.md). Mutation must die at the SQL layer.
    const role = `audit_probe_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select, insert on audit_log to ${role}`);
    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    try {
      const mutate = (statement: "update" | "delete") =>
        probe.begin(async (tx) => {
          await tx`select set_config('app.person_id', ${owner}, true)`;
          return statement === "update"
            ? tx`update audit_log set action = 'tampered' where actor = ${owner}`
            : tx`delete from audit_log where actor = ${owner}`;
        });
      await expect(mutate("update")).rejects.toThrow(/permission denied/);
      await expect(mutate("delete")).rejects.toThrow(/permission denied/);
    } finally {
      await probe.end();
      await handle.sql.unsafe(`drop owned by ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  });

  it("RLS PROOF: the database layer independently blocks cross-tenant reads", async () => {
    const role = `rls_probe_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select on org_members, invites, grants, audit_log to ${role}`);
    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    try {
      // Tenant context = org X: X's members visible, Y's invisible.
      const visible = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgX.id}, true)`;
        return tx`select * from org_members where org_id = ${orgX.id}`;
      });
      expect(visible.length).toBeGreaterThan(0);
      const crossTenant = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgX.id}, true)`;
        return tx`select * from org_members where org_id = ${orgY.id}`;
      });
      expect(crossTenant.length).toBe(0);
      // No tenant context at all -> policies fail closed: zero rows.
      const noContext = await probe`select * from org_members`;
      expect(noContext.length).toBe(0);
    } finally {
      await probe.end();
      await handle.sql.unsafe(`drop owned by ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  });

  it("RLS WRITE PROOF: WITH CHECK blocks a self-escalating cross-tenant write (RC-4 F1)", async () => {
    // The write-side lock (migration 0004). Under the R-1 role recipe a caller
    // must not be able to INSERT a grant scoped to an org that is not their
    // active tenant — the classic self-escalation to org:owner on any org.
    const role = `rls_wprobe_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select, insert on grants to ${role}`);
    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    try {
      // Active tenant = org X; attempt a grant scoped to FOREIGN org Y -> denied.
      const cross = probe.begin(async (tx) => {
        await tx`select set_config('app.person_id', ${owner}, true)`;
        await tx`select set_config('app.org_id', ${orgX.id}, true)`;
        await tx`insert into grants(id, person_id, scope_type, scope_id, capability_set, granted_by)
                 values (${newId()}, ${owner}, 'org', ${orgY.id}, 'org:owner', ${owner})`;
      });
      await expect(cross).rejects.toThrow(/row-level security/);

      // A grant scoped to the ACTIVE tenant is legitimate and succeeds.
      const legitId = newId();
      await probe.begin(async (tx) => {
        await tx`select set_config('app.person_id', ${owner}, true)`;
        await tx`select set_config('app.org_id', ${orgX.id}, true)`;
        await tx`insert into grants(id, person_id, scope_type, scope_id, capability_set, granted_by)
                 values (${legitId}, ${owner}, 'org', ${orgX.id}, 'viewer', ${owner})`;
      });
      const [written] = await db
        .select()
        .from(grantsTable)
        .where(eq(grantsTable.id, legitId))
        .limit(1);
      expect(written?.scopeId).toBe(orgX.id);
    } finally {
      await probe.end();
      await handle.sql.unsafe(`drop owned by ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  });
});
