/**
 * RUNTIME POSTURE — the club roles desk (AC-1.3), under the production roles.
 *
 * Support acts for a club it does not belong to. Every write goes through the
 * club's own functions inside the club's boundary on `desiauction_app` — so
 * the proof that matters is that RLS lets exactly that through, and that the
 * club's own rules still hold for support: the last owner cannot be removed,
 * a transfer never leaves the club ownerless, an auctioneer must be a member.
 */
import { createHash, randomBytes } from "node:crypto";

import { auditLog, createDb, grants, newId, orgMembers, sessions } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let sessionToken = "";
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "da_session" && sessionToken !== "" ? { value: sessionToken } : undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

const desk = await import("../server/platform-ops/club-actions");
const { createOrg } = await import("../server/orgs/orgs");
const { createCompetition } = await import("../server/competition/competitions");
const { purgeOrg } = await import("../server/test-support/purge-org");

const ownerHandle = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const owner = ownerHandle.db;

const RUN = String(Date.now()).slice(-6);
const phoneOf = (n: number): string => `+917${RUN}${String(n).padStart(3, "0")}`;
const ids: string[] = [];
let orgId = "";
let slug = "";
let seasonId = "";
let superadmin = "";
let founder = "";
let helper = "";

const REASON = "Posture proof of the club roles desk";

async function person(name: string, n: number): Promise<string> {
  const id = newId();
  await ownerHandle.sql`insert into people (id, name, phone) values (${id}, ${name}, ${phoneOf(n)})`;
  ids.push(id);
  return id;
}

async function holds(personId: string, set: string): Promise<boolean> {
  const rows = await owner
    .select({ id: grants.id })
    .from(grants)
    .where(
      and(
        eq(grants.personId, personId),
        eq(grants.scopeId, orgId),
        eq(grants.capabilitySet, set),
        isNull(grants.revokedAt),
      ),
    );
  return rows.length > 0;
}

beforeAll(async () => {
  superadmin = await person("Super Admin", 1);
  founder = await person("Club Founder", 2);
  helper = await person("Club Helper", 3);
  const org = await createOrg(owner, founder, `Desk Club ${RUN}`);
  orgId = org.id;
  slug = org.slug;
  const season = await createCompetition(owner, orgId, founder, {
    name: `Desk Season ${RUN}`,
    sport: "cricket",
    location: "Pune",
    startsOn: "2026-10-01",
    endsOn: "2026-11-30",
  });
  seasonId = season.id;
  await owner.insert(grants).values({
    id: newId(),
    personId: superadmin,
    scopeType: "platform",
    scopeId: "00000000000000000000000000",
    capabilitySet: "platform:superadmin",
    grantedBy: superadmin,
  });
  sessionToken = randomBytes(32).toString("base64url");
  await owner.insert(sessions).values({
    id: newId(),
    personId: superadmin,
    tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    steppedUpAt: new Date(),
  });
});

afterAll(async () => {
  if (orgId !== "") {
    await purgeOrg(owner, orgId);
  }
  for (const id of ids) {
    await ownerHandle.sql`delete from grants where person_id = ${id}`;
    await ownerHandle.sql`delete from sessions where person_id = ${id}`;
    await ownerHandle.sql`delete from audit_log where actor = ${id}`;
  }
  for (const id of ids) {
    await ownerHandle.sql`delete from people where id = ${id}`;
  }
  await ownerHandle.sql.end();
});

describe("the club roles desk under the production roles", () => {
  it("adds staff to a club support is not a member of — inside the club's boundary", async () => {
    expect(
      await desk.addClubRoleAction({
        slug,
        contact: phoneOf(3),
        role: "org:staff",
        reason: REASON,
      }),
    ).toMatchObject({ ok: true });
    expect(await holds(helper, "org:staff")).toBe(true);
    const member = await owner
      .select({ personId: orgMembers.personId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.personId, helper)));
    expect(member).toHaveLength(1);
    const audit = await owner
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.action, "admin.club.role_added"), eq(auditLog.scopeId, orgId)));
    expect(audit[0]?.meta).toMatchObject({ via: "admin", reason: REASON });
  });

  it("someone who never signed in gets the club's own invitation link", async () => {
    const result = await desk.addClubRoleAction({
      slug,
      contact: phoneOf(9),
      role: "org:owner",
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && "link" in result ? result.link : "").toMatch(/^\/join\//);
  });

  it("never removes the last owner", async () => {
    expect(
      await desk.removeClubRoleAction({
        slug,
        personId: founder,
        role: "org:owner",
        reason: REASON,
      }),
    ).toMatchObject({ ok: false });
    expect(await holds(founder, "org:owner")).toBe(true);
  });

  it("transfers ownership in one step, never leaving the club ownerless", async () => {
    expect(
      await desk.transferOwnershipAction({
        slug,
        fromPersonId: founder,
        toContact: phoneOf(3),
        reason: REASON,
      }),
    ).toMatchObject({ ok: true });
    expect(await holds(helper, "org:owner")).toBe(true);
    expect(await holds(founder, "org:owner")).toBe(false);
  });

  it("assigns and removes a season's auctioneer — members only", async () => {
    expect(
      await desk.setAuctioneerAction({
        slug,
        seasonId,
        personId: superadmin,
        assign: true,
        reason: REASON,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await desk.setAuctioneerAction({
        slug,
        seasonId,
        personId: founder,
        assign: true,
        reason: REASON,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await desk.setAuctioneerAction({
        slug,
        seasonId,
        personId: founder,
        assign: false,
        reason: REASON,
      }),
    ).toMatchObject({ ok: true });
  });

  it("nothing at all without a reason", async () => {
    expect(
      await desk.addClubRoleAction({ slug, contact: phoneOf(2), role: "org:staff", reason: "" }),
    ).toMatchObject({ ok: false });
  });
});
