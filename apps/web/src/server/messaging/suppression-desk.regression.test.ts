// THE SUPPRESSION DESK AND DELIVERY ANALYTICS (Notification Control Center,
// Phase 4), against real Postgres: an admin's lift reaches the outbox, a manual
// suppression reaches it, both are audited with the actor and a masked contact,
// revert puts the row back and is refused once the row has moved, a STOP or a
// complaint is not lifted without the confirmation flag — on the server — and
// the analytics aggregates count exactly the rows seeded and name nobody.
import {
  auditLog,
  createDb,
  messageOutbox,
  newId,
  people,
  suppressions,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "../../env";
import type { QueuedMail } from "./outbox";

let operator: { personId: string } | null = null;
vi.mock("../admin/authz", () => ({
  platformAdminGate: () =>
    Promise.resolve(
      operator === null
        ? null
        : { personId: operator.personId, name: "Ops", phone: null, email: null },
    ),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { addSuppression, findSuppressions, liftSuppressionAction, revertSuppression } =
  await import("../admin/suppression-actions");
const { drainOutbox, enqueueMail } = await import("./outbox");
const { suppress, liftSuppression } = await import("./consent");
const { SUPPRESSION_AUDIT_ACTION_LIST } = await import("./suppression-writer");
const { recentSuppressionChanges } = await import("../admin/suppression-views");
const { deliveryAnalytics } = await import("../admin/delivery-analytics-views");

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const admin = newId();
const player = newId();
const PLAYER_EMAIL = `spr-player-${RUN}@example.test`;
// A plausible Indian mobile: 9 + 2 + the run's seven digits.
const PLAYER_PHONE = `+9192${RUN}1`;
const CONTACTS = [PLAYER_EMAIL, PLAYER_PHONE];

function mail(key: string): QueuedMail {
  return {
    personId: player,
    orgId: null,
    kind: "auction.sold" as const,
    dedupeKey: `spr:${RUN}:${key}`,
    subject: "Congratulations",
    text: "You were bought.",
    html: "<p>You were bought.</p>",
  } as QueuedMail;
}

function recordingMailer() {
  const sent: string[] = [];
  return {
    sent,
    send: vi.fn((message: { to: string }) => {
      sent.push(message.to);
      return Promise.resolve("sent" as const);
    }),
  };
}

async function sendOne(key: string): Promise<{ sent: string[]; status: string | undefined }> {
  await enqueueMail([mail(key)], db);
  const provider = recordingMailer();
  await drainOutbox({ db, mailer: provider, personIds: [player] });
  const [row] = await db
    .select({ status: messageOutbox.status })
    .from(messageOutbox)
    .where(eq(messageOutbox.dedupeKey, `spr:${RUN}:${key}`));
  return { sent: provider.sent, status: row?.status };
}

async function activeRows(contact: string) {
  const rows = await db.select().from(suppressions).where(eq(suppressions.contact, contact));
  return rows.filter((row) => row.liftedAt === null);
}

async function auditRow(id: string) {
  const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id));
  return row;
}

beforeAll(async () => {
  await db.insert(people).values([
    { id: admin, phone: `+9192${RUN}2`, name: "Suppression Operator" },
    {
      id: player,
      phone: PLAYER_PHONE,
      name: "Suppression Player",
      email: PLAYER_EMAIL,
      emailVerifiedAt: new Date(),
    },
  ]);
});

afterEach(async () => {
  operator = null;
  await db.delete(suppressions).where(inArray(suppressions.contact, CONTACTS));
});

afterAll(async () => {
  await db.delete(suppressions).where(inArray(suppressions.contact, CONTACTS));
  await db.delete(auditLog).where(eq(auditLog.actor, admin));
  await db.delete(messageOutbox).where(eq(messageOutbox.personId, player));
  await db.delete(people).where(inArray(people.id, [admin, player]));
  await handle.sql.end();
});

describe("the door", () => {
  it("refuses anyone who is not a platform admin, and writes nothing", async () => {
    operator = null;
    const refused = { ok: false, error: "Not available." };
    expect(await findSuppressions(PLAYER_EMAIL)).toEqual(refused);
    expect(await addSuppression(PLAYER_EMAIL, "global", "Asked by phone")).toEqual(refused);
    const id = await suppress(db, { contact: PLAYER_EMAIL, channel: "email", reason: "bounce" });
    expect(await liftSuppressionAction(id, "Mailbox fixed", false)).toEqual(refused);
    expect(await revertSuppression(newId())).toEqual(refused);
    expect(await activeRows(PLAYER_EMAIL)).toHaveLength(1);
    const audits = await db
      .select()
      .from(auditLog)
      .where(inArray(auditLog.action, [...SUPPRESSION_AUDIT_ACTION_LIST]));
    expect(audits.filter((row) => row.actor === admin)).toEqual([]);
  });
});

describe("search", () => {
  it("finds a number however it is typed, exactly, and nothing on a partial", async () => {
    operator = { personId: admin };
    await suppress(db, {
      contact: PLAYER_PHONE,
      channel: "sms",
      reason: "stop",
      note: "inbound: STOP",
    });
    const local = PLAYER_PHONE.slice(3);
    const spaced = `${local.slice(0, 5)} ${local.slice(5)}`;
    const found = await findSuppressions(spaced);
    expect(found).toMatchObject({ ok: true, contact: PLAYER_PHONE, channel: "sms" });
    if (!found.ok) throw new Error("unreachable");
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0]).toMatchObject({
      reason: "stop",
      source: "inbound_text",
      needsConfirmation: true,
    });
    // The note (the person's own message) never leaves the projection.
    expect(JSON.stringify(found)).not.toContain("inbound:");
    expect(await findSuppressions(local.slice(0, 6))).toMatchObject({ ok: false });
  });
});

