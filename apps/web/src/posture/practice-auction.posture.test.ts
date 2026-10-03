/**
 * RUNTIME POSTURE — the practice auction (0101), under the production roles.
 *
 * Starting a practice is a web-tier write: the organiser's server action makes
 * the auction row, its sample lots, the copied paddle grants and paddles, and
 * their events, inside the club's own boundary on `desiauction_app`. Every
 * local suite runs as the database owner, for whom every row-level policy is
 * "visible" — so a policy that refused one of those inserts would only show up
 * here, or in production on the night before an auction. This proves the
 * action works under RLS, that a club member who does not run the season
 * cannot start one, and that a stranger's club cannot see it.
 */
import { createHash, randomBytes } from "node:crypto";

import { auctions, createDb, lots, newId, paddles, registrations, sessions } from "@desiauction/db";
import { DEFAULT_AUCTION_CONFIG, registrationNumber } from "@desiauction/core";
import { and, eq } from "drizzle-orm";
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
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => undefined,
}));

const { startPracticeAction, practiceCardView } =
  await import("../server/auction/practice-actions");
const { createOrg } = await import("../server/orgs/orgs");
const { advanceCompetition, createCompetition, createTeam } =
  await import("../server/competition/competitions");
const { createAuction } = await import("@desiauction/auction");
const { auctionReady } = await import("../server/auction/auction-ready");
const { purgeOrg } = await import("../server/test-support/purge-org");

const ownerHandle = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const owner = ownerHandle.db;

const RUN = String(Date.now()).slice(-7);
const phone = (n: number): string => `+9198${RUN}${String(n).padStart(3, "0")}`;
const people: string[] = [];
const orgIds: string[] = [];
let organiser = "";
let outsider = "";
let slug = "";
let competitionId = "";

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

beforeAll(async () => {
  organiser = await person("Practice organiser", 1);
  outsider = await person("Other club owner", 2);
  const org = await createOrg(owner, organiser, `Practice Posture ${RUN}`);
  orgIds.push(org.id);
  orgIds.push((await createOrg(owner, outsider, `Other Posture ${RUN}`)).id);
  let season = await createCompetition(owner, org.id, organiser, {
    name: `Practice Season ${RUN}`,
    sport: "cricket",
    location: "Pune",
    startsOn: "2026-10-01",
    endsOn: "2026-11-30",
  });
  for (const to of ["setup", "registration_open"] as const) {
    const advanced = await advanceCompetition(owner, season, organiser, to);
    if (!advanced.ok) throw new Error(`could not advance to ${to}`);
    season = { ...season, status: advanced.status };
  }
  for (const name of ["Home", "Away"]) {
    const team = await createTeam(owner, org.id, season.id, organiser, `${name} ${RUN}`);
    if (!team.ok) throw new Error("team creation failed");
  }
  for (let i = 0; i < 4; i++) {
    const playerId = await person(`Player ${String(i)}`, 10 + i);
    const id = newId();
    await owner.insert(registrations).values({
      id,
      orgId: org.id,
      competitionId: season.id,
      personId: playerId,
      role: "batter",
      status: "approved",
      registrationNumber: registrationNumber(id),
    });
  }
  const closed = await advanceCompetition(owner, season, organiser, "registration_closed");
  if (!closed.ok) throw new Error("could not close registration");
  season = { ...season, status: closed.status };
  const created = await createAuction(
    owner,
    season,
    await auctionReady(owner, season),
    organiser,
    DEFAULT_AUCTION_CONFIG,
  );
  if (!created.ok) throw new Error("auction creation failed");
  slug = season.slug;
  competitionId = season.id;
});

afterAll(async () => {
  for (const orgId of orgIds) {
    await purgeOrg(owner, orgId);
  }
  for (const id of people) {
    await ownerHandle.sql`delete from sessions where person_id = ${id}`;
    await ownerHandle.sql`delete from audit_log where actor = ${id}`;
    await ownerHandle.sql`delete from people where id = ${id}`;
  }
  await ownerHandle.sql.end();
});

describe("the practice auction under the production roles", () => {
  it("a club member who does not run the season cannot start or see it", async () => {
    await signIn(outsider);
    expect(await practiceCardView(slug)).toBeNull();
    expect(await startPracticeAction(slug, 2)).toMatchObject({ ok: false });
    const made = await owner
      .select({ id: auctions.id })
      .from(auctions)
      .where(and(eq(auctions.competitionId, competitionId), eq(auctions.kind, "practice")));
    expect(made).toHaveLength(0);
  });

  it("the organiser starts one inside the club's boundary on desiauction_app", async () => {
    await signIn(organiser);
    expect(await startPracticeAction(slug, 2)).toEqual({ ok: true });
    const [practice] = await owner
      .select({ id: auctions.id, kind: auctions.kind, status: auctions.status })
      .from(auctions)
      .where(and(eq(auctions.competitionId, competitionId), eq(auctions.kind, "practice")));
    expect(practice).toMatchObject({ kind: "practice", status: "scheduled" });
    const practiceLots = await owner
      .select({ id: lots.id })
      .from(lots)
      .where(eq(lots.auctionId, practice?.id ?? ""));
    // 2 teams x 2 + 2 = 6 wanted; the season has 4 players.
    expect(practiceLots).toHaveLength(4);
    const held = await owner
      .select({ id: paddles.id })
      .from(paddles)
      .where(eq(paddles.auctionId, practice?.id ?? ""));
    expect(held).toHaveLength(2);
    const card = await practiceCardView(slug);
    expect(card?.practice).toMatchObject({ status: "scheduled", perTeam: 2, lotCount: 4 });
  });

  it("a second Start is refused in words, not a database error", async () => {
    expect(await startPracticeAction(slug, 3)).toMatchObject({
      ok: false,
      error: "A practice is already set up for this season.",
    });
  });
});
