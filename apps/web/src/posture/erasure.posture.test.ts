/**
 * RUNTIME POSTURE — account erasure, end to end, under the production roles.
 *
 * Erasure is the one act on this platform that crosses every club a person was
 * ever in, inside ONE transaction, switching `app.org_id` from club to club so
 * each club's policies admit its own rows and nothing else. Run as the database
 * owner that proves nothing — every policy is "visible" to the owner. So this
 * runs the real server actions as `desiauction_app`, and asserts on what the
 * owner can then see: what was deleted, what was anonymized, what was kept.
 */
import { createHash, randomBytes } from "node:crypto";

import { createDb, grants, newId, sessions } from "@desiauction/db";
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

const { requestErasureAction, withdrawErasureAction, myErasureRequest } =
  await import("../server/privacy/actions");
const { eraseAccountAction, declineErasureAction } =
  await import("../server/admin/erasure-actions");
const { erasureDesk } = await import("../server/privacy/desk");
const { createOrg } = await import("../server/orgs/orgs");
const { advanceCompetition, createCompetition } =
  await import("../server/competition/competitions");
const { submitRegistration } = await import("../server/competition/registrations");
const { purgeOrg } = await import("../server/test-support/purge-org");
const { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } = await import("../server/admin/capabilities");

const ownerHandle = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const owner = ownerHandle.db;
const sql = ownerHandle.sql;

const RUN = String(Date.now()).slice(-7);
const phone = (n: number): string => `+9196${RUN}${String(n).padStart(3, "0")}`;
const people: string[] = [];
const orgIds: string[] = [];

