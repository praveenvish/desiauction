/**
 * RUNTIME POSTURE — the console's cross-club reads, under the production roles.
 *
 * Eight modules used to read tenant data on the RLS-EXEMPT system pool once a
 * season was known: the home dashboard's money aggregates, the tournaments
 * index, the organizer's schedule, auction and roster lookups (posture-allowlist
 * "debt", PA-1R Phase 3.4). They now read inside each club's own boundary, on
 * `desiauction_app`, where the row-level policies do the fencing.
 *
 * Moving a read under RLS has exactly one way to fail quietly: a boundary that
 * names the wrong org — or none — returns NO ROWS, not an error. Every local
 * suite runs as the database owner, for whom every policy is "visible", so that
 * failure is invisible everywhere except here. These tests therefore assert on
 * DATA, not on the absence of an exception: the person must see the numbers of
 * both clubs they belong to, and none of the club they do not.
 *
 * The same run proves the consent defect found alongside it: self-registration
 * wrote its consent evidence through `desiauction_system`, which holds no INSERT
 * on `consent_records`, and a catch swallowed the refusal. Under this suite the
 * old code registers the player and records nothing.
 */
import { createHash, randomBytes } from "node:crypto";

import { createDb, newId, sessions } from "@desiauction/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ---- Next request context, stood in for -------------------------------------
// Server actions read the session from the cookie store. Outside a Next request
// there is none, so the store is supplied here — with a REAL session row, whose
// hash the app role resolves exactly as it does in production.
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

const { competitionsView, submitRegistrationAction, withdrawMyRegistrationAction } =
  await import("../server/competition/actions");
const { homeDashboard } = await import("../server/home/dashboard");
const { tournamentsView } = await import("../server/competition/tournament-actions");
const { organizerScheduleView } = await import("../server/competition/fixture-actions");
const { createOrg } = await import("../server/orgs/orgs");
const { advanceCompetition, createCompetition, createTeam, createTournament } =
  await import("../server/competition/competitions");
const { submitRegistration } = await import("../server/competition/registrations");
const { createFixture } = await import("../server/competition/fixture-aggregate");
const { purgeOrg } = await import("../server/test-support/purge-org");

// Fixtures and assertions run as the OWNER; the behaviour under test runs on the
// app pool the imported modules built from DATABASE_URL (desiauction_app).
const ownerHandle = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const owner = ownerHandle.db;

const RUN = String(Date.now()).slice(-7);
const phone = (n: number): string => `+9197${RUN}${String(n).padStart(3, "0")}`;

const people: string[] = [];
const orgIds: string[] = [];
const ORGS = { a: "", b: "", c: "" };
const SLUG = { openA: "" };

