import {
  consentRecords,
  createDb,
  newId,
  notificationPreferences,
  people,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "../../env";

/**
 * ONE SWITCH PER CHANNEL (email programme PR17), against a real database: the
 * /account grid writes exactly the row it shows, refuses a channel the topic
 * is not sent on, and reads each row back.
 */

const person = newId();
vi.mock("../auth/actions", () => ({
  currentSession: () => Promise.resolve({ personId: person }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const { notificationSettings, setNotificationPreferenceAction } = await import("./actions");

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

beforeAll(async () => {
  await db.insert(people).values({ id: person, phone: `+9191${RUN}1`, name: "Chooser" });
});

afterAll(async () => {
  await db.delete(notificationPreferences).where(eq(notificationPreferences.personId, person));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, [person]));
  await db.delete(people).where(eq(people.id, person));
  await handle.sql.end();
});

async function rowsFor(topic: string) {
  const rows = await db
    .select({ channel: notificationPreferences.channel, allowed: notificationPreferences.allowed })
    .from(notificationPreferences)
    .where(
      and(eq(notificationPreferences.personId, person), eq(notificationPreferences.topic, topic)),
    );
  return rows.map((row) => `${row.channel}:${String(row.allowed)}`).sort();
}

describe("the /account grid", () => {
  it("shows each topic's own channels, all on by default", async () => {
    const settings = await notificationSettings();
    const matches = settings?.topics.find((entry) => entry.topic === "matches");
    expect(matches?.channels).toEqual([
      { channel: "email", allowed: true },
      { channel: "sms", allowed: true },
      { channel: "in-app", allowed: true },
    ]);
    const feedback = settings?.topics.find((entry) => entry.topic === "feedback");
    expect(feedback?.channels.map((row) => row.channel)).toEqual(["email"]);
  });

  it("turns off one channel and leaves the others on", async () => {
    expect(await setNotificationPreferenceAction("matches", false, "email")).toEqual({ ok: true });
    expect(await rowsFor("matches")).toEqual(["email:false"]);
    const settings = await notificationSettings();
    const matches = settings?.topics.find((entry) => entry.topic === "matches");
    expect(matches?.channels).toEqual([
      { channel: "email", allowed: false },
      { channel: "sms", allowed: true },
      { channel: "in-app", allowed: true },
    ]);
    expect(matches?.allowed).toBe(true);
  });

  it("switches the inbox row, which the in-app gate reads", async () => {
    await setNotificationPreferenceAction("matches", false, "in-app");
    expect(await rowsFor("matches")).toEqual(["email:false", "in-app:false"]);
  });

  it("refuses a channel the topic is not sent on, and an unknown one", async () => {
    expect((await setNotificationPreferenceAction("feedback", false, "sms")).ok).toBe(false);
    expect((await setNotificationPreferenceAction("matches", false, "pigeon")).ok).toBe(false);
    expect(await rowsFor("feedback")).toEqual([]);
  });

  it("with no channel, still writes email and texts together — the old callers' meaning", async () => {
    await setNotificationPreferenceAction("auction", false);
    expect(await rowsFor("auction")).toEqual(["email:false", "sms:false"]);
  });
});
