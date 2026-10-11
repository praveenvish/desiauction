import { createHub } from "../hub.js";
import { integrationUrls } from "../env.js";
import {
  createDb,
  newId,
  people,
  organizations,
  competitions,
  teams,
  fixtures,
  matches,
  matchLiveState,
} from "@desiauction/db";
import { FORMAT_PRESETS } from "@desiauction/core/scoring";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { liveDatabase } from "../database.js";
import { readLive } from "../reader.js";
import { state } from "../test-state.js";
const { owner: ownerUrl, system: systemUrl } = integrationUrls();
const owner = createDb(ownerUrl, { max: 1 });
afterAll(async () => {
  await owner.sql.end();
});
const wait = async (predicate: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for notification lifecycle");
};
it("real committed notifications, rollback, two physical connections, reader timeout, reconnect and shutdown", async () => {
  const name = `ls1-live-${newId()}`;
  const url = new URL(systemUrl);
  url.searchParams.set("application_name", name);
  const messages: string[] = [];
  const id = newId();
  const live = await liveDatabase(url.toString(), (fixtureId) => messages.push(fixtureId));
  try {
    const [setting] = await live.reader
      .sql`select current_setting('statement_timeout') as timeout, current_user as role`;
    expect(setting).toMatchObject({ timeout: "30s", role: "desiauction_system" });
    const count = async () => {
      const [r] =
        await owner.sql`select count(*)::int as n from pg_stat_activity where application_name = ${name}`;
      return r?.n as number;
    };
    expect(await count()).toBe(2);
    const [listener] =
      await owner.sql`select pid from pg_stat_activity where application_name = ${name} and query ilike 'listen %'`;
    expect(listener?.pid).toBeTypeOf("number");
    const listenerPid = Number(listener?.pid);
    await owner.sql.begin(async (tx) => {
      await tx`select pg_notify('match_live', ${id + ":1"})`;
      expect(messages).toHaveLength(0);
    });
    await wait(() => messages.length === 1);
    await expect(
      owner.sql.begin(async (tx) => {
        await tx`select pg_notify('match_live', ${id + ":2"})`;
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(messages).toEqual([id]);
    await owner.sql`select pg_terminate_backend(${listenerPid})`;
    await wait(async () => {
      const rows =
        await owner.sql`select pid from pg_stat_activity where application_name = ${name} and query ilike 'listen %'`;
      expect(await count()).toBeLessThanOrEqual(2);
      return rows.length === 1 && rows[0]?.pid !== listenerPid;
    });
    await owner.sql`select pg_notify('match_live', ${id + ":3"})`;
    await wait(() => messages.length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(messages).toEqual([id, id]);
    expect(await count()).toBe(2);
  } finally {
    await live.close();
  }
  await wait(async () => {
    const rows = await owner.sql`select pid from pg_stat_activity where application_name = ${name}`;
    return rows.length === 0;
  });
}, 15000);
it("real system-role P1/P3 reads public/bearer, publication, delay, trust and revocation", async () => {
  const actor = newId(),
    orgId = newId(),
    competitionId = newId(),
    home = newId(),
    away = newId(),
    fixtureId = newId();
  const token = newId();
  const notifications: { release?: (id: string) => void } = {};
  const frames: string[] = [];
  const closed: number[] = [];
  const live = await liveDatabase(systemUrl, (id) => {
    notifications.release?.(id);
  });
  let readAt = Date.now();
  const hub = createHub(
    (id, proof) => readLive(live.reader.db, id, proof, readAt),
    (error) => {
      throw error;
    },
  );
  notifications.release = hub.notify;

  try {
    await owner.db
      .insert(people)
      .values({ id: actor, name: "Live test", email: `${actor}@example.test` });
    await owner.db
      .insert(organizations)
      .values({ id: orgId, name: "Live test", slug: `live-${orgId}`, createdBy: actor });
    await owner.db.insert(competitions).values({
      id: competitionId,
      orgId,
      name: "Live cup",
      slug: `live-${competitionId}`,
      sport: "cricket",
      visibility: "public",
      scoringRules: { publicDelaySeconds: 60 },
      createdBy: actor,
    });
    await owner.db
      .insert(teams)
      .values([home, away].map((id) => ({ id, orgId, competitionId, name: id, createdBy: actor })));
    await owner.db.insert(fixtures).values({
      id: fixtureId,
      orgId,
      competitionId,
      homeTeamId: home,
      awayTeamId: away,
      status: "published",
      fixtureNumber: "LIVE-1",
      seq: 1,
      createdBy: actor,
    });
    await owner.db.insert(matches).values({
      fixtureId,
      orgId,
      competitionId,
      format: FORMAT_PRESETS.t20,
      awardVersion: "cricket-v1/t20",
      shareToken: token,
      phase: "live",
    });
    const now = Date.now();
    readAt = now;
    const old = state(1, new Date(now - 120000).toISOString()),
      current = state(2, new Date(now).toISOString());
    const legacy = { ...old } as Partial<typeof old>;
    delete legacy.family;
    delete legacy.panel;
    await owner.db.insert(matchLiveState).values({
      fixtureId,
      orgId,
      competitionId,
      seq: 2,
      state: {
        ...current,
        panel: { v: 1, email: "private@example.test" },
        history: [{ state: legacy, updatedAt: old.updatedAt }],
      },
    });
    hub.join(
      fixtureId,
      {},
      {
        send(frame) {
          frames.push(frame);
        },
        close(code) {
          closed.push(code);
        },
        bufferedAmount: 0,
      },
    );
    await wait(() => frames.length === 1);
    expect(JSON.parse(frames[0] ?? "null")).toMatchObject({
      t: "live",
      live: { seq: 1, family: "delivery", panel: { v: 1 }, updatedAt: old.updatedAt },
    });
    expect((await readLive(live.reader.db, fixtureId, {}, now)).live?.seq).toBe(1);
    expect((await readLive(live.reader.db, fixtureId, {}, now + 60000)).live?.seq).toBe(1); // Stored ring alone is the delayed source.
    await owner.db
      .update(matches)
      .set({ trustLevel: "verified" })
      .where(eq(matches.fixtureId, fixtureId));
    expect((await readLive(live.reader.db, fixtureId, {}, now)).live?.seq).toBe(2);
    await owner.sql`select pg_notify('match_live', ${fixtureId + ":2"})`;
    await wait(() => frames.length === 2);
    expect(JSON.parse(frames[1] ?? "null")).toMatchObject({
      t: "live",
      live: { seq: 2, panel: { v: 1 } },
    });
    expect(frames[1]).not.toContain("private@example.test");

    await owner.db
      .update(competitions)
      .set({ visibility: "private" })
      .where(eq(competitions.id, competitionId));
    expect((await readLive(live.reader.db, fixtureId, {}, now)).allowed).toBe(false);
    hub.refresh();
    await wait(() => closed.length > 0);
    expect(closed).toEqual([1008]);
    expect(frames).toHaveLength(2);

    expect((await readLive(live.reader.db, fixtureId, { t: token }, now)).live?.seq).toBe(2);
    expect((await readLive(live.reader.db, fixtureId, { t: token, s: "wrong" }, now)).allowed).toBe(
      false,
    );
    for (const invalid of [
      { ...current, family: "rally" },
      { ...current, panel: { v: 2 } },
      { ...current, panel: null },
    ]) {
      await owner.db
        .update(matchLiveState)
        .set({ state: invalid })
        .where(eq(matchLiveState.fixtureId, fixtureId));
      expect(await readLive(live.reader.db, fixtureId, { t: token }, now)).toEqual({
        allowed: false,
        live: null,
      });
      const before = closed.length;
      hub.join(
        fixtureId,
        { t: token },
        {
          send(frame) {
            frames.push(frame);
          },
          close(code) {
            closed.push(code);
          },
          bufferedAmount: 0,
        },
      );
      await wait(() => closed.length === before + 1);
      expect(closed.at(-1)).toBe(1008);
      expect(frames).toHaveLength(2);
    }
    await owner.db
      .update(matchLiveState)
      .set({ state: current })
      .where(eq(matchLiveState.fixtureId, fixtureId));
    await owner.db
      .update(competitions)
      .set({ sport: "badminton" })
      .where(eq(competitions.id, competitionId));
    expect(await readLive(live.reader.db, fixtureId, { t: token }, now)).toEqual({
      allowed: false,
      live: null,
    });
    await owner.db
      .update(competitions)
      .set({ sport: "cricket" })
      .where(eq(competitions.id, competitionId));
    await owner.db.update(matches).set({ phase: "void" }).where(eq(matches.fixtureId, fixtureId));
    expect((await readLive(live.reader.db, fixtureId, { t: token }, now)).allowed).toBe(false);
  } finally {
    hub.close();
    await live.close();
    await owner.db.delete(matchLiveState).where(eq(matchLiveState.fixtureId, fixtureId));
    await owner.db.delete(matches).where(eq(matches.fixtureId, fixtureId));
    await owner.db.delete(fixtures).where(eq(fixtures.id, fixtureId));
    await owner.db.delete(teams).where(eq(teams.competitionId, competitionId));
    await owner.db.delete(competitions).where(eq(competitions.id, competitionId));
    await owner.db.delete(organizations).where(eq(organizations.id, orgId));
    await owner.db.delete(people).where(eq(people.id, actor));
  }
}, 15000);
