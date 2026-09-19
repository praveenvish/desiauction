// THE PERSONAL-MESSAGE QUEUE (0079), against real Postgres: at most once per
// moment, the address and the consent decided at send time, retries that back
// off and then give up.
import {
  createDb,
  messageOutbox,
  newId,
  notificationPreferences,
  people,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "../../env";
import { drainOutbox, enqueueMail, type QueuedMail } from "./outbox";
import type { MailOutcome, OutgoingMail, TransactionalMailer } from "./transactional-mail";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

let withEmail = "";
let noEmail = "";
let optedOut = "";
let flaky = "";

function mail(personId: string, key: string): QueuedMail {
  return {
    personId,
    orgId: null,
    kind: "auction.sold",
    dedupeKey: `test:${RUN}:${key}`,
    subject: "Congratulations",
    text: "You were bought.",
    html: "<p>You were bought.</p>",
  };
}

function mailer(outcome: MailOutcome): TransactionalMailer & { sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    send: vi.fn((message: OutgoingMail) => {
      sent.push(message);
      return Promise.resolve(outcome);
    }),
  };
}

beforeAll(async () => {
  withEmail = newId();
  noEmail = newId();
  optedOut = newId();
  flaky = newId();
  const verified = new Date();
  await db.insert(people).values([
    {
      id: withEmail,
      phone: `+9194${RUN}1`,
      name: "Has Email",
      email: `has-${RUN}@example.test`,
      emailVerifiedAt: verified,
    },
    { id: noEmail, phone: `+9194${RUN}2`, name: "No Email" },
    {
      id: optedOut,
      phone: `+9194${RUN}3`,
      name: "Opted Out",
      email: `out-${RUN}@example.test`,
      emailVerifiedAt: verified,
    },
    {
      id: flaky,
      phone: `+9194${RUN}4`,
      name: "Flaky",
      email: `flaky-${RUN}@example.test`,
      emailVerifiedAt: verified,
    },
  ]);
  await db.insert(notificationPreferences).values({
    id: newId(),
    personId: optedOut,
    topic: "auction",
    channel: "email",
    allowed: false,
  });
});

afterAll(async () => {
  const ids = [withEmail, noEmail, optedOut, flaky];
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  await db.delete(notificationPreferences).where(inArray(notificationPreferences.personId, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

async function statusOf(personId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ status: messageOutbox.status })
    .from(messageOutbox)
    .where(eq(messageOutbox.personId, personId));
  return row?.status;
}

describe("THE QUEUE — once per moment", () => {
  it("queues a moment once; the same moment again is ignored", async () => {
    expect(await enqueueMail([mail(withEmail, "sale")], db)).toEqual([`test:${RUN}:sale`]);
    expect(await enqueueMail([mail(withEmail, "sale")], db)).toEqual([]);
  });

  it("sends to a verified address, and never twice", async () => {
    const provider = mailer("sent");
    const first = await drainOutbox({ db, mailer: provider, personIds: [withEmail] });
    expect(first.sent).toBe(1);
    expect(provider.sent[0]?.to).toBe(`has-${RUN}@example.test`);
    expect(provider.sent[0]?.html).toContain("You were bought");
    const again = await drainOutbox({ db, mailer: provider, personIds: [withEmail] });
    expect(again.sent).toBe(0);
    expect(await statusOf(withEmail)).toBe("sent");
  });
});

describe("SEND-TIME DECISIONS", () => {
  it("suppresses — does not fail — a person with no verified email", async () => {
    await enqueueMail([mail(noEmail, "no-email")], db);
    const provider = mailer("sent");
    const result = await drainOutbox({ db, mailer: provider, personIds: [noEmail] });
    expect(result.suppressed).toBe(1);
    expect(provider.sent).toHaveLength(0);
    expect(await statusOf(noEmail)).toBe("suppressed");
  });

  it("honours a person who switched Auction updates off", async () => {
    await enqueueMail([mail(optedOut, "opted-out")], db);
    const provider = mailer("sent");
    const result = await drainOutbox({ db, mailer: provider, personIds: [optedOut] });
    expect(result.suppressed).toBe(1);
    expect(provider.sent).toHaveLength(0);
  });
});

describe("RETRIES", () => {
  it("backs off after a failed send, then gives up after five attempts", async () => {
    await enqueueMail([mail(flaky, "flaky")], db);
    const provider = mailer("failed");
    const first = await drainOutbox({ db, mailer: provider, personIds: [flaky] });
    expect(first.retrying).toBe(1);
    expect(await statusOf(flaky)).toBe("pending");
    // Not due again until the back-off passes: an immediate drain skips it.
    expect((await drainOutbox({ db, mailer: provider, personIds: [flaky] })).retrying).toBe(0);

    // Fast-forward through the remaining attempts.
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await db
        .update(messageOutbox)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(eq(messageOutbox.personId, flaky));
      await drainOutbox({ db, mailer: provider, personIds: [flaky] });
    }
    expect(await statusOf(flaky)).toBe("failed");
    expect(provider.sent).toHaveLength(5);
  });
});
