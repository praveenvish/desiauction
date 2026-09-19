// THE PERSONAL-MESSAGE QUEUE (0079), against real Postgres: at most once per
// moment, the address and the consent decided at send time, retries that back
// off and then give up.
import {
  consentRecords,
  createDb,
  messageOutbox,
  newId,
  notificationPreferences,
  people,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "../../env";
import {
  SmsSendError,
  type PlayerSmsSender,
  type TemplatedSms,
} from "../competition/registration-notify";
import {
  drainOutbox,
  enqueueMail,
  enqueueSms,
  textWindowOpensAt,
  type QueuedMail,
  type QueuedSms,
} from "./outbox";
import type { MailOutcome, OutgoingMail, TransactionalMailer } from "./transactional-mail";
import {
  setWhatsappOptIn,
  WhatsAppSendError,
  type PersonalWhatsAppSender,
  type WhatsAppMessage,
} from "./whatsapp";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

let withEmail = "";
let noEmail = "";
let optedOut = "";
let flaky = "";
let noPhone = "";
let waFan = "";
let waChanged = "";

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
  noPhone = newId();
  waFan = newId();
  waChanged = newId();
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
    {
      id: noPhone,
      phone: null,
      name: "No Phone",
      email: `nophone-${RUN}@example.test`,
      emailVerifiedAt: verified,
    },
  ]);
  await db.insert(people).values([
    { id: waFan, phone: `+9194${RUN}6`, name: "Wa Fan" },
    { id: waChanged, phone: `+9194${RUN}7`, name: "Wa Changed" },
  ]);
  await setWhatsappOptIn(db, { personId: waFan, granted: true, source: "registration" });
  await setWhatsappOptIn(db, { personId: waChanged, granted: true, source: "registration" });
  await new Promise((done) => setTimeout(done, 5));
  await setWhatsappOptIn(db, { personId: waChanged, granted: false, source: "account" });
  await db.insert(notificationPreferences).values([
    { id: newId(), personId: optedOut, topic: "auction", channel: "email", allowed: false },
    { id: newId(), personId: optedOut, topic: "auction", channel: "sms", allowed: false },
  ]);
});

