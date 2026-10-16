import { FORMAT_PRESETS } from "@desiauction/core/scoring";
import {
  auditLog,
  competitions,
  createDb,
  fixtureOfficials,
  fixtures,
  grants,
  matchEvents,
  matches,
  newId,
  organizations,
  people,
  teamManagers,
  teams,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../env";
import { handoverTenant } from "../competition/resolve";
import { systemDb } from "../db";
import { purgeOrg } from "../test-support/purge-org";
import { authorityKind } from "./authority";
import { claimScoring, resumeScoring } from "./claim";
import { issueHandover, redeemHandover, verifyHandoverToken } from "./handover";

const owner = createDb(env.DATABASE_URL);
const app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const orgId = newId(),
  competitionId = newId(),
  teamId = newId();
const awayTeamId = newId();
const actor = newId(),
  other = newId(),
  organizer = newId(),
  guest = newId(),
  guest2 = newId(),
  manager = newId();
const persons = [actor, other, organizer, guest, guest2, manager];
const now = new Date("2026-10-09T10:00:00.000Z");
const later = (ms: number) => new Date(now.getTime() + ms);
let seq = 0;
function tenant<T>(personId: string, run: (db: Db) => Promise<T>) {
  return withTenantDb(app, { personId, orgId }, run);
}
async function fixture(holder = actor, lastReceipt = now, malformed = false) {
  const id = newId();
  seq += 1;
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    homeTeamId: teamId,
    awayTeamId,
    fixtureNumber: `CLAIM-${String(seq)}`,
    seq,
    status: "in_progress",
    createdBy: actor,
  });
  await owner.db.insert(matches).values({
    fixtureId: id,
    orgId,
    competitionId,
    format: FORMAT_PRESETS.t20,
    awardVersion: "cricket-v1/t20",
    shareToken: newId(),
    scorerPersonId: holder,
    scorerDeviceId: "first",
    scorerClaimedAt: now,
    startedAt: now,
    updatedAt: now,
    lastSeq: 3,
  });
  const history = [
    {
      type: "match_started",
      payload: {
        format: FORMAT_PRESETS.t20,
        conditions: { timeOfDay: "day" },
        homeTeamId: teamId,
        awayTeamId,
      },
    },
    { type: "conditions_changed", payload: { conditions: { timeOfDay: "day_night" } } },
    { type: "conditions_changed", payload: { conditions: { timeOfDay: "night" } } },
  ];
  await owner.db.insert(matchEvents).values(
    history.map((entry, index) => {
      const n = index + 1;
      return {
        fixtureId: id,
        orgId,
        competitionId,
        eventId: newId(),
        seq: n,
        attempt: 1,
        type: malformed && n === 1 ? "style_set" : entry.type,
        v: 1,
        payload: malformed && n === 1 ? {} : entry.payload,
        actorPersonId: holder,
        clientSeq: n,
        clientRecordedAt: now,
        receivedAt: n === 3 ? lastReceipt : now,
      };
    }),
  );
  return id;
}
async function token(id: string, holder = actor, at = now) {
  const result = await tenant(holder, (db) =>
    issueHandover(db, id, holder, { deviceId: "first" }, at),
  );
  if (!result.ok) throw new Error(result.message);
  return result.token;
}
const redeem = (value: string, who = guest, at = later(1)) =>
  tenant(who, (db) => redeemHandover(db, who, { token: value, deviceId: "next" }, at));
