import {
  consentRecords,
  newId,
  notificationPreferences,
  orgMessagingSettings,
  suppressions,
  type Db,
} from "@desiauction/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { MessageCategory } from "./templates";

/**
 * THE GATE EVERY SEND PASSES THROUGH.
 *
 * Before this existed, the product texted people with no opt-in record, no
 * opt-out and no STOP handling — a grep for "opt.?out|unsubscribe|STOP to"
 * across the app and packages returned one incidental hit. Under the DPDP Act
 * and the DLT regime we have to be able to show what someone agreed to, and we
 * have to honour a STOP.
 *
 * The order is deliberate: suppression first, category second. A STOP outranks
 * everything, including a category we would otherwise be entitled to send. That
 * is both the legally safer order and the one a person expects — someone who
 * texts STOP does not care how we classify our own messages.
 *
 * Sign-in codes are the one exception and they are exempt by NOT coming through
 * here: the OTP sender is its own path. If they ever route through this module
 * they must stay exempt, because "turn off SMS" locking a person out of their
 * own account is a worse outcome than an unwanted message.
 */

export type SendDecision =
  | { readonly send: true }
  | {
      readonly send: false;
      readonly reason: "suppressed" | "opted_out" | "no_consent" | "org_disabled";
    };

/**
 * May we send this category to this contact right now?
 *
 * `scope` lets a person stop one topic without stopping the rest; a `global`
 * suppression stops everything on that channel.
 */
export async function maySend(
  db: Db,
  input: {
    contact: string;
    channel: "sms" | "email";
    category: MessageCategory;
    scope: string;
    personId?: string;
    /**
     * The club the message is sent ON BEHALF OF, when there is one.
     *
     * Omitted for platform-to-person messages (sign-in, account notices), which
     * no club may switch off. Supplying it is what subjects the send to that
     * club's own topic settings, and nothing else changes.
     */
    orgId?: string;
  },
): Promise<SendDecision> {
  const blocked = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.contact, input.contact),
        eq(suppressions.channel, input.channel),
        // A global suppression stops every topic; a scoped one stops its own.
        inArray(suppressions.scope, ["global", input.scope]),
        // A lifted row is evidence of a past STOP, not a live one.
        isNull(suppressions.liftedAt),
      ),
    )
    .limit(1);
  if (blocked.length > 0) {
    return { send: false, reason: "suppressed" };
  }
  /*
   * The per-topic preference, and a correction to the original design.
   *
   * The plan said transactional messages ignore preferences entirely. That is
   * right about CONSENT — you should not have to opt in to being told your own
   * registration was approved — and wrong about CONTROL. It would mean the
   * per-topic switches on /account did nothing for the only category this
   * product actually sends, and the copy there already promises otherwise.
   *
   * So the preference is honoured for every category. What differs is the
   * DEFAULT when no row exists: transactional is allowed until switched off,
   * promotional refused until switched on.
   *
   * Sign-in codes are unaffected because they never reach this function.
   */
  if (input.personId !== undefined) {
    const [preference] = await db
      .select({ allowed: notificationPreferences.allowed })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.personId, input.personId),
          eq(notificationPreferences.topic, input.scope),
          eq(notificationPreferences.channel, input.channel),
        ),
      )
      .limit(1);
    if (preference !== undefined && !preference.allowed) {
      return { send: false, reason: "opted_out" };
    }
  }
  /*
   * The club's own switch, checked AFTER the person's and never instead of it.
   *
   * An organizer can decide their club does not text people about registration
   * decisions. They cannot decide that it does, for someone who said otherwise —
   * the preference above has already returned by then.
   *
   * Absence means enabled, so this layer is inert until a club opens the screen.
   * The read is tenant-scoped by RLS; `notifyDecision` runs inside the
   * competition's org, which is what puts these rows in view.
   */
  if (input.orgId !== undefined) {
    const [setting] = await db
      .select({ enabled: orgMessagingSettings.enabled })
      .from(orgMessagingSettings)
      .where(
        and(
          eq(orgMessagingSettings.orgId, input.orgId),
          eq(orgMessagingSettings.topic, input.scope),
          eq(orgMessagingSettings.channel, input.channel),
        ),
      )
      .limit(1);
    if (setting !== undefined && !setting.enabled) {
      return { send: false, reason: "org_disabled" };
    }
  }
  if (input.category === "transactional") {
    // The direct consequence of something the person did, and the DLT regime
    // allows these to numbers on the DND registry. No opt-in required — only
    // the absence of a STOP and of an explicit switch-off, both checked above.
    return { send: true };
  }
  if (input.personId === undefined) {
    // Promotional to a contact we cannot tie to a person is unsendable: there
    // is nobody whose consent we could have recorded.
    return { send: false, reason: "no_consent" };
  }
  const [latest] = await db
    .select({ granted: consentRecords.granted })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.personId, input.personId),
        eq(consentRecords.purpose, `${input.channel}.promotional`),
      ),
    )
    // DESCENDING. The table is append-only, so a withdrawal is a newer row
    // rather than an edit — ascending order would read the original opt-in for
    // ever and keep sending to someone who had already said stop.
    .orderBy(desc(consentRecords.createdAt))
    .limit(1);
  return latest?.granted === true ? { send: true } : { send: false, reason: "no_consent" };
}

/**
 * Record what someone agreed to. Append-only — a withdrawal is a new row with
 * `granted: false`, never an update, so "had they agreed when we sent it?"
 * stays answerable.
 */
