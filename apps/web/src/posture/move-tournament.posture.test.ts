/**
 * RUNTIME POSTURE — moving a tournament to another club (migration 0108),
 * under the production roles.
 *
 * The one cross-club write in the product. The app role cannot rewrite a
 * row's club (every org policy checks the same predicate both ways), so the
 * move is a SECURITY DEFINER function. What has to hold under the real roles:
 * the superadmin's move lands in full — tournament, season, team, auction,
 * audit rows in BOTH clubs, team people made members of the new club; the
 * function refuses a caller without the superadmin grant even though the app
 * role may EXECUTE it; and a running auction blocks the move.
 */
import { createHash, randomBytes } from "node:crypto";

import {
  auctions,
  auditLog,
  competitions,
  createDb,
  grants,
  fixtures,
  matches,
  matchEvents,
  matchPlayerLines,
  matchAwards,
  ballFacts,
  matchConfirmations,
  teamEntries,
  registrations,
  matchLiveState,
  teamManagers,
  fixtureOfficials,
  fixtureParticipants,
  newId,
  orgMembers,
  sessions,
  teams,
  tournaments,
} from "@desiauction/db";
import { and, eq, sql } from "drizzle-orm";
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
const { inOrg, asPerson } = await import("../server/tenant");

const ownerHandle = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const owner = ownerHandle.db;

const RUN = String(Date.now()).slice(-6);
const phoneOf = (n: number): string => `+916${RUN}${String(n).padStart(3, "0")}`;
const ids: string[] = [];
const orgIds: string[] = [];
let fromSlug = "";
let toId = "";
let toSlug = "";
let fromId = "";
let tournamentId = "";
let seasonId = "";
let teamId = "";
let auctionId = "";
let fixtureId = "";
let scorerAwardId = "";
let otherSeasonId = "";
let originalEntries: (typeof teamEntries.$inferSelect)[] = [];
let superadmin = "";
let founder = "";
let teamOwner = "";

const REASON = "Posture proof of the tournament move";

async function person(name: string, n: number): Promise<string> {
  const id = newId();
  await ownerHandle.sql`insert into people (id, name, phone) values (${id}, ${name}, ${phoneOf(n)})`;
  ids.push(id);
  return id;
}

async function assertC42Unmoved() {
  for (const table of [ballFacts, matchConfirmations]) {
    expect(
      await owner
        .select({ orgId: table.orgId })
        .from(table)
        .where(eq(table.competitionId, seasonId)),
    ).toEqual([{ orgId: fromId }]);
  }
  expect(
    await owner
      .select()
      .from(teamEntries)
      .where(eq(teamEntries.competitionId, seasonId))
      .orderBy(teamEntries.id),
  ).toEqual(originalEntries);
}