beforeAll(async () => {
  await owner.db
    .insert(people)
    .values(persons.map((id) => ({ id, name: "Claim person", email: `claim-${id}@example.test` })));
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Claim club", slug: `claim-${orgId}`, createdBy: organizer });
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    sport: "cricket",
    name: "Claim cup",
    slug: `claim-${competitionId}`,
    createdBy: organizer,
  });
  await owner.db
    .insert(teams)
    .values({ id: teamId, orgId, competitionId, name: "Claim side", createdBy: organizer });
  await owner.db
    .insert(teams)
    .values({ id: awayTeamId, orgId, competitionId, name: "Away side", createdBy: organizer });
  await owner.db.insert(grants).values([
    ...[actor, other].map((personId) => ({
      id: newId(),
      personId,
      scopeType: "tournament" as const,
      scopeId: competitionId,
      capabilitySet: "fixture:scorer",
      grantedBy: organizer,
    })),
    {
      id: newId(),
      personId: organizer,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: "org:owner",
      grantedBy: organizer,
    },
  ]);
  await owner.db.insert(teamManagers).values({
    id: newId(),
    orgId,
    competitionId,
    teamId,
    personId: manager,
    role: "manager",
    source: "organizer",
    createdBy: organizer,
  });
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  for (const id of persons) await owner.db.delete(people).where(eq(people.id, id));
  if (app !== owner) await app.sql.end();
  await owner.sql.end();
});
describe("API-3/4/5 resume, claims and handovers", () => {
  it("resumes only the ordered events after since, with attempt and canonical lastSeq", async () => {
    const id = await fixture();
    const result = await tenant(actor, (db) => resumeScoring(db, id, actor, 1));
    expect(result).toMatchObject({ ok: true, attempt: 1, lastSeq: 3 });
    if (result.ok) expect(result.events.map((e) => e.seq)).toEqual([2, 3]);
    expect(await tenant(guest, (db) => resumeScoring(db, id, guest, 0))).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    expect(await tenant(actor, (db) => resumeScoring(db, id, actor, -1))).toMatchObject({
      ok: false,
    });
  });
  it("C47 refuses malformed whole history even when the requested page excludes it, without writes", async () => {
    const id = await fixture(actor, now, true);
    const beforeEvents = await owner.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, id))
      .orderBy(matchEvents.seq);
    const beforeMatch = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    const beforeAudit = await owner.db.select().from(auditLog).where(eq(auditLog.subject, id));
    const result = await tenant(actor, (db) => resumeScoring(db, id, actor, 1));
    expect(result).toMatchObject({ ok: false, error: "bad_payload" });
    expect(result).not.toHaveProperty("events");
    expect(
      await owner.db
        .select()
        .from(matchEvents)
        .where(eq(matchEvents.fixtureId, id))
        .orderBy(matchEvents.seq),
    ).toEqual(beforeEvents);
    expect(await owner.db.select().from(matches).where(eq(matches.fixtureId, id))).toEqual(
      beforeMatch,
    );
    expect(await owner.db.select().from(auditLog).where(eq(auditLog.subject, id))).toEqual(
      beforeAudit,
    );
  });
  it("clean claim allows empty/same person but never another holder", async () => {
    const id = await fixture();
    expect(
      await tenant(other, (db) =>
        claimScoring(db, id, other, { deviceId: "next", mode: "clean" }, later(999999)),
      ),
    ).toMatchObject({ ok: false, error: "claim_held" });
    expect(
      await tenant(actor, (db) =>
        claimScoring(db, id, actor, { deviceId: "first", mode: "clean" }, later(1)),
      ),
    ).toMatchObject({ ok: true });
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    expect(match?.scorerClaimedAt).toEqual(now);
    await owner.db
      .update(matches)
      .set({ scorerPersonId: null, scorerDeviceId: null })
      .where(eq(matches.fixtureId, id));
    expect(
      await tenant(other, (db) =>
        claimScoring(db, id, other, { deviceId: "next", mode: "clean" }, later(1)),
      ),
    ).toMatchObject({ ok: true });
  });
  it("force checks latest holder receipt and exact 120s; organiser acts immediately", async () => {
    const id = await fixture(actor, later(60_000));
    expect(
      await tenant(other, (db) =>
        claimScoring(db, id, other, { deviceId: "next", mode: "force" }, later(179999)),
      ),
    ).toMatchObject({ ok: false, error: "claim_held" });
    expect(
      await tenant(other, (db) =>
        claimScoring(db, id, other, { deviceId: "next", mode: "force" }, later(180000)),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await tenant(organizer, (db) =>
        claimScoring(db, id, organizer, { deviceId: "admin", mode: "force" }, later(180001)),
      ),
    ).toMatchObject({ ok: true });
  });
  it("gates lookup on signature/canonical encoding, rejecting cross-fixture tampering", async () => {
    const id = await fixture();
    const value = await token(id);
    const decoded = Buffer.from(value, "base64url").toString();
    const tampered = Buffer.from(decoded.replace(id, newId())).toString("base64url");
    const spy = vi.spyOn(systemDb, "select").mockImplementation(() => {
      throw new Error("Unexpected tenant lookup");
    });
    try {
      expect(await handoverTenant(guest, tampered, later(1))).toBeNull();
      expect(await handoverTenant(guest, `${value}=`, later(1))).toBeNull();
      expect(await handoverTenant("", value, later(1))).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await handoverTenant(guest, value, later(1))).toBe(orgId);
    expect(await redeem(tampered)).toMatchObject({ ok: false });
  });
  it("atomically appoints a guest without membership and refuses expiry/reuse", async () => {
    const id = await fixture();
    const value = await token(id);
    expect(await redeem(value, guest, later(600000))).toMatchObject({ ok: false });
    expect(await redeem(value)).toMatchObject({ ok: true, fixtureId: id });
    expect(await redeem(value, guest2)).toMatchObject({ ok: false });
    expect(
      await tenant(guest, async (db) => {
        const [f] = await db.select().from(fixtures).where(eq(fixtures.id, id));
        if (!f) throw new Error("fixture");
        return authorityKind(db, guest, f);
      }),
    ).toBe("c");
    const appointed = await owner.db
      .select()
      .from(fixtureOfficials)
      .where(eq(fixtureOfficials.fixtureId, id));
    expect(appointed).toHaveLength(1);
    expect(appointed[0]).toMatchObject({ personId: guest, createdBy: actor });
    const audit = await owner.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.claim.handover_redeemed")));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.meta).not.toHaveProperty("token");
  });
  it("refuses stale device and holder-change-back even with the same clock", async () => {
    const id = await fixture();
    const value = await token(id);
    await tenant(actor, (db) =>
      claimScoring(db, id, actor, { deviceId: "second", mode: "clean" }, now),
    );
    expect(await redeem(value)).toMatchObject({ ok: false });
    await tenant(actor, (db) =>
      claimScoring(db, id, actor, { deviceId: "first", mode: "clean" }, now),
    );
    expect(await redeem(value)).toMatchObject({ ok: false });
    const second = await token(id, actor, later(10));
    await tenant(organizer, (db) =>
      claimScoring(db, id, organizer, { deviceId: "admin", mode: "force" }, later(11)),
    );
    await tenant(organizer, (db) =>
      claimScoring(db, id, organizer, { deviceId: "admin", mode: "clean" }, later(12)),
    );
    await owner.db
      .update(matches)
      .set({ scorerPersonId: actor, scorerDeviceId: "first", scorerClaimedAt: later(13) })
      .where(eq(matches.fixtureId, id));
    expect(await redeem(second, guest, later(14))).toMatchObject({ ok: false });
  });
  it("refuses restart and issuer revocation, requiring an issuance record", async () => {
    const id = await fixture();
    const value = await token(id);
    await owner.db.update(matches).set({ attempt: 2 }).where(eq(matches.fixtureId, id));
    expect(await redeem(value)).toMatchObject({ ok: false });
    const id2 = await fixture();
    const value2 = await token(id2);
    await owner.db
      .update(grants)
      .set({ revokedAt: later(1) })
      .where(and(eq(grants.personId, actor), eq(grants.scopeId, competitionId)));
    try {
      expect(await redeem(value2)).toMatchObject({ ok: false });
    } finally {
      await owner.db
        .update(grants)
        .set({ revokedAt: null })
        .where(and(eq(grants.personId, actor), eq(grants.scopeId, competitionId)));
    }
    await owner.db
      .delete(auditLog)
      .where(and(eq(auditLog.subject, id2), eq(auditLog.action, "match.claim.handover_issued")));
    expect(await redeem(value2)).toMatchObject({ ok: false });
  });
  it("serializes two redeemers and rolls back appointment/claim/audit together", async () => {
    const id = await fixture();
    const value = await token(id);
    const results = await Promise.all([redeem(value, guest), redeem(value, guest2)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      await owner.db.select().from(fixtureOfficials).where(eq(fixtureOfficials.fixtureId, id)),
    ).toHaveLength(1);
    const id2 = await fixture();
    const value2 = await token(id2);
    await expect(
      tenant(guest, async (db) => {
        expect(
          await redeemHandover(db, guest, { token: value2, deviceId: "next" }, later(1)),
        ).toMatchObject({ ok: true });
        throw new Error("rollback proof");
      }),
    ).rejects.toThrow("rollback proof");
    expect(
      await owner.db.select().from(fixtureOfficials).where(eq(fixtureOfficials.fixtureId, id2)),
    ).toHaveLength(0);
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id2));
    expect(match?.scorerPersonId).toBe(actor);
    expect(await redeem(value2)).toMatchObject({ ok: true });
  });
  it("preserves delegated manager authority through subsequent handovers", async () => {
    const id = await fixture(manager);
    const value = await token(id, manager);
    expect(await redeem(value)).toMatchObject({ ok: true });
    const effective = (who: string) =>
      tenant(who, async (db) => {
        const [f] = await db.select().from(fixtures).where(eq(fixtures.id, id));
        if (!f) throw new Error("fixture");
        return authorityKind(db, who, f);
      });
    expect(await effective(guest)).toBe("d");
    const next = await tenant(guest, (db) =>
      issueHandover(db, id, guest, { deviceId: "next" }, later(2)),
    );
    if (!next.ok) throw new Error(next.message);
    expect(await redeem(next.token, guest2, later(3))).toMatchObject({ ok: true });
    expect(await effective(guest2)).toBe("d");
    await owner.db.insert(fixtureOfficials).values({
      id: newId(),
      fixtureId: id,
      orgId,
      competitionId,
      role: "scorer",
      personId: guest2,
      displayName: "Independent scorer",
      createdBy: organizer,
    });
    expect(await effective(guest2)).toBe("c");
  });
  it("retains an identical issuance binding and accepts an idempotent claim", async () => {
    const id = await fixture();
    const value = await token(id);
    expect(await token(id)).toBe(value);
    expect(verifyHandoverToken(value, later(1))).toMatchObject({ fixtureId: id, attempt: 1 });
    await tenant(actor, (db) =>
      claimScoring(db, id, actor, { deviceId: "first", mode: "clean" }, later(1)),
    );
    expect(await redeem(value)).toMatchObject({ ok: true });
  });
});
