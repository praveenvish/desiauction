import {
  consentRecords,
  createDb,
  emailSends,
  messageOutbox,
  newId,
  notificationPreferences,
  people,
  type DbHandle,
} from "@desiauction/db";
import { EMAIL_TEMPLATES } from "@desiauction/messaging/email-template-defaults";
import { defaultContent, sampleVariables } from "@desiauction/messaging/email-templates";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET, POST } from "../../app/api/email/unsubscribe/route";
import { env } from "../../env";
import { setPreference } from "./consent";
import { composeNotificationEmail } from "./notification-email";
import { sendNotificationMail } from "./notify";
import { drainOutbox, enqueueMail } from "./outbox";
import type { OutgoingMail, TransactionalMailer } from "./transactional-mail";
import { oneClickUnsubscribeUrl, unsubscribeToken } from "./unsubscribe";

/**
 * EVERY EMAIL LEAVES A RECORD, AND EVERY SWITCHABLE ONE CAN BE STOPPED IN ONE
 * CLICK (email programme PR2), against a real database.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
const reader = newId();
const quiet = newId();
const READER_EMAIL = `sends-${RUN}@Example.test`;

/** A mailer that remembers what it was given and answers with an id. */
function recording(): { mailer: TransactionalMailer; sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  let n = 0;
  return {
    sent,
    mailer: {
      send: () => Promise.resolve("sent"),
      deliver: (mail) => {
        sent.push(mail);
        n += 1;
        return Promise.resolve({ outcome: "sent", providerMessageId: `re_${RUN}_${String(n)}` });
      },
    },
  };
}

function reviewAsk() {
  const spec = EMAIL_TEMPLATES["review.platform_ask"];
  const fields = defaultContent(spec, "en").variants["general"];
  if (fields === undefined) throw new Error("no general variant");
  return composeNotificationEmail(spec, fields, sampleVariables(spec, "en"), {
    action: { id: spec.actions[0]?.id ?? "review", url: `${env.PUBLIC_BASE_URL}/review/x` },
  });
}

beforeAll(async () => {
  await db.insert(people).values([
    {
      id: reader,
      phone: `+9193${RUN}1`,
      name: "Reader",
      email: READER_EMAIL.toLowerCase(),
      emailVerifiedAt: new Date(),
    },
    { id: quiet, phone: `+9193${RUN}2`, name: "Quiet" },
  ]);
  await setPreference(db, { personId: quiet, topic: "feedback", channel: "email", allowed: false });
});

afterAll(async () => {
  const ids = [reader, quiet];
  await db.delete(emailSends).where(inArray(emailSends.personId, ids));
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  await db.delete(notificationPreferences).where(inArray(notificationPreferences.personId, ids));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

describe("a direct send", () => {
  it("is recorded with the provider's id and the recipient's domain only", async () => {
    const { mailer, sent } = recording();
    const { outcome } = await sendNotificationMail(
      db,
      { kind: "review.platform_ask", to: READER_EMAIL, personId: reader },
      reviewAsk(),
      mailer,
    );
    expect(outcome).toBe("sent");
    const [row] = await db.select().from(emailSends).where(eq(emailSends.personId, reader));
    expect(row).toMatchObject({
      kind: "review.platform_ask",
      outcome: "sent",
      recipientDomain: "example.test",
      providerMessageId: `re_${RUN}_1`,
    });
    // A mail the reader can switch off carries the one-click unsubscribe.
    expect(sent[0]?.headers?.["List-Unsubscribe"]).toBe(
      `<${oneClickUnsubscribeUrl(reader, "feedback")}>`,
    );
    expect(sent[0]?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("is recorded when the gate withholds it, with the reason", async () => {
    const { mailer, sent } = recording();
    const { outcome } = await sendNotificationMail(
      db,
      { kind: "review.platform_ask", to: `quiet-${RUN}@example.test`, personId: quiet },
      reviewAsk(),
      mailer,
    );
    expect(outcome).toBe("suppressed");
    expect(sent).toHaveLength(0);
    const [row] = await db.select().from(emailSends).where(eq(emailSends.personId, quiet));
    expect(row?.outcome).toBe("suppressed");
    expect(row?.reason).not.toBeNull();
  });
});

describe("a queued mail", () => {
  it("keeps the provider's id and carries the unsubscribe header", async () => {
    const key = `sends:${RUN}:sold`;
    const spec = EMAIL_TEMPLATES["auction.unsold"];
    const fields = defaultContent(spec, "en").variants["default"];
    if (fields === undefined) throw new Error("no default variant");
    const mail = composeNotificationEmail(spec, fields, sampleVariables(spec, "en"), {});
    await enqueueMail(
      [
        {
          ...mail,
          html: mail.html ?? "",
          personId: reader,
          orgId: null,
          kind: "auction.unsold",
          dedupeKey: key,
        },
      ],
      db,
    );
    const { mailer, sent } = recording();
    await drainOutbox({ db, mailer, dedupeKeys: [key], whatsapp: null, sms: null });
    const [row] = await db
      .select({ status: messageOutbox.status, id: messageOutbox.providerMessageId })
      .from(messageOutbox)
      .where(eq(messageOutbox.dedupeKey, key));
    expect(row?.status).toBe("sent");
    expect(row?.id).toBe(`re_${RUN}_1`);
    expect(sent[0]?.headers?.["List-Unsubscribe"]).toBe(
      `<${oneClickUnsubscribeUrl(reader, "auction")}>`,
    );
  });
});

describe("one-click unsubscribe", () => {
  const url = (topic: string, token: string) =>
    `${env.PUBLIC_BASE_URL}/api/email/unsubscribe?p=${reader}&topic=${topic}&t=${token}`;

  it("turns the /account switch off — email and text — and says where it came from", async () => {
    const response = await POST(
      new Request(url("auction", unsubscribeToken(reader, "auction")), {
        method: "POST",
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(response.status).toBe(200);
    const prefs = await db
      .select({
        channel: notificationPreferences.channel,
        allowed: notificationPreferences.allowed,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.personId, reader),
          eq(notificationPreferences.topic, "auction"),
        ),
      );
    expect(prefs.map((p) => `${p.channel}:${String(p.allowed)}`).sort()).toEqual([
      "email:false",
      "sms:false",
    ]);
    const consents = await db
      .select({ source: consentRecords.source })
      .from(consentRecords)
      .where(eq(consentRecords.personId, reader));
    expect(consents.some((c) => c.source === "email_unsubscribe")).toBe(true);
  });

  it("refuses a forged link and changes nothing", async () => {
    const response = await POST(
      new Request(url("registration", unsubscribeToken(quiet, "registration")), { method: "POST" }),
    );
    expect(response.status).toBe(400);
    const prefs = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.personId, reader),
          eq(notificationPreferences.topic, "registration"),
        ),
      );
    expect(prefs).toHaveLength(0);
  });

  it("sends a plain visit to the page, where only a button changes anything", () => {
    const response = GET(new Request(url("auction", unsubscribeToken(reader, "auction"))));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/email/unsubscribe?p=");
  });
});