async function person(name: string, n: number, email: string | null = null): Promise<string> {
  const id = newId();
  await sql`insert into people (id, name, phone, email) values (${id}, ${name}, ${phone(n)}, ${email})`;
  people.push(id);
  return id;
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

async function askToBeErased(personId: string): Promise<string> {
  await signIn(personId);
  const form = new FormData();
  form.set("understood", "yes");
  form.set("reason", "I have stopped playing.");
  expect(await requestErasureAction({}, form)).toEqual({ filed: true });
  const request = await myErasureRequest();
  expect(request?.status).toBe("requested");
  return request?.id ?? "";
}

let operator = "";
let clubOwner = "";
let target = "";
let orgA = "";
let orgB = "";
let seasonA = "";
let reviewRequestId = "";
let problemReportId = "";

beforeAll(async () => {
  operator = await person("Privacy Operator", 1);
  await owner.insert(grants).values({
    id: newId(),
    personId: operator,
    scopeType: PLATFORM_SCOPE_TYPE,
    scopeId: PLATFORM_SCOPE_ID,
    capabilitySet: "platform:privacy",
    grantedBy: operator,
  });
  clubOwner = await person("Club Owner", 2);
  target = await person("Erase Me", 3, `erase.${RUN}@example.test`);

  const a = await createOrg(owner, clubOwner, `Erasure A ${RUN}`);
  const b = await createOrg(owner, clubOwner, `Erasure B ${RUN}`);
  orgA = a.id;
  orgB = b.id;
  orgIds.push(orgA, orgB);

  // In club A as a player, with a self-declared profile on the entry.
  let season = await createCompetition(owner, orgA, clubOwner, {
    name: `Erasure Season ${RUN}`,
    sport: "cricket",
    location: "Malad",
    startsOn: "2026-10-01",
    endsOn: "2026-11-30",
  });
  for (const to of ["setup", "registration_open"] as const) {
    const advanced = await advanceCompetition(owner, season, clubOwner, to);
    if (!advanced.ok) throw new Error(`advance ${to}`);
    season = { ...season, status: advanced.status };
  }
  seasonA = season.id;
  const entered = await submitRegistration(owner, seasonA, orgA, target, "batter", undefined, {
    dateOfBirth: "1995-04-02",
    battingStyle: "right_hand",
  });
  if (!entered.ok) throw new Error("registration");
  await sql`update registrations set jersey_name = 'ERASEME', note = 'lives near the ground'
            where person_id = ${target}`;

  // In club B as staff: a member with a grant, but not its owner.
  await sql`insert into org_members (org_id, person_id) values (${orgB}, ${target})`;
  await owner.insert(grants).values({
    id: newId(),
    personId: target,
    scopeType: "org",
    scopeId: orgB,
    capabilitySet: "org:staff",
    grantedBy: clubOwner,
  });
  // Their own profile rows, and consent they gave.
  await sql`insert into player_profiles (id, person_id, gender) values (${newId()}, ${target}, 'male')`;
  await sql`insert into consent_records (id, person_id, purpose, granted, source)
            values (${newId()}, ${target}, 'publication', true, 'registration')`;
  // What they told us (FR-1): a review we asked for and they wrote, and a
  // problem report with a way to answer them.
  reviewRequestId = newId();
  await sql`insert into review_requests (id, person_id, source, token_hash, expires_at)
            values (${reviewRequestId}, ${target}, 'manual_admin', ${`erasure-${RUN}`},
                    now() + interval '30 days')`;
  await sql`insert into reviews (id, request_id, person_id, rating, went_well)
            values (${newId()}, ${reviewRequestId}, ${target}, 5, 'ERASEME')`;
  problemReportId = newId();
  await sql`insert into problem_reports (id, person_id, reply_email, category, description, page_url)
            values (${problemReportId}, ${target}, ${`erase-${RUN}@example.test`}, 'bug',
                    'The board froze', '/home')`;
}, 60_000);

afterAll(async () => {
  for (const orgId of orgIds) {
    await purgeOrg(owner, orgId);
  }
  if (people.length > 0) {
    await sql`delete from problem_reports where person_id = any(${people})`;
    await sql`delete from review_requests where person_id = any(${people})`;
    await sql`delete from erasure_requests where person_id = any(${people})`;
    await sql`delete from consent_records where person_id = any(${people})`;
    await sql`delete from registrations where person_id = any(${people})`;
    await sql`delete from org_members where person_id = any(${people})`;
    await sql`delete from grants where person_id = any(${people})`;
    await sql`delete from audit_log where actor = any(${people}) or subject = any(${people})`;
    await sql`delete from sessions where person_id = any(${people})`;
    await sql`delete from player_profiles where person_id = any(${people})`;
    await sql`delete from people where id = any(${people})`;
  }
  await sql.end();
}, 60_000);

describe("POSTURE — erasure under the app role", () => {
  it("is refused to anyone without platform:privacy — the desk does not exist for them", async () => {
    const requestId = await askToBeErased(await person("Asker Zero", 10));
    await signIn(clubOwner);
    expect(await eraseAccountAction(requestId, "ERASE", "")).toEqual({
      ok: false,
      error: "Not available.",
    });
  });

  it("needs the typed confirmation, server-side", async () => {
    const requestId = await askToBeErased(await person("Asker One", 11));
    await signIn(operator);
    const refused = await eraseAccountAction(requestId, "erase please", "");
    expect(refused.ok).toBe(false);
  });

  it("deletes the profile, anonymizes the shared records, and keeps the evidence", async () => {
    const requestId = await askToBeErased(target);
    await signIn(operator);

    const desk = await erasureDesk(operator);
    const row = desk.open.find((entry) => entry.personId === target);
    expect(row?.blocked, "the desk refused an erasure that should go ahead").toBeNull();
    expect(row?.clubs).toBe(2);

    const result = await eraseAccountAction(requestId, "ERASE", "");
    expect(result, JSON.stringify(result)).toEqual({
      ok: true,
      message: "Account erased across 2 clubs.",
    });

    const [who] = await sql<
      { name: string | null; phone: string | null; email: string | null; erased: boolean }[]
    >`select name, phone, email, erased_at is not null as erased from people where id = ${target}`;
    expect(who).toEqual({ name: null, phone: null, email: null, erased: true });

    const [entry] = await sql<
      {
        dob: string | null;
        jersey: string | null;
        note: string | null;
        status: string;
        role: string;
      }[]
    >`select date_of_birth as dob, jersey_name as jersey, note, status, role
        from registrations where person_id = ${target}`;
    // The season's record survives; the person's details on it do not.
    expect(entry).toEqual({
      dob: null,
      jersey: null,
      note: null,
      status: "submitted",
      role: "batter",
    });

    expect((await sql`select 1 from sessions where person_id = ${target}`).length).toBe(0);
    expect((await sql`select 1 from player_profiles where person_id = ${target}`).length).toBe(0);
    expect(
      (await sql`select 1 from org_members where person_id = ${target} and org_id = ${orgB}`)
        .length,
    ).toBe(0);
    expect(
      (
        await sql`select 1 from grants where person_id = ${target} and scope_id = ${orgB}
                    and revoked_at is null`
      ).length,
    ).toBe(0);

    // Each club's timeline says it happened, written by the operator.
    const audits = await sql<{ scope_id: string; actor: string }[]>`
      select scope_id, actor from audit_log where action = 'person.erased' and subject = ${target}`;
    expect(new Set(audits.map((a) => a.scope_id))).toEqual(new Set([orgA, orgB]));
    expect(audits.every((a) => a.actor === operator)).toBe(true);

    // Consent is evidence: the grant stays, and a withdrawal is appended.
    const consents = await sql<{ granted: boolean }[]>`
      select granted from consent_records where person_id = ${target} and purpose = 'publication'
      order by created_at`;
    expect(consents.map((c) => c.granted)).toEqual([true, false]);

    const [request] = await sql<{ status: string; decided_by: string }[]>`
      select status, decided_by from erasure_requests where id = ${requestId}`;
    expect(request).toEqual({ status: "completed", decided_by: operator });

    // What they told us: the review goes with its request; the problem report
    // is about the platform and stays, without its way to reach them.
    expect((await sql`select 1 from review_requests where id = ${reviewRequestId}`).length).toBe(0);
    expect((await sql`select 1 from reviews where request_id = ${reviewRequestId}`).length).toBe(0);
    const [report] = await sql<{ reply_email: string | null; description: string }[]>`
      select reply_email, description from problem_reports where id = ${problemReportId}`;
    expect(report).toEqual({ reply_email: null, description: "The board froze" });
  });

  it("refuses the sole owner of a club rather than orphaning it", async () => {
    const soleOwner = await person("Sole Owner", 20);
    const org = await createOrg(owner, soleOwner, `Sole ${RUN}`);
    orgIds.push(org.id);
    const requestId = await askToBeErased(soleOwner);
    await signIn(operator);
    const result = await eraseAccountAction(requestId, "ERASE", "");
    expect(result.ok).toBe(false);
    const [still] = await sql<{ erased: boolean }[]>`
      select erased_at is not null as erased from people where id = ${soleOwner}`;
    expect(still?.erased, "a refused erasure changed something").toBe(false);
  });

  it("refuses a platform operator — their access is never ended as a side effect", async () => {
    const requestId = await askToBeErased(operator);
    const result = await eraseAccountAction(requestId, "ERASE", "");
    expect(result.ok).toBe(false);
    await withdrawErasureAction();
  });

  it("declines only with a reason, and the person reads it", async () => {
    const asker = await person("Declined Asker", 30);
    const requestId = await askToBeErased(asker);
    await signIn(operator);
    expect((await declineErasureAction(requestId, "   ")).ok).toBe(false);
    expect(
      (await declineErasureAction(requestId, "You owe your club a fee; settle it first.")).ok,
    ).toBe(true);
    await signIn(asker);
    const mine = await myErasureRequest();
    expect(mine?.status).toBe("declined");
    expect(mine?.decisionNote).toBe("You owe your club a fee; settle it first.");
  });

  it("can be withdrawn by the person until the desk acts", async () => {
    const asker = await person("Changed Mind", 40);
    await askToBeErased(asker);
    expect(await withdrawErasureAction()).toEqual({ ok: true });
    expect((await myErasureRequest())?.status).toBe("withdrawn");
  });
});