async function person(name: string, n: number): Promise<string> {
  const id = newId();
  await ownerHandle.sql`insert into people (id, name, phone) values (${id}, ${name}, ${phone(n)})`;
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

/** One club: a tournament, an open season in it, two teams, a fixture, registrations. */
async function club(
  ownerId: string,
  label: string,
  registrants: number,
): Promise<{ orgId: string; slug: string }> {
  const org = await createOrg(owner, ownerId, `Posture ${label} ${RUN}`);
  orgIds.push(org.id);
  const tournament = await createTournament(
    owner,
    org.id,
    ownerId,
    `Cup ${label} ${RUN}`,
    "cricket",
  );
  let season = await createCompetition(owner, org.id, ownerId, {
    name: `Season ${label} ${RUN}`,
    sport: "cricket",
    tournamentId: tournament.id,
    location: "Malad",
    startsOn: "2026-10-01",
    endsOn: "2026-11-30",
  });
  for (const to of ["setup", "registration_open"] as const) {
    const advanced = await advanceCompetition(owner, season, ownerId, to);
    if (!advanced.ok) {
      throw new Error(`could not advance ${label} to ${to}`);
    }
    season = { ...season, status: advanced.status };
  }
  const home = await createTeam(owner, org.id, season.id, ownerId, `${label} Home`);
  const away = await createTeam(owner, org.id, season.id, ownerId, `${label} Away`);
  if (!home.ok || !away.ok) {
    throw new Error("team creation failed");
  }
  const fixture = await createFixture(owner, season, ownerId, {
    homeTeamId: home.team.id,
    awayTeamId: away.team.id,
    kickoffAt: "2099-01-01T18:00",
  });
  if (!fixture.ok) {
    throw new Error("fixture creation failed");
  }
  for (let i = 0; i < registrants; i++) {
    const playerId = await person(`${label} player ${String(i)}`, 100 + orgIds.length * 10 + i);
    const entered = await submitRegistration(owner, season.id, org.id, playerId, "batter");
    if (!entered.ok) {
      throw new Error(`registration failed: ${entered.reason}`);
    }
  }
  return { orgId: org.id, slug: season.slug };
}

let viewer = "";
let outsider = "";

beforeAll(async () => {
  viewer = await person("Posture Viewer", 1);
  outsider = await person("Posture Outsider", 2);
  const a = await club(viewer, "A", 2);
  const b = await club(viewer, "B", 1);
  const c = await club(outsider, "C", 4);
  ORGS.a = a.orgId;
  ORGS.b = b.orgId;
  ORGS.c = c.orgId;
  SLUG.openA = a.slug;
}, 60_000);

afterAll(async () => {
  for (const orgId of orgIds) {
    await purgeOrg(owner, orgId);
  }
  if (people.length > 0) {
    await ownerHandle.sql`delete from consent_records where person_id = any(${people})`;
    await ownerHandle.sql`delete from registrations where person_id = any(${people})`;
    await ownerHandle.sql`delete from audit_log where actor = any(${people})`;
    await ownerHandle.sql`delete from sessions where person_id = any(${people})`;
    await ownerHandle.sql`delete from player_profiles where person_id = any(${people})`;
    await ownerHandle.sql`delete from people where id = any(${people})`;
  }
  await ownerHandle.sql.end();
}, 60_000);

describe("POSTURE — cross-club reads run inside each club's boundary, and still see", () => {
  it("the season list shows both of the viewer's clubs and none of the other", async () => {
    await signIn(viewer);
    const view = await competitionsView();
    const seen = new Set(view.competitions.map((season) => season.orgId));
    expect(seen.has(ORGS.a) && seen.has(ORGS.b), "a club the viewer belongs to vanished").toBe(
      true,
    );
    expect(seen.has(ORGS.c), "another club's season leaked into the list").toBe(false);
  });

  it("the home dashboard counts both clubs' registrations — not zero, not the other club's", async () => {
    await signIn(viewer);
    const dashboard = await homeDashboard();
    // A has 2, B has 1, C (not the viewer's) has 4. Zero would mean the org
    // boundaries hid everything; 7 would mean C leaked.
    expect(dashboard.stats.registrations).toBe(3);
    // Both seasons are open, so they sit in the registration stage…
    expect(dashboard.stages.registration.registered).toBe(3);
    // …and their teams are reported per season: two each, read under RLS.
    const teamCounts = Object.values(dashboard.counts).map((entry) => entry.teams);
    expect(teamCounts).toEqual([2, 2]);
    expect(dashboard.tournaments).toBe(2);
  });

  it("the tournaments index lists both clubs' tournaments with their real counts", async () => {
    await signIn(viewer);
    const view = await tournamentsView();
    const names = view.tournaments.map((tournament) => tournament.name);
    expect(names).toContain(`Cup A ${RUN}`);
    expect(names).toContain(`Cup B ${RUN}`);
    expect(names).not.toContain(`Cup C ${RUN}`);
    const seasons = view.tournaments.flatMap((tournament) => tournament.seasons);
    const seasonA = seasons.find((season) => season.slug === SLUG.openA);
    expect(seasonA?.counts.teams, "team counts came back empty under RLS").toBe(2);
    expect(seasonA?.counts.pending).toBe(2);
    expect(seasonA?.counts.matches).toBe(1);
  });

  it("the organizer schedule merges both clubs' fixtures and nothing else", async () => {
    await signIn(viewer);
    const schedule = await organizerScheduleView();
    const clubs = new Set(schedule.map((fixture) => fixture.competitionName));
    expect(clubs.has(`Season A ${RUN}`) && clubs.has(`Season B ${RUN}`)).toBe(true);
    expect(clubs.has(`Season C ${RUN}`)).toBe(false);
  });
});

describe("POSTURE — self-registration records consent under the app role", () => {
  it("writes publication, SMS and guardian consent WITH the registration", async () => {
    const minor = await person("Posture Minor", 50);
    await signIn(minor);
    const form = new FormData();
    form.set("role", "batter");
    form.set("dateOfBirth", "2014-06-01");
    form.set("guardianName", "Posture Guardian");
    form.set("guardianConsent", "true");
    form.set("guardianConsentText", "I am the guardian and I consent.");
    form.set("publicationConsent", "true");
    form.set("publicationConsentText", "I understand what becomes public.");
    const result = await submitRegistrationAction(SLUG.openA, {}, form);
    expect(result, JSON.stringify(result)).toEqual({ done: true });

    const rows = await ownerHandle.sql<{ purpose: string }[]>`
      select purpose from consent_records where person_id = ${minor} order by purpose`;
    expect(
      rows.map((row) => row.purpose),
      "a registration committed with no consent on record — the system pool cannot write consent_records",
    ).toEqual(["guardian.consent", "publication", "sms.transactional"]);
  });

  it("lets that player withdraw, reading the auction lock inside the season's boundary", async () => {
    const player = await person("Posture Withdrawer", 51);
    await signIn(player);
    const form = new FormData();
    form.set("role", "batter");
    form.set("publicationConsent", "true");
    expect(await submitRegistrationAction(SLUG.openA, {}, form)).toEqual({ done: true });
    expect(await withdrawMyRegistrationAction(SLUG.openA)).toMatchObject({ ok: true });
  });
});
