import { reminderBoundariesFor } from "./reminder-boundaries";
import {
  auditLog,
  competitions,
  createDb,
  fixtures,
  matchEvents,
  matches,
  messageOutbox,
  newId,
  organizations,
  people,
  pushSubscriptions,
  teams,
} from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { FORMAT_PRESETS } from "@desiauction/core/scoring";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { purgeOrg } from "../test-support/purge-org";
import { drainOutbox } from "../messaging/outbox";
import {
  requestTossReminder as requestUsing,
  cancelTossReminder as cancelUsing,
} from "./toss-reminder";
import { dispatchTossReminders as dispatchUsing } from "./toss-reminder-delivery";
import { reminderId, resolveReminderLink as resolveUsing } from "./reminder-link";
import { sweepScoring } from "./sweep";

/** Shared behavior, independently registered with owner fixtures and restricted app runners. */
export function registerReminderSuite(ownerUrl: string, appUrl?: string) {
  const owner = createDb(ownerUrl);
  const app = appUrl ? createDb(appUrl) : owner;
  const boundaries = reminderBoundariesFor(app);
  const requestTossReminder = (...args: Parameters<typeof requestUsing>) =>
    requestUsing(args[0], args[1], args[2], args[3], args[4], args[5], boundaries);
  const cancelTossReminder = (...args: Parameters<typeof cancelUsing>) =>
    cancelUsing(args[0], args[1], args[2], boundaries);
  const dispatchTossReminders = (...args: Parameters<typeof dispatchUsing>) =>
    dispatchUsing(args[0], args[1], { boundaries, ...args[2] });
  const resolveReminderLink = (...args: Parameters<typeof resolveUsing>) =>
    resolveUsing(args[0], args[1], boundaries);
  const actor = newId(),
    recipient = newId(),
    stranger = newId(),
    orgId = newId(),
    competitionId = newId(),
    home = newId(),
    away = newId();
  const slug = `reminder-${competitionId}`;
  let seq = 0;
  beforeAll(async () => {
    await owner.db.insert(people).values(
      [actor, recipient, stranger].map((id) => ({
        id,
        name: "Reminder test",
        email: `${id}@example.test`,
        emailVerifiedAt: new Date(),
      })),
    );
    await owner.db
      .insert(organizations)
      .values({ id: orgId, name: "Reminder club", slug: `reminder-${orgId}`, createdBy: actor });
    await owner.db.insert(competitions).values({
      id: competitionId,
      orgId,
      name: "Reminder cup",
      slug,
      sport: "cricket",
      visibility: "public",
      createdBy: actor,
    });
    await owner.db.insert(teams).values(
      [home, away].map((id) => ({
        id,
        orgId,
        competitionId,
        name: `Reminder ${id}`,
        createdBy: actor,
      })),
    );
  });
  afterAll(async () => {
    for (const id of [recipient, stranger]) {
      await owner.db.delete(messageOutbox).where(eq(messageOutbox.personId, id));
      await owner.db.delete(auditLog).where(eq(auditLog.actor, id));
      await owner.db.delete(pushSubscriptions).where(eq(pushSubscriptions.personId, id));
    }
    await purgeOrg(owner.db, orgId);
    for (const id of [actor, recipient, stranger])
      await owner.db.delete(people).where(eq(people.id, id));
    if (app !== owner) await app.sql.end();
    await owner.sql.end();
  });
  async function fixture() {
    seq += 1;
    const fixtureId = newId(),
      token = `private-${newId()}`,
      number = `REM-${String(seq)}`;
    await owner.db
      .update(competitions)
      .set({ visibility: "public" })
      .where(eq(competitions.id, competitionId));
    await owner.db.insert(fixtures).values({
      id: fixtureId,
      orgId,
      competitionId,
      homeTeamId: home,
      awayTeamId: away,
      seq,
      fixtureNumber: number,
      status: "published",
      createdBy: actor,
    });
    await owner.db.insert(matches).values({
      fixtureId,
      orgId,
      competitionId,
      format: {},
      shareToken: token,
      awardVersion: "cricket-v1/t20",
    });
    const identity = { fixtureId, orgId };
    return { fixtureId, token, number, identity };
  }
  async function toss(fixtureId: string) {
    await owner.db.insert(matchEvents).values({
      fixtureId,
      orgId,
      competitionId,
      seq: 1,
      eventId: newId(),
      attempt: 1,
      type: "match_started",
      payload: { format: FORMAT_PRESETS.t20, conditions: {}, homeTeamId: home, awayTeamId: away },
      actorPersonId: actor,
      clientSeq: 1,
      clientRecordedAt: new Date(),
    });
    await owner.db.update(matches).set({ phase: "toss" }).where(eq(matches.fixtureId, fixtureId));
    for (const [index, teamId] of [home, away].entries()) {
      const battingOrder = [newId(), newId()];
      await owner.db.insert(matchEvents).values({
        fixtureId,
        orgId,
        competitionId,
        seq: index + 2,
        eventId: newId(),
        attempt: 1,
        type: "lineup_confirmed",
        payload: {
          teamId,
          battingOrder,
          captainId: battingOrder[0],
          keeperId: battingOrder[1],
          substitutes: [],
        },
        actorPersonId: actor,
        clientSeq: index + 2,
        clientRecordedAt: new Date(),
      });
    }
    await owner.db.insert(matchEvents).values({
      fixtureId,
      orgId,
      competitionId,
      seq: 4,
      eventId: newId(),
      attempt: 1,
      type: "toss",
      payload: { winnerTeamId: home, decision: "bat" },
      actorPersonId: actor,
      clientSeq: 4,
      clientRecordedAt: new Date(),
    });
  }
  async function request(identity: { fixtureId: string; orgId: string }, proof = { s: slug }) {
    const result = await requestTossReminder(identity, recipient, proof, "email", true);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    return result.requestId;
  }
  it("requires explicit consent and saves one durable request per channel/provenance", async () => {
    const f = await fixture();
    expect(
      await requestTossReminder(f.identity, recipient, { s: slug }, "email", false),
    ).toMatchObject({ ok: false, error: "consent_required" });
    const id = await request(f.identity);
    expect(await request(f.identity)).toBe(id);
    expect(reminderId(id)).toBe(id);
    expect(reminderId("https://evil.test")).toBeNull();
    expect(await resolveReminderLink(recipient, id)).toBeNull();
    await toss(f.fixtureId);
    expect(await resolveReminderLink(stranger, id)).toBeNull();
    expect(await resolveReminderLink(recipient, id)).toBe(`/c/${slug}/m/${f.number}`);
    expect(
      await requestTossReminder(f.identity, recipient, { s: slug }, "email", true),
    ).toMatchObject({ ok: false, error: "already_tossed" });
  });
  it("recovers a missed callback exactly once without storing bearer or toss details", async () => {
    const f = await fixture();
    await owner.db
      .update(competitions)
      .set({ visibility: "private" })
      .where(eq(competitions.id, competitionId));
    const result = await requestTossReminder(f.identity, recipient, { t: f.token }, "email", true);
    if (!result.ok) throw new Error(result.error);
    await toss(f.fixtureId);
    expect(
      (await sweepScoring({ handle: app, readDb: owner.db, fixtureIds: [f.fixtureId] })).failures,
    ).toEqual([]);
    expect(await dispatchTossReminders(orgId, f.fixtureId)).toBe(0);
    const [mail] = await owner.db
      .select()
      .from(messageOutbox)
      .where(eq(messageOutbox.dedupeKey, `match.toss_reminder:${result.requestId}`));
    expect(mail).toBeDefined();
    expect(JSON.stringify(mail)).not.toContain(f.token);
    expect(mail?.bodyText).toContain(`/inbox?reminder=${result.requestId}`);
    expect(mail?.bodyText).not.toContain("winnerTeamId");
    expect(await resolveReminderLink(recipient, result.requestId)).toBe(`/m/${f.token}`);
    await owner.db
      .update(matches)
      .set({ shareToken: `rotated-${newId()}` })
      .where(eq(matches.fixtureId, f.fixtureId));
    expect(await resolveReminderLink(recipient, result.requestId)).toBeNull();
  });
  it("retries transient pre-send lookup failure without sending or suppressing", async () => {
    const f = await fixture(),
      id = await request(f.identity);
    await toss(f.fixtureId);
    await dispatchTossReminders(orgId, f.fixtureId);
    const send = vi.fn(() => Promise.resolve("sent" as const));
    const transaction = vi
      .spyOn(owner.db, "transaction")
      .mockRejectedValueOnce(new Error("Synthetic lookup failure"));
    try {
      const result = await drainOutbox({
        db: owner.db,
        dedupeKeys: [`match.toss_reminder:${id}`],
        mailer: { send },
      });
      expect(result.retrying).toBe(1);
      expect(result.sent).toBe(0);
      expect(result.suppressed).toBe(0);
      expect(send).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
    const [mail] = await owner.db
      .select()
      .from(messageOutbox)
      .where(eq(messageOutbox.dedupeKey, `match.toss_reminder:${id}`));
    expect(mail?.status).toBe("pending");
  });
  it("scopes two recipients independently and rolls back a notice with a failed enqueue transaction", async () => {
    const f = await fixture();
    const first = await request(f.identity);
    const second = await requestUsing(
      f.identity,
      stranger,
      { s: slug },
      "email",
      true,
      new Date(),
      boundaries,
    );
    if (!second.ok) throw new Error(second.error);
    expect(
      await requestUsing(
        { fixtureId: f.fixtureId, orgId: newId() },
        recipient,
        { s: slug },
        "email",
        true,
        new Date(),
        boundaries,
      ),
    ).toMatchObject({ ok: false, error: "not_found" });
    await toss(f.fixtureId);
    const failing = {
      ...boundaries,
      inOrg: async <T>(
        personId: string,
        tenantId: string,
        run: (db: import("@desiauction/db").Db) => Promise<T>,
      ) =>
        boundaries.inOrg(personId, tenantId, async (db) => {
          const result = await run(db);
          if (personId === recipient) throw new Error("Synthetic enqueue transaction failure");
          return result;
        }),
    };
    await expect(
      dispatchTossReminders(orgId, f.fixtureId, { boundaries: failing }),
    ).rejects.toThrow("Synthetic enqueue transaction failure");
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "match.toss_reminder"), eq(auditLog.subject, first))),
    ).toHaveLength(0);
    expect(
      await owner.db
        .select()
        .from(messageOutbox)
        .where(eq(messageOutbox.dedupeKey, `match.toss_reminder:${first}`)),
    ).toHaveLength(0);
    await dispatchTossReminders(orgId, f.fixtureId);
    for (const id of [first, second.requestId])
      expect(
        await owner.db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.action, "match.toss_reminder"), eq(auditLog.subject, id))),
      ).toHaveLength(1);
    expect(await dispatchTossReminders(orgId, f.fixtureId)).toBe(0);
    expect(await resolveReminderLink(recipient, second.requestId)).toBeNull();
    await owner.db.delete(messageOutbox).where(eq(messageOutbox.personId, stranger));
    await owner.db.delete(auditLog).where(eq(auditLog.actor, stranger));
  });
  it("suppresses public access revoked after email enqueue", async () => {
    const f = await fixture(),
      id = await request(f.identity);
    await toss(f.fixtureId);
    await dispatchTossReminders(orgId, f.fixtureId);
    await owner.db.update(fixtures).set({ status: "draft" }).where(eq(fixtures.id, f.fixtureId));
    const send = vi.fn(() => Promise.resolve("sent" as const));
    expect(
      (
        await drainOutbox({
          db: owner.db,
          dedupeKeys: [`match.toss_reminder:${id}`],
          mailer: { send },
        })
      ).suppressed,
    ).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
  it("suppresses email cancelled after enqueue and keeps its durable inbox notice", async () => {
    const f = await fixture(),
      id = await request(f.identity);
    await toss(f.fixtureId);
    await dispatchTossReminders(orgId, f.fixtureId);
    await cancelTossReminder(f.identity, recipient);
    expect(await resolveReminderLink(recipient, id)).toBeNull();
    const send = vi.fn(() => Promise.resolve("sent" as const));
    const result = await drainOutbox({
      db: owner.db,
      dedupeKeys: [`match.toss_reminder:${id}`],
      mailer: { send },
    });
    expect(result.suppressed).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "match.toss_reminder"), eq(auditLog.subject, id))),
    ).toHaveLength(1);
  });
  it("refuses public revocation and changed attempts after request", async () => {
    const f = await fixture(),
      id = await request(f.identity);
    await toss(f.fixtureId);
    await owner.db.update(fixtures).set({ status: "draft" }).where(eq(fixtures.id, f.fixtureId));
    expect(await resolveReminderLink(recipient, id)).toBeNull();
    expect(await dispatchTossReminders(orgId, f.fixtureId)).toBe(0);
    await owner.db
      .update(fixtures)
      .set({ status: "published" })
      .where(eq(fixtures.id, f.fixtureId));
    await owner.db.update(matches).set({ attempt: 2 }).where(eq(matches.fixtureId, f.fixtureId));
    expect(await resolveReminderLink(recipient, id)).toBeNull();
  });
  it("retains one inbox notice when push fails and repeated recovery does not duplicate it", async () => {
    const f = await fixture();
    await owner.db.insert(pushSubscriptions).values({
      id: newId(),
      personId: recipient,
      endpoint: `https://example.test/${newId()}`,
      p256dh: "test",
      auth: "test",
    });
    const result = await requestTossReminder(f.identity, recipient, { s: slug }, "push", true);
    if (!result.ok) throw new Error(result.error);
    await toss(f.fixtureId);
    let openTransactions = 0;
    const tracked = {
      ...boundaries,
      inOrg: async <T>(
        personId: string,
        tenantId: string,
        run: (db: import("@desiauction/db").Db) => Promise<T>,
      ) => {
        openTransactions += 1;
        try {
          return await boundaries.inOrg(personId, tenantId, run);
        } finally {
          openTransactions -= 1;
        }
      },
    };
    const push = vi.fn(() => {
      expect(openTransactions).toBe(0);
      return Promise.reject(new Error("Synthetic push outage"));
    });
    expect(await dispatchTossReminders(orgId, f.fixtureId, { push, boundaries: tracked })).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
    await owner.db.delete(pushSubscriptions).where(eq(pushSubscriptions.personId, recipient));
    expect(await resolveReminderLink(recipient, result.requestId)).toBe(`/c/${slug}/m/${f.number}`);
    expect(await dispatchTossReminders(orgId, f.fixtureId, { push })).toBe(0);
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, "match.toss_reminder"), eq(auditLog.subject, result.requestId)),
        ),
    ).toHaveLength(1);
  });
  it("does not send an effective toss that was voided before drain or recovery", async () => {
    const f = await fixture(),
      id = await request(f.identity);
    await toss(f.fixtureId);
    await dispatchTossReminders(orgId, f.fixtureId);
    const [target] = await owner.db
      .select()
      .from(matchEvents)
      .where(and(eq(matchEvents.fixtureId, f.fixtureId), eq(matchEvents.type, "toss")));
    if (!target) throw new Error("Missing synthetic toss");
    await owner.db.insert(matchEvents).values({
      fixtureId: f.fixtureId,
      orgId,
      competitionId,
      seq: 5,
      eventId: newId(),
      attempt: 1,
      type: "void",
      targetEventId: target.eventId,
      payload: {},
      actorPersonId: actor,
      clientSeq: 5,
      clientRecordedAt: new Date(),
    });
    expect(await resolveReminderLink(recipient, id)).toBeNull();
    expect(await dispatchTossReminders(orgId, f.fixtureId)).toBe(0);
    const send = vi.fn(() => Promise.resolve("sent" as const));
    expect(
      (
        await drainOutbox({
          db: owner.db,
          dedupeKeys: [`match.toss_reminder:${id}`],
          mailer: { send },
        })
      ).suppressed,
    ).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(await request(f.identity)).toBe(id);
  });
}