afterAll(async () => {
  const ids = [withEmail, noEmail, optedOut, flaky, noPhone, waFan, waChanged];
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
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

/** Noon IST and half past eleven at night IST, on the same day. */
const NOON_IST = new Date("2026-09-20T06:30:00Z");
const LATE_IST = new Date("2026-09-19T18:00:00Z");

function text(personId: string, key: string): QueuedSms {
  return {
    personId,
    orgId: null,
    kind: "auction.sold",
    dedupeKey: `test:${RUN}:sms:${key}`,
    templateKey: "auction.sold",
    slots: { team: "Cup Kings", price: "Rs 75,000", competition: "MPL 2026" },
  };
}

function phone(failWith?: SmsSendError): PlayerSmsSender & { sent: [string, TemplatedSms][] } {
  const sent: [string, TemplatedSms][] = [];
  return {
    sent,
    send: vi.fn((to: string, message: TemplatedSms) => {
      if (failWith !== undefined) return Promise.reject(failWith);
      sent.push([to, message]);
      return Promise.resolve();
    }),
  };
}

async function textRow(personId: string) {
  const [row] = await db
    .select()
    .from(messageOutbox)
    .where(and(eq(messageOutbox.personId, personId), eq(messageOutbox.channel, "sms")));
  return row;
}

describe("SMS — one line on a registered template", () => {
  it("queues the template and its slots, and renders the line for the dev inbox", async () => {
    expect(await enqueueSms([text(withEmail, "sold")], db)).toEqual([`test:${RUN}:sms:sold`]);
    const [row] = await db
      .select()
      .from(messageOutbox)
      .where(eq(messageOutbox.dedupeKey, `test:${RUN}:sms:sold`));
    expect(row?.channel).toBe("sms");
    expect(row?.templateKey).toBe("auction.sold");
    expect(row?.bodyText).toBe(
      "DesiAuction: Congratulations! Cup Kings bought you for Rs 75,000 in MPL 2026. https://desiauction.in/home",
    );
  });

  it("sends to the person's number with the slots the gateway needs", async () => {
    const sender = phone();
    const result = await drainOutbox({ db, sms: sender, now: NOON_IST, personIds: [withEmail] });
    expect(result.sent).toBe(1);
    expect(sender.sent[0]?.[0]).toBe(`+9194${RUN}1`);
    expect(sender.sent[0]?.[1].slots).toEqual({
      team: "Cup Kings",
      price: "Rs 75,000",
      competition: "MPL 2026",
    });
  });

  it("never buzzes a phone at night: a text due at 11:30 pm waits for 8 am, attempt unspent", async () => {
    await enqueueSms([text(flaky, "late")], db);
    const sender = phone();
    await drainOutbox({ db, sms: sender, now: LATE_IST, personIds: [flaky] });
    expect(sender.sent).toHaveLength(0);
    const row = await textRow(flaky);
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);
    expect(row?.nextAttemptAt.toISOString()).toBe("2026-09-20T02:30:00.000Z");
    await db
      .delete(messageOutbox)
      .where(and(eq(messageOutbox.personId, flaky), eq(messageOutbox.channel, "sms")));
  });

  it("honours a person who switched Auction updates off, by text too", async () => {
    await enqueueSms([text(optedOut, "opted-out")], db);
    const sender = phone();
    const result = await drainOutbox({ db, sms: sender, now: NOON_IST, personIds: [optedOut] });
    expect(result.suppressed).toBe(1);
    expect(sender.sent).toHaveLength(0);
  });

  it("suppresses — does not fail — a person with no phone number", async () => {
    await enqueueSms([text(noPhone, "no-phone")], db);
    const result = await drainOutbox({ db, sms: phone(), now: NOON_IST, personIds: [noPhone] });
    expect(result.suppressed).toBe(1);
  });

  it("fails an unregistered template at once instead of retrying into the same wall", async () => {
    await enqueueSms([text(noEmail, "no-template")], db);
    const sender = phone(
      new SmsSendError("no DLT template registered for auction.sold", false, true),
    );
    const result = await drainOutbox({ db, sms: sender, now: NOON_IST, personIds: [noEmail] });
    expect(result.failed).toBe(1);
    const row = await textRow(noEmail);
    expect(row?.lastError).toContain("no DLT template registered");
  });

  it("refuses to queue a line whose slot would not fit the registered variable", async () => {
    const tooLong = {
      ...text(withEmail, "too-long"),
      slots: { ...text(withEmail, "x").slots, price: "Rs 1,00,00,00,00,000" },
    };
    expect(await enqueueSms([tooLong], db)).toEqual([]);
  });
});

describe("the text window (IST)", () => {
  it("is open from 8 am to 10 pm", () => {
    expect(textWindowOpensAt(NOON_IST)).toEqual(NOON_IST);
    const eight = new Date("2026-09-20T02:30:00Z");
    expect(textWindowOpensAt(eight)).toEqual(eight);
  });

  it("holds a late-evening text to the next morning, and an early one to the same morning", () => {
    expect(textWindowOpensAt(LATE_IST).toISOString()).toBe("2026-09-20T02:30:00.000Z");
    // 3 am IST on the 20th → 8 am IST the same day.
    expect(textWindowOpensAt(new Date("2026-09-19T21:30:00Z")).toISOString()).toBe(
      "2026-09-20T02:30:00.000Z",
    );
  });
});

function whatsapp(fail = false): PersonalWhatsAppSender & { sent: [string, WhatsAppMessage][] } {
  const sent: [string, WhatsAppMessage][] = [];
  return {
    sent,
    send: vi.fn((to: string, message: WhatsAppMessage) => {
      if (fail) return Promise.reject(new WhatsAppSendError("WhatsApp refused the send"));
      sent.push([to, message]);
      return Promise.resolve();
    }),
  };
}

const APPROVED = (key: string) => (key === "auction.sold" ? "da_auction_sold" : undefined);
const CARD = "https://desiauction.in/c/mpl/p/R1/opengraph-image";

async function lastText(personId: string) {
  const rows = await db
    .select()
    .from(messageOutbox)
    .where(eq(messageOutbox.personId, personId))
    .orderBy(messageOutbox.createdAt);
  return rows[rows.length - 1];
}

describe("WHATSAPP — instead of SMS, for a player who opted in", () => {
  it("sends the approved template with the card and the player's name, and records the channel", async () => {
    await enqueueSms([{ ...text(waFan, "wa-1"), mediaUrl: CARD }], db);
    const wa = whatsapp();
    const sms = phone();
    const result = await drainOutbox({
      db,
      sms,
      whatsapp: wa,
      whatsappTemplate: APPROVED,
      now: NOON_IST,
      personIds: [waFan],
    });
    expect(result.sent).toBe(1);
    expect(sms.sent).toHaveLength(0);
    expect(wa.sent[0]?.[1]).toMatchObject({
      name: "da_auction_sold",
      params: ["Wa Fan", "Cup Kings", "₹75,000", "MPL 2026"],
      imageUrl: CARD,
    });
    expect((await lastText(waFan))?.channel).toBe("whatsapp");
  });

  it("falls back to SMS in the same pass when WhatsApp fails, and keeps the reason", async () => {
    await enqueueSms([text(waFan, "wa-fail")], db);
    const sms = phone();
    const result = await drainOutbox({
      db,
      sms,
      whatsapp: whatsapp(true),
      whatsappTemplate: APPROVED,
      now: NOON_IST,
      personIds: [waFan],
    });
    expect(result.sent).toBe(1);
    expect(sms.sent).toHaveLength(1);
    const row = await lastText(waFan);
    expect(row?.channel).toBe("sms");
    expect(row?.lastError).toContain("WhatsApp:");
  });

  it("uses SMS while Meta has not approved the template (no name configured)", async () => {
    await enqueueSms([text(waFan, "wa-unapproved")], db);
    const wa = whatsapp();
    const sms = phone();
    await drainOutbox({
      db,
      sms,
      whatsapp: wa,
      whatsappTemplate: () => undefined,
      now: NOON_IST,
      personIds: [waFan],
    });
    expect(wa.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(1);
  });

  it("uses SMS for someone who never opted in, and for someone whose latest answer is no", async () => {
    await enqueueSms([text(withEmail, "wa-never"), text(waChanged, "wa-withdrew")], db);
    const wa = whatsapp();
    const sms = phone();
    await drainOutbox({
      db,
      sms,
      whatsapp: wa,
      whatsappTemplate: APPROVED,
      now: NOON_IST,
      personIds: [withEmail, waChanged],
    });
    expect(wa.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(2);
  });

  it("still honours the Auction updates switch — being messaged at all comes first", async () => {
    await setWhatsappOptIn(db, { personId: optedOut, granted: true, source: "account" });
    await enqueueSms([text(optedOut, "wa-opted-out")], db);
    const wa = whatsapp();
    const result = await drainOutbox({
      db,
      sms: phone(),
      whatsapp: wa,
      whatsappTemplate: APPROVED,
      now: NOON_IST,
      personIds: [optedOut],
    });
    expect(result.suppressed).toBe(1);
    expect(wa.sent).toHaveLength(0);
  });
});