beforeAll(async () => {
  superadmin = await person("Super Admin", 1);
  founder = await person("Club Founder", 2);
  teamOwner = await person("Team Owner", 3);
  const from = await createOrg(owner, founder, `Move From ${RUN}`);
  const to = await createOrg(owner, founder, `Move To ${RUN}`);
  orgIds.push(from.id, to.id);
  fromId = from.id;
  fromSlug = from.slug;
  toId = to.id;
  toSlug = to.slug;

  tournamentId = newId();
  await owner.insert(tournaments).values({
    id: tournamentId,
    orgId: fromId,
    sport: "cricket",
    name: `Move League ${RUN}`,
    slug: `move-league-${RUN}-${tournamentId.slice(-4).toLowerCase()}`,
    createdBy: founder,
  });
  const season = await createCompetition(owner, fromId, founder, {
    name: `Move Season ${RUN}`,
    sport: "cricket",
    location: "Pune",
    startsOn: "2026-10-01",
    endsOn: "2026-11-30",
  });
  seasonId = season.id;
  await owner.update(competitions).set({ tournamentId }).where(eq(competitions.id, seasonId));
  teamId = newId();
  await owner.insert(teams).values({
    id: teamId,
    orgId: fromId,
    competitionId: seasonId,
    name: `Move Strikers ${RUN}`,
    createdBy: founder,
  });
  await owner.insert(grants).values({
    id: newId(),
    personId: teamOwner,
    scopeType: "team",
    scopeId: teamId,
    capabilitySet: "team:owner",
    grantedBy: founder,
  });
  auctionId = newId();
  await owner.insert(auctions).values({
    id: auctionId,
    orgId: fromId,
    competitionId: seasonId,
    name: "Move auction",
    config: {},
    createdBy: founder,
  });

  fixtureId = newId();
  await owner.insert(fixtures).values({
    id: fixtureId,
    orgId: fromId,
    competitionId: seasonId,
    fixtureNumber: "LS1-MOVE-F001",
    seq: 1,
    createdBy: founder,
  });
  await owner.insert(matches).values({
    fixtureId,
    orgId: fromId,
    competitionId: seasonId,
    format: { key: "t20" },
    awardVersion: "cricket-v1/t20",
    shareToken: `move-${fixtureId}`,
  });
  await owner.insert(matchEvents).values({
    fixtureId,
    orgId: fromId,
    competitionId: seasonId,
    eventId: newId(),
    seq: 1,
    attempt: 1,
    type: "match_started",
    payload: {},
    actorPersonId: founder,
    clientSeq: 1,
    clientRecordedAt: new Date(),
  });
  await owner
    .insert(matchLiveState)
    .values({ fixtureId, orgId: fromId, competitionId: seasonId, seq: 1, state: { v: 1 } });
  const registrationId = newId();
  await owner.insert(registrations).values({
    id: registrationId,
    orgId: fromId,
    competitionId: seasonId,
    teamId,
    personId: teamOwner,
    status: "approved",
    registrationNumber: "LS1-MOVE-R001",
  });
  await owner.insert(matchPlayerLines).values({
    fixtureId,
    registrationId,
    orgId: fromId,
    competitionId: seasonId,
    teamId,
    sport: "cricket",
    formatKey: "t20",
    conditions: {},
    stats: { registrationId, teamId, appeared: true },
    points: "0.00",
    pointsLines: [],
    trustLevel: "self_scored",
  });
  await owner.insert(fixtureParticipants).values({
    fixtureId,
    teamId,
    orgId: fromId,
    competitionId: seasonId,
    placement: 1,
    score: { kills: 7 },
    source: "scored",
  });
  await owner.insert(matchAwards).values({
    id: newId(),
    fixtureId,
    orgId: fromId,
    competitionId: seasonId,
    scope: "match",
    kind: "player_of_match",
    computedRegistrationId: registrationId,
    winnerRegistrationId: registrationId,
    source: "auto",
    score: "0.00",
  });
  scorerAwardId = newId();
  await owner.insert(matchAwards).values({
    id: scorerAwardId,
    orgId: fromId,
    competitionId: seasonId,
    scope: "season",
    kind: "scorer_of_season",
    computedPersonId: founder,
    winnerPersonId: founder,
    source: "auto",
    score: "1.00",
  });
  await owner.insert(ballFacts).values({
    fixtureId,
    seq: 1,
    orgId: fromId,
    competitionId: seasonId,
    inningsNo: 1,
    overNo: 1,
    ballInOver: 1,
    legal: true,
    phase: "powerplay",
    batterId: registrationId,
    bowlerId: registrationId,
    runsBat: 2,
    extras: 0,
    trustLevel: "self_scored",
    formatKey: "t20",
  });
  await owner.insert(matchConfirmations).values({
    id: newId(),
    fixtureId,
    orgId: fromId,
    competitionId: seasonId,
    teamId,
    personId: teamOwner,
    verdict: "confirmed",
    note: "Preserve confirmation evidence",
  });
  for (const status of ["submitted", "approved", "rejected"] as const) {
    await owner.insert(teamEntries).values({
      id: newId(),
      orgId: fromId,
      competitionId: seasonId,
      teamName: `Move ${status}`,
      captainPersonId: teamOwner,
      players: [{ name: "Captain" }, { name: "Player" }],
      status,
      reviewedBy: status === "submitted" ? null : founder,
      reviewedAt: status === "submitted" ? null : new Date("2026-10-01T00:00:00Z"),
    });
  }
  originalEntries = await owner
    .select()
    .from(teamEntries)
    .where(eq(teamEntries.competitionId, seasonId))
    .orderBy(teamEntries.id);
  const otherSeason = await createCompetition(owner, fromId, founder, {
    name: `Unrelated entry season ${RUN}`,
    sport: "cricket",
    location: "Pune",
  });
  otherSeasonId = otherSeason.id;
  await owner.insert(teamEntries).values({
    id: newId(),
    orgId: fromId,
    competitionId: otherSeasonId,
    teamName: "Unrelated entry",
    captainPersonId: teamOwner,
    players: [{ name: "Unrelated captain" }],
    status: "submitted",
  });
  await owner.insert(teamManagers).values({
    id: newId(),
    teamId,
    orgId: fromId,
    competitionId: seasonId,
    personId: teamOwner,
    role: "manager",
    source: "auction_owner",
    createdBy: founder,
  });
  await owner.insert(fixtureOfficials).values({
    id: newId(),
    fixtureId,
    orgId: fromId,
    competitionId: seasonId,
    role: "scorer",
    personId: founder,
    displayName: "Scorer",
    createdBy: founder,
  });

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
  for (const id of orgIds) {
    await purgeOrg(owner, id);
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

describe("moving a tournament to another club under the production roles", () => {
  it("preserves the eight-argument security-definer function signature", async () => {
    const rows = await ownerHandle.sql<{ pronargs: number; prosecdef: boolean }[]>`
      select pronargs, prosecdef from pg_proc where oid='platform_move_tournament(character,character,character,text,character,character,character,text)'::regprocedure`;
    expect(rows).toEqual([{ pronargs: 8, prosecdef: true }]);
  });

  it("refuses a caller without the superadmin grant, though the app role may EXECUTE", async () => {
    await expect(
      inOrg(founder, fromId, (tx) =>
        tx.execute(
          sql`select platform_move_tournament(${tournamentId}, ${null}, ${toId}, ${REASON}, ${newId()}, ${newId()}, ${null}, ${null})`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "P0001", message: "move_not_superadmin" } });
    const [row] = await owner
      .select({ orgId: competitions.orgId })
      .from(competitions)
      .where(eq(competitions.id, seasonId));
    expect(row?.orgId).toBe(fromId);
    await assertC42Unmoved();
  });

  it("refuses while the auction is live, and moves nothing", async () => {
    await owner.update(auctions).set({ status: "live" }).where(eq(auctions.id, auctionId));
    const desked = await desk.adminMoveDesk(fromSlug);
    expect(desked?.subjects.find((row) => row.id === tournamentId)?.blocked).toMatch(/live/);
    const result = await desk.moveTournamentAction({
      slug: fromSlug,
      subjectKind: "tournament",
      subjectId: tournamentId,
      targetSlug: toSlug,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false });
    const [row] = await owner
      .select({ orgId: teams.orgId })
      .from(teams)
      .where(eq(teams.id, teamId));
    expect(row?.orgId).toBe(fromId);
    await assertC42Unmoved();
    await owner.update(auctions).set({ status: "scheduled" }).where(eq(auctions.id, auctionId));
  });

  it("allows person-only fact reads without granting projection mutation", async () => {
    const [fact] = await owner.select().from(ballFacts).where(eq(ballFacts.fixtureId, fixtureId));
    if (!fact) throw new Error("Missing seeded fact");
    const own = await asPerson(teamOwner, (tx) =>
      tx.select().from(ballFacts).where(eq(ballFacts.fixtureId, fixtureId)),
    );
    expect(own).toEqual([fact]);
    expect(
      await asPerson(founder, (tx) =>
        tx.select().from(ballFacts).where(eq(ballFacts.fixtureId, fixtureId)),
      ),
    ).toEqual([]);
    expect(
      await asPerson(teamOwner, (tx) =>
        tx
          .update(ballFacts)
          .set({ runsBat: 99 })
          .where(eq(ballFacts.fixtureId, fixtureId))
          .returning(),
      ),
    ).toEqual([]);
    expect(
      await asPerson(teamOwner, (tx) =>
        tx.delete(ballFacts).where(eq(ballFacts.fixtureId, fixtureId)).returning(),
      ),
    ).toEqual([]);
    await expect(
      asPerson(teamOwner, (tx) => tx.insert(ballFacts).values({ ...fact, seq: 2 })),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    expect(await owner.select().from(ballFacts).where(eq(ballFacts.fixtureId, fixtureId))).toEqual([
      fact,
    ]);
  });

  it("rolls back all new projections and entries when the move transaction aborts", async () => {
    await expect(
      inOrg(superadmin, fromId, async (tx) => {
        await tx.execute(
          sql`select platform_move_tournament(${tournamentId}, ${null}, ${toId}, ${REASON}, ${newId()}, ${newId()}, ${null}, ${null})`,
        );
        throw new Error("deliberate_move_rollback");
      }),
    ).rejects.toThrow("deliberate_move_rollback");
    for (const table of [ballFacts, matchConfirmations]) {
      expect(
        await owner
          .select({ orgId: table.orgId })
          .from(table)
          .where(eq(table.competitionId, seasonId)),
      ).toEqual([{ orgId: fromId }]);
    }
    expect(
      await owner
        .select()
        .from(teamEntries)
        .where(eq(teamEntries.competitionId, seasonId))
        .orderBy(teamEntries.id),
    ).toEqual(originalEntries);
  });

  it("moves the tournament with its season, team and auction, and audits both clubs", async () => {
    const result = await desk.moveTournamentAction({
      slug: fromSlug,
      subjectKind: "tournament",
      subjectId: tournamentId,
      targetSlug: toSlug,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: true, targetSlug: toSlug });

    const [t] = await owner
      .select({ orgId: tournaments.orgId })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId));
    const [c] = await owner
      .select({ orgId: competitions.orgId })
      .from(competitions)
      .where(eq(competitions.id, seasonId));
    const [team] = await owner
      .select({ orgId: teams.orgId })
      .from(teams)
      .where(eq(teams.id, teamId));
    const [a] = await owner
      .select({ orgId: auctions.orgId })
      .from(auctions)
      .where(eq(auctions.id, auctionId));
    expect([t?.orgId, c?.orgId, team?.orgId, a?.orgId]).toEqual([toId, toId, toId, toId]);
    for (const table of [
      matches,
      matchEvents,
      fixtureParticipants,
      matchLiveState,
      matchPlayerLines,
      matchAwards,
      ballFacts,
      matchConfirmations,
      teamManagers,
      fixtureOfficials,
    ]) {
      const rows = await owner
        .select({ orgId: table.orgId })
        .from(table)
        .where(eq(table.competitionId, seasonId));
      const expectedRows = Array.from({ length: table === matchAwards ? 2 : 1 }, () => ({
        orgId: toId,
      }));
      expect(rows).toEqual(expectedRows);
      const visible = await inOrg(founder, toId, (tx) =>
        tx.select({ orgId: table.orgId }).from(table).where(eq(table.competitionId, seasonId)),
      );
      expect(visible).toEqual(expectedRows);
      const hidden = await inOrg(founder, fromId, (tx) =>
        tx.select({ orgId: table.orgId }).from(table).where(eq(table.competitionId, seasonId)),
      );
      expect(hidden).toEqual([]);
    }

    expect(
      await inOrg(founder, toId, (tx) =>
        tx
          .select({ source: fixtureParticipants.source, score: fixtureParticipants.score })
          .from(fixtureParticipants)
          .where(eq(fixtureParticipants.fixtureId, fixtureId)),
      ),
    ).toEqual([{ source: "scored", score: { kills: 7 } }]);
    expect(
      await inOrg(founder, fromId, (tx) =>
        tx.select().from(fixtureParticipants).where(eq(fixtureParticipants.fixtureId, fixtureId)),
      ),
    ).toEqual([]);
    const [movedScorerAward] = await owner
      .select()
      .from(matchAwards)
      .where(eq(matchAwards.id, scorerAwardId));
    expect(movedScorerAward).toMatchObject({
      orgId: toId,
      computedPersonId: founder,
      winnerPersonId: founder,
      computedRegistrationId: null,
      winnerRegistrationId: null,
      scope: "season",
      kind: "scorer_of_season",
    });
    const movedEntries = await owner
      .select()
      .from(teamEntries)
      .where(eq(teamEntries.competitionId, seasonId))
      .orderBy(teamEntries.id);
    expect(movedEntries).toEqual(originalEntries.map((row) => ({ ...row, orgId: toId })));
    const entryIds = async (personId: string, orgId: string) =>
      inOrg(personId, orgId, (tx) =>
        tx
          .select({ id: teamEntries.id })
          .from(teamEntries)
          .where(eq(teamEntries.competitionId, seasonId))
          .orderBy(teamEntries.id),
      );
    expect(await entryIds(founder, toId)).toEqual(originalEntries.map(({ id }) => ({ id })));
    expect(await entryIds(founder, fromId)).toEqual([]);
    const captainRows = await asPerson(teamOwner, (tx) =>
      tx
        .select()
        .from(teamEntries)
        .where(eq(teamEntries.competitionId, seasonId))
        .orderBy(teamEntries.id),
    );
    expect(captainRows).toEqual(movedEntries);
    const unrelated = await owner
      .select({ orgId: teamEntries.orgId })
      .from(teamEntries)
      .where(eq(teamEntries.competitionId, otherSeasonId));
    expect(unrelated).toEqual([{ orgId: fromId }]);

    const member = await owner
      .select({ personId: orgMembers.personId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, toId), eq(orgMembers.personId, teamOwner)));
    expect(member).toHaveLength(1);

    const audits = await owner
      .select({ action: auditLog.action, scopeId: auditLog.scopeId })
      .from(auditLog)
      .where(and(eq(auditLog.actor, superadmin), eq(auditLog.subject, tournamentId)));
    expect(audits).toEqual(
      expect.arrayContaining([
        { action: "org.tournament_moved_out", scopeId: fromId },
        { action: "org.tournament_moved_in", scopeId: toId },
      ]),
    );

    // The new club's own boundary now sees the season; the old one does not.
    const seen = await inOrg(founder, toId, (tx) =>
      tx.select({ id: competitions.id }).from(competitions).where(eq(competitions.id, seasonId)),
    );
    expect(seen).toHaveLength(1);
    const gone = await inOrg(founder, fromId, (tx) =>
      tx.select({ id: competitions.id }).from(competitions).where(eq(competitions.id, seasonId)),
    );
    expect(gone).toHaveLength(0);
  });

  it("a superadmin starts a club from admin and owns it", async () => {
    const result = await desk.createClubAction({ name: `Admin Club ${RUN}`, reason: REASON });
    expect(result).toMatchObject({ ok: true });
    const slug = result.ok ? (result as { slug?: string }).slug : undefined;
    expect(slug).toBeDefined();
    const [org] = await ownerHandle.sql<{ id: string }[]>`
      select id from organizations where slug = ${slug ?? ""}`;
    expect(org).toBeDefined();
    orgIds.push(org?.id ?? "");
    const owns = await owner
      .select({ id: grants.id })
      .from(grants)
      .where(
        and(
          eq(grants.personId, superadmin),
          eq(grants.scopeId, org?.id ?? ""),
          eq(grants.capabilitySet, "org:owner"),
        ),
      );
    expect(owns).toHaveLength(1);
  });

  it("moves ONE season of a tournament; the tournament and its other seasons stay", async () => {
    const leagueId = newId();
    await owner.insert(tournaments).values({
      id: leagueId,
      orgId: fromId,
      sport: "cricket",
      name: `Split League ${RUN}`,
      slug: `split-league-${RUN}-${leagueId.slice(-4).toLowerCase()}`,
      createdBy: founder,
    });
    const season = async (name: string): Promise<string> => {
      const made = await createCompetition(owner, fromId, founder, {
        name,
        sport: "cricket",
        location: "Pune",
        startsOn: "2026-10-01",
        endsOn: "2026-11-30",
      });
      await owner
        .update(competitions)
        .set({ tournamentId: leagueId })
        .where(eq(competitions.id, made.id));
      return made.id;
    };
    const older = await season(`Split One ${RUN}`);
    const fourth = await season(`Split Four ${RUN}`);
    const fifth = await season(`Split Five ${RUN}`);

    const desked = await desk.adminMoveDesk(fromSlug);
    const row = desked?.subjects.find((subject) => subject.id === fourth);
    expect(row).toMatchObject({ kind: "season", partOf: `Split League ${RUN}`, blocked: null });

    const moved = await desk.moveTournamentAction({
      slug: fromSlug,
      subjectKind: "season",
      subjectId: fourth,
      targetSlug: toSlug,
      reason: REASON,
    });
    expect(moved).toMatchObject({ ok: true });
    expect(moved.ok ? moved.message : "").toMatch(/was created in/);

    const where = async (id: string) => {
      const [found] = await owner
        .select({ orgId: competitions.orgId, tournamentId: competitions.tournamentId })
        .from(competitions)
        .where(eq(competitions.id, id));
      return found;
    };
    const [league] = await owner
      .select({ orgId: tournaments.orgId })
      .from(tournaments)
      .where(eq(tournaments.id, leagueId));
    expect(league?.orgId).toBe(fromId);
    expect(await where(older)).toEqual({ orgId: fromId, tournamentId: leagueId });

    const after = await where(fourth);
    expect(after?.orgId).toBe(toId);
    expect(after?.tournamentId).not.toBe(leagueId);
    const [made] = await owner
      .select({ orgId: tournaments.orgId, name: tournaments.name })
      .from(tournaments)
      .where(eq(tournaments.id, after?.tournamentId ?? ""));
    expect(made).toEqual({ orgId: toId, name: `Split League ${RUN}` });

    // The next edition joins the same tournament in the new club, not a third.
    const again = await desk.moveTournamentAction({
      slug: fromSlug,
      subjectKind: "season",
      subjectId: fifth,
      targetSlug: toSlug,
      reason: REASON,
    });
    expect(again).toMatchObject({ ok: true });
    expect(again.ok ? again.message : "").toMatch(/joined/);
    expect((await where(fifth))?.tournamentId).toBe(after?.tournamentId);
  });
});
