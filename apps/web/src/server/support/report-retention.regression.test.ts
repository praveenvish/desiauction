// The outbox's two retention clocks (gate P2): words go at thirty days, the
// dedupe key stays for a year so an old moment can't be announced twice.
import { createDb, messageOutbox, newId, people, type DbHandle } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { enqueueMail, type QueuedMail } from "../messaging/outbox";
import { purgeSpentSecurityRecords } from "./report-retention";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);
const DAY_MS = 24 * 60 * 60 * 1000;
const person = newId();

function moment(key: string) {
  return {
    personId: person,
    orgId: null,
    kind: "auction.sold" as const,
    dedupeKey: `retention:${RUN}:${key}`,
    subject: "Sold to Cup Kings",
    text: "Cup Kings bought you for Rs 75,000.",
    html: "<p>Cup Kings bought you for Rs 75,000.</p>",
  } as QueuedMail;
}

async function age(key: string, days: number): Promise<void> {
  await db
    .update(messageOutbox)
    .set({ status: "sent", createdAt: new Date(Date.now() - days * DAY_MS) })
    .where(eq(messageOutbox.dedupeKey, `retention:${RUN}:${key}`));
}

beforeAll(async () => {
  await db.insert(people).values({ id: person, phone: `+9197${RUN}1`, name: "Retention" });
  await enqueueMail([moment("fresh"), moment("month"), moment("year")], db);
  await age("fresh", 1);
  await age("month", 40);
  await age("year", 400);
});

afterAll(async () => {
  await db.delete(messageOutbox).where(eq(messageOutbox.personId, person));
  await db.delete(people).where(eq(people.id, person));
  await handle.sql.end();
});

describe("outbox retention — the words and the memory age differently", () => {
  it("scrubs a month-old row's words, keeps its key, and deletes a year-old row", async () => {
    await purgeSpentSecurityRecords();
    const rows = await db
      .select({
        key: messageOutbox.dedupeKey,
        subject: messageOutbox.subject,
        text: messageOutbox.bodyText,
      })
      .from(messageOutbox)
      .where(eq(messageOutbox.personId, person));
    const byKey = new Map(rows.map((row) => [row.key.split(":").pop(), row]));
    expect(byKey.get("fresh")?.text).toContain("Cup Kings");
    expect(byKey.get("month")).toMatchObject({ subject: "", text: "" });
    expect(byKey.has("year")).toBe(false);
  });

  it("still refuses to queue the scrubbed moment again", async () => {
    expect(await enqueueMail([moment("month")], db)).toEqual([]);
  });
});