export async function recordConsent(
  db: Db,
  input: {
    personId: string;
    purpose: string;
    granted: boolean;
    source: "registration" | "account" | "sms_stop" | "sms_start" | "import" | "support";
    evidence?: Record<string, unknown>;
    requestIp?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  await db.insert(consentRecords).values({
    id: newId(),
    personId: input.personId,
    purpose: input.purpose,
    granted: input.granted,
    source: input.source,
    evidence: input.evidence ?? {},
    requestIp: input.requestIp ?? null,
    userAgent: input.userAgent ?? null,
  });
}

/**
 * Stop sending to a contact. Used by STOP handling, and by bounce and complaint
 * webhooks — continuing to send to a hard bounce is how a sending domain dies.
 */
export async function suppress(
  db: Db,
  input: {
    contact: string;
    channel: "sms" | "email";
    scope?: string;
    reason: "stop" | "bounce" | "complaint" | "manual" | "unreachable";
    note?: string;
  },
): Promise<void> {
  await db.insert(suppressions).values({
    id: newId(),
    contact: input.contact,
    channel: input.channel,
    scope: input.scope ?? "global",
    reason: input.reason,
    note: input.note ?? null,
  });
}

/** The topics a person can switch, in the order /account shows them. */
export const NOTIFICATION_TOPICS = [
  {
    topic: "registration",
    label: "Registration decisions",
    detail: "When an organizer approves, waitlists or declines you.",
  },
  {
    topic: "auction",
    label: "Auction updates",
    detail: "When an auction you are in is about to start, and how it went.",
  },
  {
    topic: "money",
    label: "Receipts and money",
    detail: "When a club issues you a receipt or records a payment.",
  },
] as const;

/** Every topic's current answer for one person, defaulted where unset. */
export async function preferencesFor(
  db: Db,
  personId: string,
  channel: "sms" | "email" | "in-app",
): Promise<Record<string, boolean>> {
  const rows = await db
    .select({ topic: notificationPreferences.topic, allowed: notificationPreferences.allowed })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.personId, personId),
        eq(notificationPreferences.channel, channel),
      ),
    );
  const set = new Map(rows.map((row) => [row.topic, row.allowed]));
  // Absent means ON for these, all of which are transactional. See `maySend`.
  return Object.fromEntries(
    NOTIFICATION_TOPICS.map(({ topic }) => [topic, set.get(topic) ?? true]),
  );
}

/**
 * Set one switch. Upserts, because this is a SETTING — the person's current
 * answer, not a record of what they once said. The evidence of the change goes
 * to `consent_records`, which is where evidence belongs.
 */
export async function setPreference(
  db: Db,
  input: {
    personId: string;
    topic: string;
    channel: "sms" | "email" | "in-app";
    allowed: boolean;
  },
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({
      id: newId(),
      personId: input.personId,
      topic: input.topic,
      channel: input.channel,
      allowed: input.allowed,
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.personId,
        notificationPreferences.topic,
        notificationPreferences.channel,
      ],
      set: { allowed: input.allowed, updatedAt: new Date() },
    });
  await recordConsent(db, {
    personId: input.personId,
    purpose: `${input.channel}.${input.topic}`,
    granted: input.allowed,
    source: "account",
    evidence: { via: "account notification settings" },
  });
}

/**
 * The channels a club can switch a topic off on.
 *
 * SMS only, today, and that is a statement of fact rather than a limitation of
 * this table: it is the one channel a club's messages actually go out on. Email
 * has no address to send to and in-app writes to the person's own ledger, which
 * is theirs and not a club's to silence.
 */
export const ORG_MESSAGING_CHANNELS = ["sms"] as const;

/** Every topic's current answer for one club, defaulted to on where unset. */
export async function orgMessagingSettingsFor(
  db: Db,
  orgId: string,
  channel: "sms" | "email" | "in-app" = "sms",
): Promise<Record<string, boolean>> {
  const rows = await db
    .select({ topic: orgMessagingSettings.topic, enabled: orgMessagingSettings.enabled })
    .from(orgMessagingSettings)
    .where(and(eq(orgMessagingSettings.orgId, orgId), eq(orgMessagingSettings.channel, channel)));
  const set = new Map(rows.map((row) => [row.topic, row.enabled]));
  return Object.fromEntries(
    NOTIFICATION_TOPICS.map(({ topic }) => [topic, set.get(topic) ?? true]),
  );
}

/**
 * Set one club switch. Upserts — the club's current answer, not a record of
 * what it once was. `updatedBy` keeps the change attributable without inventing
 * a second audit stream.
 */
export async function setOrgMessagingSetting(
  db: Db,
  input: {
    orgId: string;
    topic: string;
    channel: "sms" | "email" | "in-app";
    enabled: boolean;
    actorId: string;
  },
): Promise<void> {
  await db
    .insert(orgMessagingSettings)
    .values({
      id: newId(),
      orgId: input.orgId,
      topic: input.topic,
      channel: input.channel,
      enabled: input.enabled,
      updatedBy: input.actorId,
    })
    .onConflictDoUpdate({
      target: [
        orgMessagingSettings.orgId,
        orgMessagingSettings.topic,
        orgMessagingSettings.channel,
      ],
      set: { enabled: input.enabled, updatedAt: new Date(), updatedBy: input.actorId },
    });
}

/**
 * Reverse a STOP (someone texts START). The rows stay and are marked lifted
 * rather than deleted, so the history of what we were told, and when, survives.
 */
export async function liftSuppression(
  db: Db,
  input: { contact: string; channel: "sms" | "email"; at?: Date },
): Promise<void> {
  await db
    .update(suppressions)
    .set({ liftedAt: input.at ?? new Date() })
    .where(
      and(
        eq(suppressions.contact, input.contact),
        eq(suppressions.channel, input.channel),
        isNull(suppressions.liftedAt),
      ),
    );
}
