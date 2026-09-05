// PERMANENT COMPETITION REGRESSION SUITE (M-IP3-1). Encodes the domain contract
// of the Competition subsystem: capability enforcement, the registration
// machine, the duplicate rule, and RLS read+write isolation on every new table.
// Real Postgres; unique phones/orgs per run; the RLS proofs run under a
// dedicated non-superuser role mirroring production (the RC-4 discipline).
import {
  auditLog,
  auctionEvents as auctionEventsTable,
  auctions as auctionsTable,
  competitions as competitionsTable,
  createDb,
  franchises as franchisesTable,
  grants as grantsTable,
  newId,
  organizations,
  orgMembers,
  passUpgradeRequests as passUpgradeRequestsTable,
  otpCodes,
  otpInbox,
  people,
  registrations as registrationsTable,
  tournaments as tournamentsTable,
  sessions,
  teams as teamsTable,
  withTenantDb,
  type DbHandle,
} from "@desiauction/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_AUCTION_CONFIG } from "@desiauction/core";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { createOrg } from "../orgs/orgs";
import { canCompetition, requireCompetitionCapability } from "./authz";
import { resolvePassRequest } from "./pass-grant";
import { publicCompetitionsDirectory, publicShowcase } from "./public";
import {
  advanceCompetition,
  cloneCompetition,
  createCompetition,
  createTeam,
  resolveCompetition,
  tournamentsOf,
  createTournament,
  setTeamCoach,
  teamsOf,
} from "./competitions";
import { registrationsOf, submitRegistration } from "./registrations";
import { transition, transitionBatch } from "./registration-aggregate";
import { ForbiddenError } from "../orgs/authz";
import { outcomesProjection } from "../admin/views";
import { purgeOrg } from "../test-support/purge-org";

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
  // PA-1R Phase 3: the spine these teardowns never deleted (purge-org.ts).
  for (const purgeId of orgIds) {
    await purgeOrg(db, purgeId);
  }
  if (orgIds.length > 0) {
    await db
      .delete(passUpgradeRequestsTable)
      .where(inArray(passUpgradeRequestsTable.orgId, orgIds));
    await db.delete(registrationsTable).where(inArray(registrationsTable.orgId, orgIds));
    await db.delete(teamsTable).where(inArray(teamsTable.orgId, orgIds));
    await db.delete(franchisesTable).where(inArray(franchisesTable.orgId, orgIds));
    await db.delete(auctionEventsTable).where(inArray(auctionEventsTable.orgId, orgIds));
    await db.delete(auctionsTable).where(inArray(auctionsTable.orgId, orgIds));
    await db.delete(competitionsTable).where(inArray(competitionsTable.orgId, orgIds));
    await db.delete(tournamentsTable).where(inArray(tournamentsTable.orgId, orgIds));
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

describe("TIER LIMITS — the ceiling the pricing page has always described", () => {
  /*
   * "Up to 4 teams and 40 players" has been on the pricing page since PX-10 and
   * nothing in the platform knew it. The answer chosen was BLOCK, not warn — so
   * these tests are the contract: the fourth team is fine, the fifth is not,
   * and a season on the beta grant never meets a ceiling at all.
   */
  const freeSeason = async (name: string) => {
    const competition = await createCompetition(db, orgX.id, owner, {
      sport: "cricket",
      name: `${name} ${RUN}`,
    });
    await db
      .update(competitionsTable)
      .set({ tier: "free" })
      .where(eq(competitionsTable.id, competition.id));
    return competition;
  };

  it("lets a Free season fill its four teams, then refuses the fifth", async () => {
    const competition = await freeSeason("Ceiling");
    for (let n = 1; n <= 4; n += 1) {
      const created = await createTeam(db, orgX.id, competition.id, owner, `Team ${String(n)}`);
      expect(created.ok, `team ${String(n)} should be allowed`).toBe(true);
    }
    const fifth = await createTeam(db, orgX.id, competition.id, owner, "Team 5");
    expect(fifth.ok).toBe(false);
    if (fifth.ok) return;
    expect(fifth.reason).toBe("tier_limit");
    // The refusal is a sentence, not an enum — this is what the organizer reads.
    const message = (fifth as { message?: string }).message ?? "";
    expect(message).toContain("up to 4 teams");
    expect(message).toContain("Upgrade");
  });

  it("counts what is already there, so the ceiling cannot be walked around", async () => {
    const competition = await freeSeason("Counted");
    for (const name of ["Alpha", "Bravo", "Charlie", "Delta"]) {
      await createTeam(db, orgX.id, competition.id, owner, name);
    }
    expect((await createTeam(db, orgX.id, competition.id, owner, "Echo")).ok).toBe(false);
    const teamRows = await db
      .select({ id: teamsTable.id })
      .from(teamsTable)
      .where(eq(teamsTable.competitionId, competition.id));
    expect(teamRows).toHaveLength(4);
  });

  it("refuses the forty-first approval, and only at approval", async () => {
    const competition = await freeSeason("Pool");
    await db
      .update(competitionsTable)
      .set({ status: "registration_open" })
      .where(eq(competitionsTable.id, competition.id));
    // Forty distinct people, because one registration per person per season is
    // itself a rule — the ceiling has to be reached the way a real season
    // reaches it.
    const poolPeople = Array.from({ length: 40 }, (_, n) => ({
      id: newId(),
      phone: `+9190${RUN}${String(n).padStart(2, "0")}`,
      name: `Pool Player ${String(n)}`,
    }));
    await db.insert(people).values(poolPeople);
    await db.insert(registrationsTable).values(
      poolPeople.map((person, n) => ({
        id: newId(),
        orgId: orgX.id,
        competitionId: competition.id,
        personId: person.id,
        role: "batter" as const,
        status: "approved" as const,
        registrationNumber: `PL${RUN.slice(-3)}${String(n).padStart(3, "0")}`,
      })),
    );

    // One more person applies — which must still be allowed. A season filling
    // up is the organizer's commercial problem, not the player's.
    const applied = await submitRegistration(db, competition.id, orgX.id, player, "bowler");
    expect(applied.ok, "a player may always apply").toBe(true);
    if (!applied.ok) {
      return;
    }
    // Approving them is the act that costs, and it is refused.
    const approved = await transition(db, orgX.id, competition.id, applied.registrationId, owner, {
      type: "approve",
    });
    expect(approved.ok).toBe(false);
    if (approved.ok) {
      return;
    }
    expect(approved.reason).toBe("tier_limit");
    expect((approved as { message?: string }).message ?? "").toContain("up to 40 players");

    await db.delete(registrationsTable).where(eq(registrationsTable.competitionId, competition.id));
    await db.delete(people).where(
      inArray(
        people.id,
        poolPeople.map((person) => person.id),
      ),
    );
  });

  it("BULK approve cannot walk around the pool ceiling the single approval enforces", async () => {
    /*
     * The single-approval path checked the ceiling; its batch twin did not, so
     * an organizer who selected the whole triage list and hit "approve" sailed
     * a Free season straight past forty. The batch must behave exactly like N
     * single approvals: fill the remaining room, refuse the rest.
     */
    const competition = await freeSeason("Bulk");
    await db
      .update(competitionsTable)
      .set({ status: "registration_open" })
      .where(eq(competitionsTable.id, competition.id));

    // 38 already approved: two seats left under the Free ceiling of 40.
    const seated = Array.from({ length: 38 }, (_, n) => ({
      id: newId(),
      phone: `+9192${RUN}${String(n).padStart(2, "0")}`,
      name: `Seated ${String(n)}`,
    }));
    // 5 pending, so the batch is asked for more than the room that remains.
    const pending = Array.from({ length: 5 }, (_, n) => ({
      id: newId(),
      phone: `+9193${RUN}${String(n).padStart(2, "0")}`,
      name: `Pending ${String(n)}`,
    }));
    await db.insert(people).values([...seated, ...pending]);
    const pendingIds = pending.map(() => newId());
    await db.insert(registrationsTable).values([
      ...seated.map((person, n) => ({
        id: newId(),
        orgId: orgX.id,
        competitionId: competition.id,
        personId: person.id,
        role: "batter" as const,
        status: "approved" as const,
        registrationNumber: `BA${RUN.slice(-3)}${String(n).padStart(3, "0")}`,
      })),
      ...pending.map((person, n) => ({
        id: pendingIds[n] as string,
        orgId: orgX.id,
        competitionId: competition.id,
        personId: person.id,
        role: "bowler" as const,
        status: "submitted" as const,
        registrationNumber: `BP${RUN.slice(-3)}${String(n).padStart(3, "0")}`,
      })),
    ]);

    const result = await transitionBatch(db, orgX.id, competition.id, pendingIds, owner, {
      type: "approve",
    });

    // Exactly the two that fit, and the other three refused for the tier.
    expect(result.applied).toHaveLength(2);
    expect(result.skipped.filter((s) => s.reason === "tier_limit")).toHaveLength(3);

    // The database agrees: the pool sits ON the ceiling, never above it.
    const [{ count: approvedNow } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.competitionId, competition.id),
          eq(registrationsTable.status, "approved"),
        ),
      );
    expect(approvedNow).toBe(40);

    await db.delete(registrationsTable).where(eq(registrationsTable.competitionId, competition.id));
    await db.delete(people).where(
      inArray(
        people.id,
        [...seated, ...pending].map((person) => person.id),
      ),
    );
  });

  it("allows exactly one open upgrade request per season, and another once answered", async () => {
    /*
     * The refusal says "upgrade the season's pass"; 0028 is where that goes.
     * The partial unique index is the whole rule: a season may ask again after
     * it has been answered, but it cannot queue three asks while one is open —
     * which is what an organizer hitting the ceiling repeatedly would otherwise
     * do, and what would make the queue unreadable for whoever answers it.
     */
    const competition = await freeSeason("Upgrade");
    const ask = (id: string) =>
      db.insert(passUpgradeRequestsTable).values({
        id,
        orgId: orgX.id,
        competitionId: competition.id,
        fromTier: "free" as const,
        requestedTier: "pro" as const,
        requestedBy: owner,
      });

    const first = newId();
    await ask(first);
    await expect(ask(newId())).rejects.toThrow();

    // Answered — and the season may ask again.
    await db
      .update(passUpgradeRequestsTable)
      .set({ resolvedAt: new Date(), resolvedBy: owner, outcome: "granted" })
      .where(eq(passUpgradeRequestsTable.id, first));
    await expect(ask(newId())).resolves.toBeDefined();

    // The answered one still explains what it moved them from.
    const rows = await db
      .select({
        fromTier: passUpgradeRequestsTable.fromTier,
        outcome: passUpgradeRequestsTable.outcome,
      })
      .from(passUpgradeRequestsTable)
      .where(eq(passUpgradeRequestsTable.id, first));
    expect(rows[0]).toEqual({ fromTier: "free", outcome: "granted" });

    await db
      .delete(passUpgradeRequestsTable)
      .where(eq(passUpgradeRequestsTable.competitionId, competition.id));
  });

  it("granting a request moves the tier, closes the request and lifts the ceiling", async () => {
    const competition = await freeSeason("Granted");
    for (const name of ["Alpha", "Bravo", "Charlie", "Delta"]) {
      await createTeam(db, orgX.id, competition.id, owner, name);
    }
    expect((await createTeam(db, orgX.id, competition.id, owner, "Echo")).ok).toBe(false);

    await db.insert(passUpgradeRequestsTable).values({
      id: newId(),
      orgId: orgX.id,
      competitionId: competition.id,
      fromTier: "free" as const,
      requestedTier: "pro" as const,
      requestedBy: owner,
    });

    const granted = await resolvePassRequest(db, {
      slug: competition.slug,
      outcome: "granted",
      actorId: owner,
    });
    expect(granted).toEqual({
      ok: true,
      slug: competition.slug,
      fromTier: "free",
      toTier: "pro",
      outcome: "granted",
    });

    // The ceiling moved with it — this is the whole point of the round trip.
    expect((await createTeam(db, orgX.id, competition.id, owner, "Echo")).ok).toBe(true);

    // The request is answered, so the season may ask again if it outgrows Pro.
    const [row] = await db
      .select({
        outcome: passUpgradeRequestsTable.outcome,
        resolvedBy: passUpgradeRequestsTable.resolvedBy,
      })
      .from(passUpgradeRequestsTable)
      .where(eq(passUpgradeRequestsTable.competitionId, competition.id));
    expect(row).toEqual({ outcome: "granted", resolvedBy: owner });

    await db
      .delete(passUpgradeRequestsTable)
      .where(eq(passUpgradeRequestsTable.competitionId, competition.id));
  });

  it("declining answers the request and leaves the tier exactly where it was", async () => {
    const competition = await freeSeason("Declined");
    await db.insert(passUpgradeRequestsTable).values({
      id: newId(),
      orgId: orgX.id,
      competitionId: competition.id,
      fromTier: "free" as const,
      requestedTier: "association" as const,
      requestedBy: owner,
    });
    const declined = await resolvePassRequest(db, {
      slug: competition.slug,
      outcome: "declined",
      actorId: owner,
      note: "beta grant already covers this season",
    });
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.toTier).toBe("free");

    const [season] = await db
      .select({ tier: competitionsTable.tier })
      .from(competitionsTable)
      .where(eq(competitionsTable.id, competition.id));
    expect(season?.tier).toBe("free");
    // A decline is an ANSWER: the organizer's card must stop saying "we're on it".
    const [row] = await db
      .select({ outcome: passUpgradeRequestsTable.outcome })
      .from(passUpgradeRequestsTable)
      .where(eq(passUpgradeRequestsTable.competitionId, competition.id));
    expect(row?.outcome).toBe("declined");

    await db
      .delete(passUpgradeRequestsTable)
      .where(eq(passUpgradeRequestsTable.competitionId, competition.id));
  });

  it("refuses to answer a season with nothing open, rather than inventing a change", async () => {
    const competition = await freeSeason("Nothing");
    expect(
      await resolvePassRequest(db, {
        slug: competition.slug,
        outcome: "granted",
        actorId: owner,
      }),
    ).toEqual(expect.objectContaining({ ok: false, reason: "no_open_request" }));
    expect(
      await resolvePassRequest(db, { slug: "no-such-season", outcome: "granted", actorId: owner }),
    ).toEqual(expect.objectContaining({ ok: false, reason: "unknown_season" }));
  });

  it("never blocks a season created during beta — that promise is on the page", async () => {
    // createCompetition stamps BETA_TIER, so this is the default path today.
    const competition = await createCompetition(db, orgX.id, owner, {
      sport: "cricket",
      name: `Beta ${RUN}`,
    });
    for (let n = 1; n <= 6; n += 1) {
      expect(
        (await createTeam(db, orgX.id, competition.id, owner, `Beta Team ${String(n)}`)).ok,
      ).toBe(true);
    }
  });
});