describe("a lift reaches the outbox", () => {
  it("a bounced address, lifted with a reason, is mailed again — and the lift is audited", async () => {
    operator = { personId: admin };
    const id = await suppress(db, {
      contact: PLAYER_EMAIL,
      channel: "email",
      reason: "bounce",
      note: "provider event: bounced",
    });
    expect(await sendOne("bounced")).toEqual({ sent: [], status: "suppressed" });

    // No reason, no lift.
    expect(await liftSuppressionAction(id, "  ", false)).toMatchObject({ ok: false });
    const lifted = await liftSuppressionAction(id, "They fixed their mailbox", false);
    expect(lifted).toMatchObject({ ok: true });
    if (!lifted.ok || lifted.auditId === null) throw new Error("expected an audit id");

    expect(await sendOne("after-lift")).toEqual({ sent: [PLAYER_EMAIL], status: "sent" });

    const row = await auditRow(lifted.auditId);
    expect(row).toMatchObject({
      actor: admin,
      action: "notification.suppression_lifted",
      scopeType: "platform",
      subject: id,
    });
    expect(row?.meta).toMatchObject({
      op: "lift",
      suppressionReason: "bounce",
      reason: "They fixed their mailbox",
      before: { active: true },
      after: { active: false },
    });
    // Masked on the audit row, never the address.
    expect(JSON.stringify(row?.meta)).not.toContain(PLAYER_EMAIL);
  });
});

