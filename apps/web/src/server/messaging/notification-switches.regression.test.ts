// THE PLATFORM'S NOTIFICATION SWITCHES (Notification Control Center, Phase 1),
// against real Postgres: an admin's switch reaches the outbox, a channel kill
// reaches it and never a sign-in code, a security alert goes off only with a
// reason, every change is audited and revertible, the database refuses what
// the code refuses, and a kind taken out of people's hands ignores their
// opt-out.
import {
  auditLog,
  consentRecords,
  createDb,
  messageOutbox,
  newId,
  notificationChannels,
  notificationPreferences,
  notificationSwitches,
  otpCodes,
  people,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "../../env";
import type { QueuedMail } from "./outbox";

/*
 * The actions' door. `platformAdminGate` resolves the session from cookies,
 * which a test has none of; here it answers whoever `operator` names, so the
 * refusal for a non-admin and the write for an admin are both the real action.
 */
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

const { revertNotificationSwitch, setChannelSwitch, setControllability, setNotificationSwitch } =
  await import("../admin/notification-actions");
const { drainOutbox, enqueueMail, enqueueSms } = await import("./outbox");
const { requestOtp } = await import("../auth/otp");
const { invalidatePlatformSwitches } = await import("./platform-switches");
const { NOTIFICATION_AUDIT_ACTION_LIST } = await import("./platform-switch-writer");
const { notificationControlCenter } = await import("../admin/notification-views");
const { setWhatsappOptIn } = await import("./whatsapp");

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);
const NOON_IST = new Date("2026-09-20T06:30:00Z");

const admin = newId();
const player = newId();
const optedOut = newId();
const OTP_PHONE = `+9193${RUN}9`;

function mail(personId: string, key: string): QueuedMail {
  // A test stands in for the template registry; production code cannot.
  return {
    personId,
    orgId: null,
    kind: "auction.sold" as const,
    dedupeKey: `nsw:${RUN}:${key}`,
    subject: "Congratulations",
    text: "You were bought.",
    html: "<p>You were bought.</p>",
  } as QueuedMail;
}

