/**
 * RUNTIME POSTURE — the platform desks that WRITE, under the production roles.
 *
 * Two desks change a club's season from outside the club: billing answers a
 * pass request (the season's tier), moderation takes a public page down (its
 * visibility). A platform operator is a member of no club, and the obvious way
 * to write for them — the RLS-exempt system pool — is a platform-READ role with
 * no UPDATE on `competitions` or `pass_upgrade_requests`. The pass desk was
 * written that way and passed every suite, because every suite ran as the
 * owner; under the real roles each answer failed with "permission denied".
 *
 * So both desks are proved here as `desiauction_app` inside the season's own
 * tenant boundary, and what they did is read back as the owner.
 */
import { createHash, randomBytes } from "node:crypto";

import { createDb, grants, newId, passUpgradeRequests, sessions } from "@desiauction/db";
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
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { takeDownSeason, liftSeasonHoldAction } = await import("../server/admin/moderation-actions");
const { answerPassRequest } = await import("../server/admin/pass-actions");
const { setCompetitionVisibilityAction, seasonOverviewView } =
  await import("../server/competition/actions");
const { publicCompetitionView } = await import("../server/competition/public");
const { createOrg } = await import("../server/orgs/orgs");
const { advanceCompetition, createCompetition } =
  await import("../server/competition/competitions");
const { purgeOrg } = await import("../server/test-support/purge-org");
const { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } = await import("../server/admin/capabilities");

const ownerHandle = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const owner = ownerHandle.db;
const sql = ownerHandle.sql;

const RUN = String(Date.now()).slice(-7);
const phone = (n: number): string => `+9195${RUN}${String(n).padStart(3, "0")}`;
const people: string[] = [];
let orgId = "";
let slug = "";
let moderator = "";
let biller = "";
let organizer = "";

async function person(name: string, n: number): Promise<string> {
  const id = newId();
  await sql`insert into people (id, name, phone) values (${id}, ${name}, ${phone(n)})`;
  people.push(id);
  return id;
}

async function platformGrant(personId: string, set: string): Promise<void> {
  await owner.insert(grants).values({
    id: newId(),
    personId,
    scopeType: PLATFORM_SCOPE_TYPE,
    scopeId: PLATFORM_SCOPE_ID,
    capabilitySet: set,
    grantedBy: personId,
  });
}

