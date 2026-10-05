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
const { inOrg } = await import("../server/tenant");

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
  it("refuses a caller without the superadmin grant, though the app role may EXECUTE", async () => {
    await expect(
      inOrg(founder, fromId, (tx) =>
        tx.execute(
          sql`select platform_move_tournament(${tournamentId}, ${null}, ${toId}, ${REASON}, ${newId()}, ${newId()})`,
        ),
      ),
    ).rejects.toThrow();
    const [row] = await owner
      .select({ orgId: competitions.orgId })
      .from(competitions)
      .where(eq(competitions.id, seasonId));
    expect(row?.orgId).toBe(fromId);
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
    await owner.update(auctions).set({ status: "scheduled" }).where(eq(auctions.id, auctionId));
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