describe('PUBLIC DIRECTORY — "live" means something is happening', () => {
  /*
   * `live` was `auction.status in ('live','paused')` and nothing else, so an
   * auction opened and never closed — a laptop that died, a night abandoned, a
   * test run — announced itself as LIVE NOW on the public directory for ever.
   * Measured on a dev database: 33 published seasons claiming to be live, the
   * newest of them silent for three days, and the default sort putting all 33
   * above anything genuinely live.
   *
   * The event log already knew. These three cases are the whole rule.
   */
  const seed = async (name: string, status: "live" | "paused", lastEventAgeMs: number | null) => {
    const competition = await createCompetition(db, orgX.id, owner, {
      sport: "cricket",
      name: `${name} ${RUN}`,
    });
    await db
      .update(competitionsTable)
      .set({ visibility: "public" })
      .where(eq(competitionsTable.id, competition.id));
    const auctionId = newId();
    await db.insert(auctionsTable).values({
      id: auctionId,
      orgId: orgX.id,
      competitionId: competition.id,
      name: `${name} auction`,
      status,
      config: DEFAULT_AUCTION_CONFIG,
      createdBy: owner,
    });
    if (lastEventAgeMs !== null) {
      await db.insert(auctionEventsTable).values({
        id: newId(),
        orgId: orgX.id,
        auctionId,
        seq: 1,
        type: "AuctionOpened",
        atMs: Date.now() - lastEventAgeMs,
        actor: owner,
        correlationId: newId(),
        payload: {},
      });
    }
    return competition;
  };

  const liveFlagOf = async (slug: string) => {
    const page = await publicCompetitionsDirectory({ q: RUN, page: 1 });
    return page.entries.find((entry) => entry.slug === slug)?.live;
  };

  it("a live auction that spoke a minute ago IS live", async () => {
    const c = await seed("Fresh", "live", 60_000);
    expect(await liveFlagOf(c.slug)).toBe(true);
  });

  it("a live auction silent for three days is NOT live", async () => {
    const c = await seed("Stalled", "live", 3 * 24 * 60 * 60 * 1000);
    expect(await liveFlagOf(c.slug)).toBe(false);
  });

  it("a live auction that never emitted an event is NOT live", async () => {
    const c = await seed("Silent", "live", null);
    expect(await liveFlagOf(c.slug)).toBe(false);
  });

  it("a PAUSED auction mid-night is still live — a break is not an abandonment", async () => {
    const c = await seed("Paused", "paused", 30 * 60 * 1000);
    expect(await liveFlagOf(c.slug)).toBe(true);
  });

  it("the facet count agrees with the badges, because it is the same test", async () => {
    const page = await publicCompetitionsDirectory({ q: RUN, page: 1 });
    expect(page.counts.live).toBe(page.entries.filter((entry) => entry.live).length);
  });
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

  it("creates a tournament and a competition; the competition starts in draft", async () => {
    const tournament = await createTournament(db, orgX.id, owner, `Tournament ${RUN}`, "cricket");
    expect((await tournamentsOf(db, orgX.id)).map((t) => t.id)).toContain(tournament.id);
    const competition = await createCompetition(db, orgX.id, owner, {
      sport: "cricket",
      name: `MPL ${RUN}`,
      tournamentId: tournament.id,
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
    const bare = await createCompetition(db, orgX.id, owner, {
      sport: "cricket",
      name: `Bare ${RUN}`,
    });
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

  it("clones a competition into a fresh draft — team shells + coach carry over, the player pool does NOT (retention)", async () => {
    const src = await createCompetition(db, orgX.id, owner, {
      sport: "cricket",
      name: `Malad League ${RUN} 2026`,
      location: "Malad",
      startsOn: "2026-08-01",
      endsOn: "2026-08-15",
    });
    // Open registration and seed a real player into the SOURCE pool.
    let source = must(await resolveCompetition(db, owner, src.slug), "source");
    expect((await advanceCompetition(db, source, owner, "setup")).ok).toBe(true);
    source = must(await resolveCompetition(db, owner, src.slug), "source");
    expect((await advanceCompetition(db, source, owner, "registration_open")).ok).toBe(true);
    source = must(await resolveCompetition(db, owner, src.slug), "source");
    await createTeam(db, orgX.id, source.id, owner, `Alpha ${RUN}`, "ALP", "#ff0000");
    const beta = await createTeam(
      db,
      orgX.id,
      source.id,
      owner,
      `Beta ${RUN}`,
      undefined,
      "#00ff00",
    );
    if (beta.ok) {
      await setTeamCoach(db, orgX.id, source.id, beta.team.id, "Coach Bob", owner);
    }
    await submitRegistration(db, source.id, orgX.id, player, "batter");
    const sourceTeams = await teamsOf(db, source.id);

    const cloned = await cloneCompetition(db, orgX.id, owner, source, sourceTeams);

    // A fresh DRAFT with the season year bumped and dates reset.
    expect(cloned.competition.status).toBe("draft");
    expect(cloned.competition.id).not.toBe(source.id);
    expect(cloned.competition.name).toBe(`Malad League ${RUN} 2027`);
    expect(cloned.competition.location).toBe("Malad");
    expect(cloned.competition.startsOn).toBeNull();
    // Team shells (incl. coach) carried; the player pool did not.
    expect(cloned.teamsCloned).toBe(2);
    const newTeams = await teamsOf(db, cloned.competition.id);
    expect(newTeams.map((t) => t.name).sort()).toEqual([`Alpha ${RUN}`, `Beta ${RUN}`].sort());
    expect(newTeams.find((t) => t.name === `Beta ${RUN}`)?.coachName).toBe("Coach Bob");
    expect(await registrationsOf(db, cloned.competition.id)).toHaveLength(0);
    expect((await registrationsOf(db, source.id)).length).toBeGreaterThan(0);
    // The clone is audited against the new competition.
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.subject, cloned.competition.id));
    expect(audit.some((a) => a.action === "competition.cloned")).toBe(true);

    // PI-1 P6: the clone is the moment a team becomes a FRANCHISE — source and
    // clone rows now share one durable identity, created on first clone and
    // back-linked onto the source (so the FIRST edition joins the family too).
    const sourceRows = await db
      .select({ name: teamsTable.name, franchiseId: teamsTable.franchiseId })
      .from(teamsTable)
      .where(eq(teamsTable.competitionId, source.id));
    const cloneRows = await db
      .select({ name: teamsTable.name, franchiseId: teamsTable.franchiseId })
      .from(teamsTable)
      .where(eq(teamsTable.competitionId, cloned.competition.id));
    for (const sourceRow of sourceRows) {
      expect(sourceRow.franchiseId).not.toBeNull();
      expect(cloneRows.find((t) => t.name === sourceRow.name)?.franchiseId).toBe(
        sourceRow.franchiseId,
      );
    }
    // Distinct teams stay distinct franchises.
    expect(new Set(sourceRows.map((t) => t.franchiseId)).size).toBe(sourceRows.length);
  });

  it("the outcomes projection reads live audit events back (Outcome Governance)", async () => {
    // The suite created competitions, teams and a clone above; the projection
    // aggregates them from the audit log (cross-tenant, like the admin console).
    const outcomes = await outcomesProjection(db, 3650);
    expect(outcomes.competitionsCreated).toBeGreaterThanOrEqual(1);
    expect(outcomes.competitionsCloned).toBeGreaterThanOrEqual(1);
    expect(outcomes.teamsCreated).toBeGreaterThanOrEqual(1);
    expect(outcomes.orgsCreating).toBeGreaterThanOrEqual(1);
    // A clone is also a creation, so creations ≥ clones; rates are well-formed.
    expect(outcomes.competitionsCreated).toBeGreaterThanOrEqual(outcomes.competitionsCloned);
    expect(outcomes.repeatOrgRate).toBeGreaterThanOrEqual(0);
    expect(outcomes.repeatOrgRate).toBeLessThanOrEqual(1);
    expect(outcomes.cloneAdoptionRate).toBeGreaterThan(0);
  });

  it("attributes a registration to its share source — audit meta + projection (Outcome Governance)", async () => {
    const c = await createCompetition(db, orgX.id, owner, {
      sport: "cricket",
      name: `Attrib ${RUN}`,
      location: "Malad",
      startsOn: "2026-08-01",
      endsOn: "2026-08-15",
    });
    let comp = must(await resolveCompetition(db, owner, c.slug), "attrib comp");
    expect((await advanceCompetition(db, comp, owner, "setup")).ok).toBe(true);
    comp = must(await resolveCompetition(db, owner, c.slug), "attrib comp");
    expect((await advanceCompetition(db, comp, owner, "registration_open")).ok).toBe(true);
    comp = must(await resolveCompetition(db, owner, c.slug), "attrib comp");

    const res = await submitRegistration(
      db,
      comp.id,
      orgX.id,
      player,
      "batter",
      undefined,
      undefined,
      "whatsapp",
    );
    expect(res.ok).toBe(true);
    const registrationId = res.ok ? res.registrationId : "";

    // The write bounds + records the source in the audit meta.
    const [auditRow] = await db.select().from(auditLog).where(eq(auditLog.subject, registrationId));
    expect((auditRow?.meta as { source?: string } | null)?.source).toBe("whatsapp");

    // The projection reads it back, grouped by source (SQL meta->>'source' → core fold).
    const outcomes = await outcomesProjection(db, 3650);
    expect(outcomes.registrationsBySource.whatsapp ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("team names are unique within a competition", async () => {
    const first = await createTeam(db, orgX.id, compId, owner, "Malad Mavericks");
    expect(first.ok).toBe(true);
    const dup = await createTeam(db, orgX.id, compId, owner, "Malad Mavericks");
    expect(dup).toEqual({ ok: false, reason: "duplicate_name" });
    expect((await teamsOf(db, compId)).length).toBe(1);
  });

  it("DA-03: a refused duplicate leaves the TENANT TRANSACTION usable", async () => {
    // The bug this encodes: every serving path runs inside withTenantDb, and a
    // failed statement aborts the whole Postgres transaction. Catching the JS
    // error returned a clean refusal and then the COMMIT threw a raw
    // PostgresError past every handler into the error boundary — the duplicate
    // team name took the entire grid down. Calling createTeam on a bare handle
    // (as the test above does) never crosses that boundary, which is exactly
    // why the suite stayed green while production crashed.
    const outcome = await withTenantDb(handle, { personId: owner, orgId: orgX.id }, async (tx) => {
      const refused = await createTeam(tx, orgX.id, compId, owner, "Malad Mavericks");
      // The transaction must still be alive after the refusal.
      const stillWorks = await createTeam(tx, orgX.id, compId, owner, "Malad Mavericks II");
      return { refused, stillWorks };
    });
    expect(outcome.refused).toEqual({ ok: false, reason: "duplicate_name" });
    expect(outcome.stillWorks.ok).toBe(true);
    expect((await teamsOf(db, compId)).length).toBe(2);
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
    const badReject = await transition(db, orgX.id, compId, reg.id, owner, {
      type: "reject",
      reason: "nonsense" as never,
    });
    expect(badReject).toEqual({ ok: false, reason: "reason_required" });
    // Approve is legal from submitted.
    const approve = await transition(db, orgX.id, compId, reg.id, owner, {
      type: "approve",
    });
    expect(approve).toEqual({ ok: true, status: "approved" });
    // Approving again is an illegal transition (approved is not re-approvable).
    const again = await transition(db, orgX.id, compId, reg.id, owner, { type: "approve" });
    expect(again).toEqual({ ok: false, reason: "illegal_transition" });
  });

  it("registration only opens while intake is open (not before)", async () => {
    // orgY has a fresh draft competition — registration must be refused.
    const draft = await createCompetition(db, orgY.id, outsider, {
      sport: "cricket",
      name: `Draft ${RUN}`,
    });
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
      `grant select on tournaments, competitions, teams, registrations to ${role}`,
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

describe("PRR P0-2 — a minor's data is never on a public surface (DPDP §9)", () => {
  it("suppresses age and photo for an under-18 player, keeps them for an adult", async () => {
    const competition = await createCompetition(db, orgX.id, owner, {
      sport: "cricket",
      name: `Minors ${RUN}`,
    });
    await db
      .update(competitionsTable)
      .set({ visibility: "public" })
      .where(eq(competitionsTable.id, competition.id));

    // Two approved players, both with a photo AND photo consent on file, so the
    // ONLY thing that can withhold the minor's photo is the age gate itself.
    const minor = { id: newId(), phone: `+9193${RUN}01`, name: `Minor ${RUN}` };
    const adult = { id: newId(), phone: `+9193${RUN}02`, name: `Adult ${RUN}` };
    await db.insert(people).values([
      { ...minor, photoUrl: `k/${minor.id}.jpg`, photoConsentAt: new Date() },
      { ...adult, photoUrl: `k/${adult.id}.jpg`, photoConsentAt: new Date() },
    ]);
    await db.insert(registrationsTable).values([
      {
        id: newId(),
        orgId: orgX.id,
        competitionId: competition.id,
        personId: minor.id,
        role: "batter" as const,
        status: "approved" as const,
        registrationNumber: `MN${RUN.slice(-3)}001`,
        dateOfBirth: "2015-01-01", // ~11 in 2026
      },
      {
        id: newId(),
        orgId: orgX.id,
        competitionId: competition.id,
        personId: adult.id,
        role: "bowler" as const,
        status: "approved" as const,
        registrationNumber: `MN${RUN.slice(-3)}002`,
        dateOfBirth: "1995-01-01", // ~31 in 2026
      },
    ]);

    const pool = await publicShowcase(competition.slug);
    const minorRow = pool?.players.find((p) => p.name === minor.name);
    const adultRow = pool?.players.find((p) => p.name === adult.name);

    // The minor: no age, no photo — even though consent is on file.
    expect(minorRow?.age).toBeNull();
    expect(minorRow?.photoUrl).toBeNull();
    // The adult, as a control: age derived, photo published.
    expect(adultRow?.age).toBeGreaterThanOrEqual(30);
    expect(adultRow?.photoUrl).not.toBeNull();

    await db.delete(registrationsTable).where(eq(registrationsTable.competitionId, competition.id));
    await db.delete(people).where(inArray(people.id, [minor.id, adult.id]));
  });
});