async function signIn(personId: string): Promise<void> {
  sessionToken = randomBytes(32).toString("base64url");
  await owner.insert(sessions).values({
    id: newId(),
    personId,
    tokenHash: createHash("sha256").update(sessionToken).digest("hex"),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

async function season(): Promise<{
  visibility: string;
  held: boolean;
  reason: string | null;
  tier: string;
}> {
  const [row] = await sql<
    { visibility: string; held: boolean; reason: string | null; tier: string }[]
  >`select visibility, platform_hold_at is not null as held, platform_hold_reason as reason, tier
      from competitions where slug = ${slug}`;
  if (row === undefined) {
    throw new Error("season vanished");
  }
  return row;
}

beforeAll(async () => {
  moderator = await person("Moderation Operator", 1);
  await platformGrant(moderator, "platform:moderation");
  biller = await person("Billing Operator", 2);
  await platformGrant(biller, "platform:billing");
  organizer = await person("Club Organizer", 3);

  const org = await createOrg(owner, organizer, `Desks ${RUN}`);
  orgId = org.id;
  let created = await createCompetition(owner, orgId, organizer, {
    name: `Desks Season ${RUN}`,
    sport: "cricket",
    location: "Andheri",
    startsOn: "2026-11-01",
    endsOn: "2026-11-30",
  });
  for (const to of ["setup", "registration_open"] as const) {
    const advanced = await advanceCompetition(owner, created, organizer, to);
    if (!advanced.ok) throw new Error(`advance ${to}`);
    created = { ...created, status: advanced.status };
  }
  slug = created.slug;
  // Published by its organizer, through the real action, as the app role.
  await signIn(organizer);
  expect(await setCompetitionVisibilityAction(slug, "public")).toEqual({ ok: true });
  expect((await season()).visibility).toBe("public");
}, 60_000);

afterAll(async () => {
  if (orgId !== "") {
    await sql`delete from pass_upgrade_requests where org_id = ${orgId}`;
    await purgeOrg(owner, orgId);
  }
  if (people.length > 0) {
    await sql`delete from grants where person_id = any(${people})`;
    await sql`delete from sessions where person_id = any(${people})`;
    await sql`delete from audit_log where actor = any(${people})`;
    await sql`delete from org_members where person_id = any(${people})`;
    await sql`delete from people where id = any(${people})`;
  }
  await sql.end();
}, 60_000);

describe("POSTURE — the moderation desk under the app role", () => {
  it("does not exist for anyone without platform:moderation — not even the club's own owner", async () => {
    await signIn(organizer);
    expect(await takeDownSeason(slug, "Offensive season name on the public page")).toEqual({
      ok: false,
      error: "Not available.",
    });
    await signIn(biller);
    expect((await takeDownSeason(slug, "Offensive season name on the public page")).ok).toBe(false);
    expect((await season()).visibility).toBe("public");
  });

  it("refuses a take-down without a reason the organizer can read", async () => {
    await signIn(moderator);
    const refused = await takeDownSeason(slug, "  bad  ");
    expect(refused.ok).toBe(false);
    expect((await season()).held).toBe(false);
  });

  it("takes the page off the public web, and says why on the club's own timeline", async () => {
    await signIn(moderator);
    const result = await takeDownSeason(slug, "Offensive season name on the public page");
    expect(result.ok, JSON.stringify(result)).toBe(true);

    expect(await season()).toMatchObject({
      visibility: "private",
      held: true,
      reason: "Offensive season name on the public page",
    });
    // The public page is gone for a stranger.
    expect(await publicCompetitionView(slug)).toBeNull();
    const [audit] = await sql<{ scope_id: string; meta: { wasPublic: boolean } }[]>`
      select scope_id, meta from audit_log
       where action = 'competition.platform_held' and actor = ${moderator}`;
    expect(audit?.scope_id).toBe(orgId);
    expect(audit?.meta.wasPublic).toBe(true);
  });

  it("the organizer cannot publish it again, and is told why in their own console", async () => {
    await signIn(organizer);
    const refused = await setCompetitionVisibilityAction(slug, "public");
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("DesiAuction took this page down");
    expect(refused.error).toContain("Offensive season name on the public page");

    const view = await seasonOverviewView(slug);
    expect(view?.platformHold?.reason).toBe("Offensive season name on the public page");
    expect(view?.publishBlockers[0]?.code).toBe("platform_hold");
  });

  it("the database refuses a held season going public, whatever path tries", async () => {
    await expect(
      sql`update competitions set visibility = 'public' where slug = ${slug}`,
    ).rejects.toThrow(/competitions_platform_hold_private_check/);
  });

  it("lifting hands the decision back without republishing", async () => {
    await signIn(moderator);
    const lifted = await liftSeasonHoldAction(slug, "Organizer renamed the season");
    expect(lifted.ok, JSON.stringify(lifted)).toBe(true);
    expect(await season()).toMatchObject({ visibility: "private", held: false, reason: null });

    await signIn(organizer);
    expect(await setCompetitionVisibilityAction(slug, "public")).toEqual({ ok: true });
    expect((await season()).visibility).toBe("public");
  });
});

describe("POSTURE — the pass desk under the app role", () => {
  it("answers a pass request — the write that used to fail with permission denied", async () => {
    const [row] = await sql<{ id: string; tier: "free" | "pro" | "association" }[]>`
      select id, tier from competitions where slug = ${slug}`;
    await owner.insert(passUpgradeRequests).values({
      id: newId(),
      orgId,
      competitionId: row?.id ?? "",
      fromTier: row?.tier ?? "free",
      requestedTier: "pro",
      requestedBy: organizer,
    });

    await signIn(moderator);
    expect((await answerPassRequest(slug, "granted", "")).ok).toBe(false);

    await signIn(biller);
    const answered = await answerPassRequest(slug, "granted", "Welcome to Pro");
    expect(answered.ok, JSON.stringify(answered)).toBe(true);
    expect((await season()).tier).toBe("pro");
    const [request] = await sql<{ outcome: string | null; resolved_by: string | null }[]>`
      select outcome, resolved_by from pass_upgrade_requests where org_id = ${orgId}`;
    expect(request).toEqual({ outcome: "granted", resolved_by: biller });
  });
});
