// PERMANENT COMPETITION REGRESSION SUITE (M-IP3-1). Encodes the domain contract
// of the Competition subsystem: capability enforcement, the registration
// machine, the duplicate rule, and RLS read+write isolation on every new table.
// Real Postgres; unique phones/orgs per run; the RLS proofs run under a
// dedicated non-superuser role mirroring production (the RC-4 discipline).
import {
  auditLog,
  competitions as competitionsTable,
  createDb,
  grants as grantsTable,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  people,
  registrations as registrationsTable,
  seasons as seasonsTable,
  sessions,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { createOrg } from "../orgs/orgs";
import { canCompetition, requireCompetitionCapability } from "./authz";
import {
  advanceCompetition,
  createCompetition,
  createTeam,
  resolveCompetition,
  seasonsOf,
  createSeason,
  teamsOf,
} from "./competitions";
import { registrationsOf, submitRegistration, triageRegistration } from "./registrations";
import { ForbiddenError } from "../orgs/authz";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9198${RUN}2`;
const PHONE_OUTSIDER = `+9196${RUN}4`;
const PHONE_PLAYER = `+9197${RUN}5`;
const TEST_PHONES = [PHONE_OWNER, PHONE_OUTSIDER, PHONE_PLAYER];

let owner = "";
let outsider = "";
let player = "";
let orgX = { id: "", name: "", slug: "" };
let orgY = { id: "", name: "", slug: "" };
let compSlug = "";
let compId = "";

function must<T>(value: T | null, label: string): T {
  if (value === null) {
    throw new Error(`expected ${label} to be present`);
  }
  return value;
}

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
  outsider = await login(PHONE_OUTSIDER);
  player = await login(PHONE_PLAYER);
  orgX = await createOrg(db, owner, `Comp Org X ${RUN}`);
  orgY = await createOrg(db, outsider, `Comp Org Y ${RUN}`);
});

afterAll(async () => {
  const ids = [owner, outsider, player].filter((id) => id !== "");
  const orgIds = [orgX.id, orgY.id].filter((id) => id !== "");
  if (orgIds.length > 0) {
    await db.delete(registrationsTable).where(inArray(registrationsTable.orgId, orgIds));
    await db.delete(teamsTable).where(inArray(teamsTable.orgId, orgIds));
    await db.delete(competitionsTable).where(inArray(competitionsTable.orgId, orgIds));
    await db.delete(seasonsTable).where(inArray(seasonsTable.orgId, orgIds));
    await db.delete(grantsTable).where(inArray(grantsTable.scopeId, orgIds));
    await db.delete(orgMembers).where(inArray(orgMembers.orgId, orgIds));
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

describe("COMPETITION REGRESSION — domain contract", () => {
  it("an org owner holds the new competition capabilities on their org", async () => {
    const scope = { orgId: orgX.id };
    expect(await canCompetition(db, owner, scope, "competition.create")).toBe(true);
    expect(await canCompetition(db, owner, scope, "team.manage")).toBe(true);
    expect(await canCompetition(db, owner, scope, "registration.review")).toBe(true);
    // Cross-org: the owner of X holds nothing on Y.
    expect(await canCompetition(db, owner, { orgId: orgY.id }, "competition.create")).toBe(false);
    await expect(
      requireCompetitionCapability(db, owner, { orgId: orgY.id }, "competition.manage"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("creates a season and a competition; the competition starts in draft", async () => {
    const season = await createSeason(db, orgX.id, owner, `Season ${RUN}`, 2026);
    expect((await seasonsOf(db, orgX.id)).map((s) => s.id)).toContain(season.id);
    const competition = await createCompetition(db, orgX.id, owner, {
      name: `MPL ${RUN}`,
      seasonId: season.id,
      location: "Malad",
      startsOn: "2026-08-01",
      endsOn: "2026-08-15",
    });
    compSlug = competition.slug;
    compId = competition.id;
    expect(competition.status).toBe("draft");
    // Membership-gated resolution: the owner sees it, the outsider does not.
    expect(await resolveCompetition(db, owner, compSlug)).not.toBeNull();
    expect(await resolveCompetition(db, outsider, compSlug)).toBeNull();
  });

  it("the lifecycle guard blocks opening registration until dates+location exist", async () => {
    // A bare competition (no dates/location) cannot open registration.
    const bare = await createCompetition(db, orgX.id, owner, { name: `Bare ${RUN}` });
    const setup = await advanceCompetition(db, { ...bare, orgId: orgX.id }, owner, "setup");
    expect(setup.ok).toBe(true);
    const bareResolved = must(await resolveCompetition(db, owner, bare.slug), "bare competition");
    const blocked = await advanceCompetition(db, bareResolved, owner, "registration_open");
    expect(blocked).toEqual({ ok: false, reason: "guard_failed" });
  });

  it("walks the full competition to registration_open and back", async () => {
    let comp = must(await resolveCompetition(db, owner, compSlug), "competition");
    expect((await advanceCompetition(db, comp, owner, "setup")).ok).toBe(true);
    comp = must(await resolveCompetition(db, owner, compSlug), "competition");
    expect((await advanceCompetition(db, comp, owner, "registration_open")).ok).toBe(true);
    comp = must(await resolveCompetition(db, owner, compSlug), "competition");
    expect(comp.status).toBe("registration_open");
  });

  it("team names are unique within a competition", async () => {
    const first = await createTeam(db, orgX.id, compId, owner, "Malad Mavericks");
    expect(first.ok).toBe(true);
    const dup = await createTeam(db, orgX.id, compId, owner, "Malad Mavericks");
    expect(dup).toEqual({ ok: false, reason: "duplicate_name" });
    expect((await teamsOf(db, compId)).length).toBe(1);
  });

  it("a player registers once; a second attempt is a duplicate", async () => {
    const first = await submitRegistration(db, compId, orgX.id, player, "batter");
    expect(first.ok).toBe(true);
    const dup = await submitRegistration(db, compId, orgX.id, player, "bowler");
    expect(dup).toEqual({ ok: false, reason: "duplicate" });
    // An invalid role is refused before any write.
    expect(await submitRegistration(db, compId, orgX.id, outsider, "striker")).toEqual({
      ok: false,
      reason: "invalid_role",
    });
  });

  it("triage: reject needs a reason; approve moves to approved via the machine", async () => {
    const [reg] = await registrationsOf(db, compId);
    expect(reg).toBeDefined();
    if (reg === undefined) {
      return;
    }
    // A reject with an unknown reason category is refused by core's machine.
    const badReject = await triageRegistration(db, orgX.id, compId, reg.id, owner, {
      type: "reject",
      reason: "nonsense" as never,
    });
    expect(badReject).toEqual({ ok: false, reason: "reason_required" });
    // Approve is legal from submitted.
    const approve = await triageRegistration(db, orgX.id, compId, reg.id, owner, {
      type: "approve",
    });
    expect(approve).toEqual({ ok: true, status: "approved" });
    // Approving again is an illegal transition (approved is not re-approvable).
    const again = await triageRegistration(db, orgX.id, compId, reg.id, owner, { type: "approve" });
    expect(again).toEqual({ ok: false, reason: "illegal_transition" });
  });

  it("registration only opens while intake is open (not before)", async () => {
    // orgY has a fresh draft competition — registration must be refused.
    const draft = await createCompetition(db, orgY.id, outsider, { name: `Draft ${RUN}` });
    expect(await submitRegistration(db, draft.id, orgY.id, player, "bowler")).toEqual({
      ok: false,
      reason: "not_open",
    });
  });

  it("RLS PROOF (competition tables): cross-tenant reads and no-context reads are empty", async () => {
    const role = `comp_rls_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(
      `grant select on seasons, competitions, teams, registrations to ${role}`,
    );
    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    try {
      const visible = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgX.id}, true)`;
        return tx`select * from competitions where org_id = ${orgX.id}`;
      });
      expect(visible.length).toBeGreaterThan(0);
      const cross = await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgX.id}, true)`;
        return tx`select * from competitions where org_id = ${orgY.id}`;
      });
      expect(cross.length).toBe(0);
      const noContext = await probe`select * from teams`;
      expect(noContext.length).toBe(0);
    } finally {
      await probe.end();
      await handle.sql.unsafe(`drop owned by ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  });

  it("RLS WRITE PROOF (competition tables): a cross-tenant team insert is rejected by WITH CHECK", async () => {
    const role = `comp_wrls_${RUN}`;
    await handle.sql.unsafe(`drop role if exists ${role}`);
    await handle.sql.unsafe(`create role ${role} login password 'probe' nosuperuser nobypassrls`);
    await handle.sql.unsafe(`grant select, insert on teams to ${role}`);
    const url = new URL(env.DATABASE_URL);
    const probeHandle = createDb(
      `postgres://${role}:probe@${url.hostname}:${url.port}${url.pathname}`,
    );
    const probe = probeHandle.sql;
    try {
      // Active tenant = org X; attempt a team scoped to FOREIGN org Y -> denied.
      // Explicit casts give Postgres each parameter's type (char(26)/text).
      const cross = probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgX.id}, true)`;
        await tx`insert into teams(id, org_id, competition_id, name, created_by)
                 values (${newId()}::char(26), ${orgY.id}::char(26), ${compId}::char(26),
                         ${"Sneaky FC"}::text, ${owner}::char(26))`;
      });
      await expect(cross).rejects.toThrow(/row-level security/);
      // A team scoped to the ACTIVE tenant is accepted.
      const okId = newId();
      const okName = `Legit XI ${RUN}`;
      await probe.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgX.id}, true)`;
        await tx`insert into teams(id, org_id, competition_id, name, created_by)
                 values (${okId}::char(26), ${orgX.id}::char(26), ${compId}::char(26),
                         ${okName}::text, ${owner}::char(26))`;
      });
      const [written] = await db.select().from(teamsTable).where(eq(teamsTable.id, okId)).limit(1);
      expect(written?.orgId).toBe(orgX.id);
    } finally {
      await probe.end();
      await handle.sql.unsafe(`drop owned by ${role}`);
      await handle.sql.unsafe(`drop role if exists ${role}`);
    }
  });
});