function text(personId: string, key: string) {
  return {
    personId,
    orgId: null,
    kind: "auction.sold" as const,
    dedupeKey: `nsw:${RUN}:sms:${key}`,
    templateKey: "auction.sold" as const,
    slots: { team: "Cup Kings", price: "Rs 75,000", competition: "MPL 2026" },
  };
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

function recordingPhone() {
  const sent: string[] = [];
  return {
    sent,
    send: vi.fn((to: string) => {
      sent.push(to);
      return Promise.resolve();
    }),
  };
}

async function rowOf(dedupeKey: string) {
  const [row] = await db
    .select({ status: messageOutbox.status, lastError: messageOutbox.lastError })
    .from(messageOutbox)
    .where(eq(messageOutbox.dedupeKey, dedupeKey));
  return row;
}

/** Everything back to the catalogue, whoever wrote it — tests share one table. */
async function resetSwitches(): Promise<void> {
  await db.delete(notificationSwitches);
  await db.delete(notificationChannels);
  invalidatePlatformSwitches();
}

beforeAll(async () => {
  const verified = new Date();
  await db.insert(people).values([
    { id: admin, phone: `+9193${RUN}1`, name: "Switch Operator" },
    {
      id: player,
      phone: `+9193${RUN}2`,
      name: "Switch Player",
      email: `nsw-player-${RUN}@example.test`,
      emailVerifiedAt: verified,
    },
    {
      id: optedOut,
      phone: `+9193${RUN}3`,
      name: "Switch OptedOut",
      email: `nsw-out-${RUN}@example.test`,
      emailVerifiedAt: verified,
    },
  ]);
  // Opted in to WhatsApp, so a text WOULD go there unless the switch stops it.
  await setWhatsappOptIn(db, { personId: player, granted: true, source: "registration" });
  await db.insert(notificationPreferences).values({
    id: newId(),
    personId: optedOut,
    topic: "auction",
    channel: "email",
    allowed: false,
  });
  await resetSwitches();
});

afterEach(async () => {
  operator = null;
  await resetSwitches();
});

afterAll(async () => {
  const ids = [admin, player, optedOut];
  await resetSwitches();
  await db.delete(auditLog).where(eq(auditLog.actor, admin));
  await db.delete(messageOutbox).where(inArray(messageOutbox.personId, ids));
  await db.delete(notificationPreferences).where(inArray(notificationPreferences.personId, ids));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
  await db.delete(otpCodes).where(eq(otpCodes.phone, OTP_PHONE));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

describe("the door", () => {
  it("refuses anyone who is not a platform admin, and writes nothing", async () => {
    operator = null;
    expect(await setNotificationSwitch("auction.sold", "email", false)).toEqual({
      ok: false,
      error: "Not available.",
    });
    expect(await setChannelSwitch("email", false)).toMatchObject({ ok: false });
    expect(await setControllability("auction.sold", undefined, false, undefined)).toMatchObject({
      ok: false,
    });
    expect(await db.select().from(notificationSwitches)).toEqual([]);
    expect(await db.select().from(notificationChannels)).toEqual([]);
  });
});

describe("an admin's switch reaches the outbox", () => {
  it("a kind switched off on email is suppressed as admin_disabled, and back on it goes", async () => {
    operator = { personId: admin };
    const off = await setNotificationSwitch("auction.sold", "email", false, "Pausing sale mail");
    expect(off).toMatchObject({ ok: true });

    await enqueueMail([mail(player, "off")], db);
    const provider = recordingMailer();
    await drainOutbox({ db, mailer: provider, personIds: [player] });
    expect(provider.sent).toEqual([]);
    expect(await rowOf(`nsw:${RUN}:off`)).toEqual({
      status: "suppressed",
      lastError: "admin_disabled",
    });

    expect(await setNotificationSwitch("auction.sold", "email", true)).toMatchObject({ ok: true });
    // Back to the catalogue: the row is gone, not left saying "on".
    expect(await db.select().from(notificationSwitches)).toEqual([]);
    await enqueueMail([mail(player, "on")], db);
    await drainOutbox({ db, mailer: provider, personIds: [player] });
    expect(provider.sent).toEqual([`nsw-player-${RUN}@example.test`]);
  });

  it("a channel kill suppresses as channel_disabled", async () => {
    operator = { personId: admin };
    expect(await setChannelSwitch("email", false, "Provider incident")).toMatchObject({ ok: true });
    await enqueueMail([mail(player, "killed")], db);
    const provider = recordingMailer();
    await drainOutbox({ db, mailer: provider, personIds: [player] });
    expect(provider.sent).toEqual([]);
    expect(await rowOf(`nsw:${RUN}:killed`)).toEqual({
      status: "suppressed",
      lastError: "channel_disabled",
    });
  });

  it("WhatsApp off for a kind falls to SMS, and with SMS off too the text is suppressed", async () => {
    operator = { personId: admin };
    await setNotificationSwitch("auction.sold", "whatsapp", false);
    const sms = recordingPhone();
    const wa = {
      send: vi.fn(() => Promise.resolve({ messageId: `wamid.nsw.${RUN}.${newId()}` })),
    };
    const channels = {
      sms,
      whatsapp: wa,
      whatsappTemplate: (key: string) => (key === "auction.sold" ? "da_auction_sold" : undefined),
    };
    await enqueueSms([text(player, "wa-off")], db);
    await drainOutbox({ db, ...channels, now: NOON_IST, personIds: [player] });
    expect(wa.send, "WhatsApp is switched off for this kind").not.toHaveBeenCalled();
    expect(sms.sent).toEqual([`+9193${RUN}2`]);

    await setNotificationSwitch("auction.sold", "sms", false);
    await enqueueSms([text(player, "both-off")], db);
    await drainOutbox({ db, ...channels, now: NOON_IST, personIds: [player] });
    expect(sms.sent).toHaveLength(1);
    expect(await rowOf(`nsw:${RUN}:sms:both-off`)).toEqual({
      status: "suppressed",
      lastError: "admin_disabled",
    });
  });

  it("a sign-in code still goes on a killed channel", async () => {
    operator = { personId: admin };
    await setChannelSwitch("whatsapp", false, "Meta incident");
    await setChannelSwitch("sms", false, "Gateway incident");
    const delivered: string[] = [];
    for (const channel of ["whatsapp", "sms"] as const) {
      const result = await requestOtp(
        db,
        {
          channel,
          send: (phone: string) => {
            delivered.push(`${channel}:${phone}`);
            return Promise.resolve();
          },
        },
        OTP_PHONE,
        null,
        "login",
        1_000_000,
      );
      // The second request may meet the per-phone cooldown; the first must go.
      if (channel === "whatsapp") expect(result).toEqual({ ok: true });
    }
    expect(delivered[0]).toBe(`whatsapp:${OTP_PHONE}`);
  });
});

describe("login and security rules, in code and in the database", () => {
  it("refuses any change to a sign-in code — and the CHECK refuses the row", async () => {
    operator = { personId: admin };
    expect(await setNotificationSwitch("auth.email_code", "email", false, "x".repeat(20))).toEqual({
      ok: false,
      error: expect.stringContaining("never stopped") as string,
    });
    await expect(
      db.insert(notificationSwitches).values({
        kind: "auth.email_code",
        channel: "email",
        enabled: false,
      }),
    ).rejects.toThrow();
  });

  it("a security alert goes off only with a reason, audited with it", async () => {
    operator = { personId: admin };
    expect(await setNotificationSwitch("security.email_changed", "email", false)).toMatchObject({
      ok: false,
    });
    expect(
      await setNotificationSwitch("security.email_changed", "email", false, "too short"),
    ).toMatchObject({ ok: false });
    await expect(
      db.insert(notificationSwitches).values({
        kind: "security.email_changed",
        channel: "email",
        enabled: false,
        reason: "short",
      }),
    ).rejects.toThrow();

    const reason = "Mail provider is double-sending; off until the fix ships";
    const done = await setNotificationSwitch("security.email_changed", "email", false, reason);
    expect(done).toMatchObject({ ok: true });
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actor, admin), eq(auditLog.subject, "security.email_changed")));
    expect(audit).toMatchObject({
      action: "notification.switch_changed",
      scopeType: "platform",
      scopeId: "00000000000000000000000000",
    });
    expect(audit?.meta).toMatchObject({
      change: "switch",
      reason,
      before: [{ kind: "security.email_changed", channel: "email", enabled: true }],
      after: [{ kind: "security.email_changed", channel: "email", enabled: false, reason }],
    });
  });

  it("the column refuses TRUE: controllability can only be restricted", async () => {
    await expect(
      db.insert(notificationSwitches).values({
        kind: "security.phone_changed",
        channel: "email",
        personControllable: true,
      }),
    ).rejects.toThrow();
    operator = { personId: admin };
    expect(
      await setControllability("security.phone_changed", undefined, false, undefined),
    ).toMatchObject({ ok: false });
  });
});

