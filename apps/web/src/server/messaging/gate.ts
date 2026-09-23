import { notificationPreferences, type Db } from "@desiauction/db";
import { and, eq } from "drizzle-orm";

import {
  NOTIFICATIONS,
  notificationOf,
  type NotificationChannel,
  type NotificationKind,
  type ResolvedNotification,
} from "./catalogue";
import { maySend, type SendDecision } from "./consent";

/**
 * ONE GATE FOR EVERY SEND.
 *
 * `maySend` (consent.ts) was the gate, but only for the senders that chose to
 * call it. The receipt path, the demo and support mail, the sign-in codes and
 * the staff notices did not, so a person's "Receipts and money" switch did
 * nothing and a demo requester whose address bounced kept being mailed. Every
 * send now asks this function, naming its catalogue entry, and the entry — not
 * the call site — decides which layers apply.
 *
 * THE PRECEDENCE, top to bottom; the first layer that says no is the answer:
 *
 *   (a) LOCKED. A login code always goes. Not even a STOP stops it: the person
 *       asked for it on the screen a second ago, a STOP was about messages they
 *       did not ask for, and "I texted STOP once" must not lock somebody out of
 *       their own account. That was already the rule — the OTP sender never
 *       reached `maySend` — and is now written down where it is enforced.
 *   (b) ADMIN. The platform's switch for this kind on this channel
 *       (`platformSwitch`). Always on in Phase 0; Phase 1's /admin/notifications
 *       fills it in, and this is its one call site.
 *   (c) SUPPRESSION. A STOP, bounce or complaint on this contact and channel —
 *       for strangers too (a demo requester who bounced). Security alerts obey
 *       it: somebody who said STOP has said they want no messages, and the
 *       change is on their ledger either way (account-alert.ts).
 *   (d) THE PERSON'S SWITCH, only for kinds the catalogue makes person-
 *       controllable and only when we know who they are.
 *   (e) THE CLUB'S SWITCH, only for club-controllable kinds sent on a club's
 *       behalf (`orgId`), read on a handle scoped to that club.
 *   (f) CONSENT, for promotional only: quiet hours and a recorded opt-in.
 *       WhatsApp's own opt-in stays in the text route, where the choice of app
 *       is made.
 *
 * (d) before (e), not after: a club cannot switch a message back on for a
 * person who switched it off, and when both said no the reason recorded is the
 * PERSON's ("opted_out") — the property consent.regression pins. Either order
 * refuses the same messages; only the reason differs.
 *
 * Layers (c)–(f) are `maySend`, called with what the catalogue allows it to
 * see: no `personId` for a kind no person may switch, no `orgId` for a kind no
 * club may. So the semantics are the ones every existing test pins, not a fork.
 *
 * IN-APP has no contact and no club. Its only layers are (b) and (d), and it is
 * applied where the inbox is READ (`hiddenInboxActions`), never by not writing
 * the row: the person-scoped audit row is the evidence of what happened to
 * somebody, and a preference must not be able to erase evidence.
 */

export type GateReason =
  | Extract<SendDecision, { send: false }>["reason"]
  | "platform_disabled"
  | "channel_not_catalogued"
  /** An outbox row whose `kind` the catalogue does not know (outbox.ts). */
  | "kind_not_catalogued";

export type GateDecision =
  { readonly send: true } | { readonly send: false; readonly reason: GateReason };

export interface GateInput {
  readonly kind: NotificationKind;
  readonly channel: NotificationChannel;
  readonly recipient: {
    /** Omitted for a stranger (demo requester) or our own mailbox. */
    readonly personId?: string;
    /** The address or number it goes to. Ignored for in-app. */
    readonly contact: string;
  };
  /**
   * The club the message is sent ON BEHALF OF. `db` must then be scoped to that
   * club: `org_messaging_settings` is FORCE RLS, and on a bare pool the club's
   * switch reads as "enabled" (see `maySend`).
   */
  readonly orgId?: string;
  /** Injected so quiet hours can be tested without waiting for 10pm. */
  readonly now?: Date;
}

/**
 * THE ADMIN LAYER, Phase 0: everything on.
 *
 * Deliberately a function with the final signature rather than nothing, so
 * Phase 1 changes one body and no call site. A locked kind never reaches it.
 */
export function platformSwitch(
  kind: NotificationKind,
  channel: NotificationChannel,
): { readonly enabled: boolean } {
  // Named so Phase 1's lookup has its key; nothing is stored to look up yet.
  void kind;
  void channel;
  return { enabled: true };
}

export async function notificationGate(db: Db, input: GateInput): Promise<GateDecision> {
  const entry = notificationOf(input.kind);
  if (!entry.channels.includes(input.channel)) {
    // A sender using a channel its entry does not list is a bug in the sender.
    // Refused, with a reason that says so on the outbox row, rather than sent
    // on a channel nobody can see or switch in the admin grid.
    return { send: false, reason: "channel_not_catalogued" };
  }
  if (entry.category === "login") {
    return { send: true };
  }
  if (!platformSwitch(input.kind, input.channel).enabled) {
    return { send: false, reason: "platform_disabled" };
  }
  if (input.channel === "in_app") {
    const personId = input.recipient.personId;
    if (!entry.personControllable || personId === undefined) {
      return { send: true };
    }
    const hidden = await inAppTopicsOff(db, personId);
    return hidden.has(entry.topic) ? { send: false, reason: "opted_out" } : { send: true };
  }
  // WhatsApp is the text ROW at every layer below the admin (`rowChannelOf`).
  const row = input.channel === "whatsapp" ? "sms" : input.channel;
  const personId = input.recipient.personId;
  // Consent needs the person even where no switch does (promotional).
  const askPerson =
    personId !== undefined && (entry.personControllable || entry.category === "promotional");
  return maySend(db, {
    contact: input.recipient.contact,
    channel: row,
    category: entry.category === "promotional" ? "promotional" : "transactional",
    scope: entry.topic,
    ...(askPerson ? { personId } : {}),
    ...(entry.orgControllable && input.orgId !== undefined ? { orgId: input.orgId } : {}),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

/** Topics this person switched off for the in-app channel. */
async function inAppTopicsOff(db: Db, personId: string): Promise<Set<string>> {
  const rows = await db
    .select({ topic: notificationPreferences.topic })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.personId, personId),
        eq(notificationPreferences.channel, "in-app"),
        eq(notificationPreferences.allowed, false),
      ),
    );
  return new Set(rows.map((row) => row.topic));
}

/**
 * The inbox action keys this person should NOT be shown — the in-app gate,
 * applied at READ time for a whole page in one query.
 *
 * Same two layers `notificationGate` applies to in-app, over every in-app kind
 * at once: the admin switch, then the person's in-app switch for the kind's
 * topic. Security and sign-in rows are not catalogue kinds and are never
 * hidden — the ledger's own evidence is not a notification preference's to
 * filter.
 */
export async function hiddenInboxActions(db: Db, personId: string): Promise<string[]> {
  const off = await inAppTopicsOff(db, personId);
  const hidden: string[] = [];
  for (const entry of NOTIFICATIONS) {
    if (entry.inboxKeys.length === 0) continue;
    if (inboxHides(entry, off)) hidden.push(...entry.inboxKeys);
  }
  return hidden;
}

function inboxHides(entry: ResolvedNotification, topicsOff: ReadonlySet<string>): boolean {
  if (entry.category === "login") return false;
  if (!platformSwitch(entry.key, "in_app").enabled) return true;
  return entry.personControllable && topicsOff.has(entry.topic);
}