describe("a manual suppression reaches the outbox", () => {
  it("stops the next email, is audited, and revert lets mail go again", async () => {
    operator = { personId: admin };
    expect(await addSuppression(PLAYER_EMAIL, "global", "x")).toMatchObject({ ok: false });
    expect(await addSuppression(PLAYER_EMAIL, "login", "Asked by phone")).toMatchObject({
      ok: false,
    });
    const added = await addSuppression(
      ` ${PLAYER_EMAIL.toUpperCase()} `,
      "global",
      "Asked by phone",
    );
    expect(added).toMatchObject({ ok: true });
    if (!added.ok || added.auditId === null) throw new Error("expected an audit id");
    const [row] = await activeRows(PLAYER_EMAIL);
    expect(row).toMatchObject({ channel: "email", scope: "global", reason: "manual" });
    expect(row?.note).toBe("admin: Asked by phone");

    // Twice is once.
    expect(await addSuppression(PLAYER_EMAIL, "global", "Asked again")).toMatchObject({
      ok: true,
      auditId: null,
    });
    expect(await activeRows(PLAYER_EMAIL)).toHaveLength(1);

    expect(await sendOne("manual")).toEqual({ sent: [], status: "suppressed" });

    const revert = await revertSuppression(added.auditId);
    expect(revert).toMatchObject({ ok: true });
    if (!revert.ok || revert.auditId === null) throw new Error("expected an audit id");
    expect(await activeRows(PLAYER_EMAIL)).toEqual([]);
    expect((await auditRow(revert.auditId))?.meta).toMatchObject({
      op: "lift",
      revertOf: added.auditId,
    });
    expect(await sendOne("after-revert")).toEqual({ sent: [PLAYER_EMAIL], status: "sent" });

    // The revert itself reverts: the suppression is back in force.
    const again = await revertSuppression(revert.auditId);
    expect(again).toMatchObject({ ok: true });
    expect(await activeRows(PLAYER_EMAIL)).toHaveLength(1);
  });

  it("a topic-scoped suppression stops that topic only", async () => {
    operator = { personId: admin };
    expect(
      await addSuppression(PLAYER_EMAIL, "registration", "No registration mail"),
    ).toMatchObject({ ok: true });
    // auction.sold is the auction topic: it still goes.
    expect(await sendOne("other-topic")).toEqual({ sent: [PLAYER_EMAIL], status: "sent" });
  });

  it("revert is refused once the row has moved since", async () => {
    operator = { personId: admin };
    const added = await addSuppression(PLAYER_PHONE, "global", "Asked on a call");
    if (!added.ok || added.auditId === null) throw new Error("expected an audit id");
    // The person texts START: the row is lifted without the desk.
    await liftSuppression(db, { contact: PLAYER_PHONE, channel: "sms" });
    const refused = await revertSuppression(added.auditId);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? "" : refused.error).toContain("changed since");
    const recent = await recentSuppressionChanges(db);
    const entry = recent.find((change) => change.id === added.auditId);
    expect(entry).toMatchObject({ revertable: false });
    expect(entry?.summary).not.toContain(PLAYER_PHONE);
  });
});

describe("lifting what the person said needs confirmation, on the server", () => {
  for (const [reason, channel, contact] of [
    ["stop", "sms", PLAYER_PHONE],
    ["complaint", "email", PLAYER_EMAIL],
  ] as const) {
    it(`a ${reason} is not lifted without confirmed=true`, async () => {
      operator = { personId: admin };
      const id = await suppress(db, { contact, channel, reason });
      const refused = await liftSuppressionAction(id, "Support asked us to", false);
      expect(refused).toMatchObject({ ok: false, needsConfirmation: true });
      expect(await activeRows(contact)).toHaveLength(1);
      // A forged truthy value is not a confirmation.
      const forged = await liftSuppressionAction(
        id,
        "Support asked us to",
        "true" as unknown as boolean,
      );
      expect(forged).toMatchObject({ ok: false, needsConfirmation: true });

      expect(await liftSuppressionAction(id, "Support asked us to", true)).toMatchObject({
        ok: true,
      });
      expect(await activeRows(contact)).toEqual([]);
    });
  }
});