describe("revert", () => {
  it("re-applies what a change replaced, audits the revert, and refuses once things moved on", async () => {
    operator = { personId: admin };
    const first = await setNotificationSwitch("registration.approved", "email", false, "one");
    const second = await setNotificationSwitch("registration.approved", "email", true);
    if (!first.ok || !second.ok || first.auditId === null || second.auditId === null) {
      throw new Error("setup failed");
    }
    // The first change is no longer what the switches say: refused.
    expect(await revertNotificationSwitch(first.auditId)).toMatchObject({ ok: false });

    const undo = await revertNotificationSwitch(second.auditId);
    expect(undo).toMatchObject({ ok: true });
    const [row] = await db
      .select()
      .from(notificationSwitches)
      .where(eq(notificationSwitches.kind, "registration.approved"));
    expect(row).toMatchObject({ enabled: false, reason: "one", updatedBy: admin });

    const audits = await db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actor, admin),
          inArray(auditLog.action, [...NOTIFICATION_AUDIT_ACTION_LIST]),
          eq(auditLog.subject, "registration.approved"),
        ),
      );
    expect(audits.some((a) => (a.meta as { revertOf?: string }).revertOf === second.auditId)).toBe(
      true,
    );

    // The screen offers Revert only where it would work: the undone change no
    // longer describes the switches; the revert (and, again, the first change,
    // whose state is back) does.
    const center = await notificationControlCenter(db, {});
    const byId = new Map(center.recent.map((change) => [change.id, change]));
    expect(byId.get(second.auditId)?.revertable).toBe(false);
    expect(byId.get(first.auditId)?.revertable).toBe(true);
    if (undo.ok && undo.auditId !== null) {
      expect(byId.get(undo.auditId)?.revertable).toBe(true);
    }
    const cell = center.groups
      .flatMap((g) => g.rows)
      .find((r) => r.key === "registration.approved")
      ?.cells.find((c) => c.channel === "email");
    expect(cell).toMatchObject({ state: "admin_off", reason: "one" });
  });

  it("reverts a channel kill", async () => {
    operator = { personId: admin };
    const kill = await setChannelSwitch("in_app", false, "Inbox bug");
    if (!kill.ok || kill.auditId === null) throw new Error("setup failed");
    expect(await revertNotificationSwitch(kill.auditId)).toMatchObject({ ok: true });
    expect(await db.select().from(notificationChannels)).toEqual([]);
  });
});

describe("controllability overrides", () => {
  it("a kind taken out of people's hands ignores their opt-out", async () => {
    // Control: the opt-out works while the kind is theirs.
    await enqueueMail([mail(optedOut, "theirs")], db);
    const provider = recordingMailer();
    await drainOutbox({ db, mailer: provider, personIds: [optedOut] });
    expect(await rowOf(`nsw:${RUN}:theirs`)).toMatchObject({ status: "suppressed" });

    operator = { personId: admin };
    expect(await setControllability("auction.sold", undefined, false, undefined)).toMatchObject({
      ok: true,
    });
    const rows = await db
      .select()
      .from(notificationSwitches)
      .where(eq(notificationSwitches.kind, "auction.sold"));
    // Every channel the kind is sent on, restricted — and still on.
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "in_app", "sms", "whatsapp"]);
    expect(rows.every((r) => r.enabled && r.personControllable === false)).toBe(true);

    await enqueueMail([mail(optedOut, "not-theirs")], db);
    await drainOutbox({ db, mailer: provider, personIds: [optedOut] });
    expect(provider.sent).toEqual([`nsw-out-${RUN}@example.test`]);

    // Given back: the rows go, the opt-out applies again.
    expect(await setControllability("auction.sold", undefined, true, undefined)).toMatchObject({
      ok: true,
    });
    expect(
      await db
        .select()
        .from(notificationSwitches)
        .where(eq(notificationSwitches.kind, "auction.sold")),
    ).toEqual([]);
  });
});
