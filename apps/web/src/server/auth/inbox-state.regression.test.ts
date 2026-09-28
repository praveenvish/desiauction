import { auditLog, createDb, newId, people, type DbHandle } from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { UNREAD_CAP } from "../../lib/inbox-cap";
import { inboxState, listInboxEvents, markInboxSeen } from "./security-events";

/**
 * READ STATE ON THE SERVER (email programme PR16), against a real database:
 * the bell's count and the inbox's "new" read one watermark on the person —
 * forward only, never past now — and "Show older" pages the list.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const person = newId();
const busy = newId();
const T = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute, 0));

async function notice(personId: string, at: Date, action = "registration.approved") {
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action,
    scopeType: "person",
    scopeId: personId,
    at,
    meta: {},
  });
}

beforeAll(async () => {
  await db.insert(people).values([
    { id: person, phone: `+9190${RUN}1`, name: "Reader" },
    { id: busy, phone: `+9190${RUN}2`, name: "Busy" },
  ]);
  await notice(person, T(1));
  await notice(person, T(2), "auction.sold");
  await notice(person, T(3), "team.squad_sheet");
  // A sign-in is the person's own doing: never in the inbox, never counted.
  await notice(person, T(4), "auth.login.otp");
  for (let i = 0; i < UNREAD_CAP + 3; i += 1) {
    await notice(busy, T(10 + i));
  }
});

afterAll(async () => {
  await db.delete(auditLog).where(inArray(auditLog.scopeId, [person, busy]));
  await db.delete(people).where(inArray(people.id, [person, busy]));
  await handle.sql.end();
});

describe("the bell's count", () => {
  it("counts every inbox notice when nothing has been read, sign-ins excluded", async () => {
    expect(await inboxState(person)).toEqual({ seenAt: null, unread: 3 });
  });

  it("stops counting past the cap — the badge says 9+", async () => {
    expect((await inboxState(busy)).unread).toBe(UNREAD_CAP + 1);
  });

  it("counts only what is newer than the watermark", async () => {
    await markInboxSeen(person, T(2));
    expect(await inboxState(person)).toEqual({ seenAt: T(2), unread: 1 });
  });

  it("never moves the watermark back", async () => {
    await markInboxSeen(person, T(1));
    expect((await inboxState(person)).seenAt).toEqual(T(2));
  });

  it("never moves it past now — a date from the future marks nothing in advance", async () => {
    const now = T(3);
    await markInboxSeen(person, new Date(Date.UTC(2030, 0, 1)), now);
    const [row] = await db
      .select({ seenAt: people.inboxSeenAt })
      .from(people)
      .where(eq(people.id, person));
    expect(row?.seenAt).toEqual(now);
    expect((await inboxState(person)).unread).toBe(0);
  });
});

describe("show older", () => {
  it("pages the list before a timestamp", async () => {
    const first = await listInboxEvents(person, 2);
    expect(first.map((event) => event.action)).toEqual(["team.squad_sheet", "auction.sold"]);
    const older = await listInboxEvents(person, 2, first[1]?.at);
    expect(older.map((event) => event.action)).toEqual(["registration.approved"]);
  });
});