describe("delivery analytics", () => {
  // Far from today, so the rest of the suite's outbox rows are outside the window.
  const NOW = new Date("2031-01-10T06:30:00Z");
  const DAY = 24 * 60 * 60 * 1000;
  const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

  beforeAll(async () => {
    const base = {
      personId: player,
      orgId: null,
      subject: "s",
      bodyText: "secret body",
      bodyHtml: "<p>secret body</p>",
    };
    let n = 0;
    const row = (
      kind: string,
      channel: "email" | "sms" | "whatsapp",
      status: "sent" | "failed" | "suppressed" | "pending",
      daysAgo: number,
      extra: Partial<typeof messageOutbox.$inferInsert> = {},
    ) => ({
      ...base,
      id: newId(),
      kind,
      channel,
      status,
      dedupeKey: `spr:${RUN}:an:${String((n += 1))}`,
      createdAt: at(daysAgo),
      // A text row carries its template and slots (0081's CHECK).
      ...(channel === "email" ? {} : { templateKey: "auction.sold", slots: {} }),
      ...extra,
    });
    await db.insert(messageOutbox).values([
      row("auction.sold", "email", "sent", 0),
      row("auction.sold", "email", "sent", 1),
      row("auction.sold", "email", "sent", 1),
      row("auction.sold", "email", "failed", 2, { lastError: `rejected: ${PLAYER_EMAIL}` }),
      row("auction.sold", "email", "suppressed", 2, { lastError: "withheld:opted_out" }),
      row("auction.sold", "email", "suppressed", 3, { lastError: "withheld:opted_out" }),
      row("auction.sold", "whatsapp", "sent", 0, { deliveryStatus: "delivered" }),
      row("auction.sold", "whatsapp", "sent", 0, { deliveryStatus: "delivered" }),
      row("auction.sold", "whatsapp", "sent", 0, { deliveryStatus: "read" }),
      row("auction.sold", "whatsapp", "sent", 0, {
        deliveryStatus: "failed",
        deliveryError: "131026 Message undeliverable",
      }),
      row("auction.sold", "sms", "suppressed", 4, {
        lastError: "no_text_channel: not opted in to WhatsApp",
      }),
      // Outside a 7-day window; inside 30.
      row("auction.sold", "email", "failed", 10, { lastError: "admin_disabled" }),
    ]);
  });

  it("counts exactly the seeded rows, per channel, kind and day, inside the window", async () => {
    const view = await deliveryAnalytics(db, 7, NOW);
    const email = view.channels.find((c) => c.channel === "email");
    const whatsapp = view.channels.find((c) => c.channel === "whatsapp");
    const sms = view.channels.find((c) => c.channel === "sms");
    expect(email).toMatchObject({ sent: 3, failed: 1, suppressed: 2 });
    expect(whatsapp).toMatchObject({ sent: 4, delivered: 3, read: 1, failed: 0 });
    expect(sms).toMatchObject({ sent: 0, suppressed: 1 });
    expect(
      view.kinds.find((k) => k.kind === "auction.sold" && k.channel === "email"),
    ).toMatchObject({ sent: 3, failed: 1, suppressed: 2 });
    expect(view.daily).toHaveLength(7);
    const total = view.daily.reduce((sum, d) => sum + d.sent + d.failed + d.suppressed, 0);
    expect(total).toBe(11);

    const labels = Object.fromEntries(view.reasons.map((r) => [`${r.status}|${r.label}`, r.count]));
    expect(labels).toMatchObject({
      "suppressed|withheld:opted_out": 2,
      "suppressed|no_text_channel:not_opted_in_to_whatsapp": 1,
      "undelivered|whatsapp_delivery:131026_message_undeliverable": 1,
      "failed|rejected": 1,
    });
    expect(labels["failed|admin_disabled"]).toBeUndefined();
    // Counts only: no recipient, no body.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(PLAYER_EMAIL);
    expect(serialized).not.toContain("secret body");
  });

  it("a wider window takes in the older row", async () => {
    const view = await deliveryAnalytics(db, 30, NOW);
    expect(view.channels.find((c) => c.channel === "email")).toMatchObject({ failed: 2 });
    expect(view.daily).toHaveLength(30);
  });
});
