import { notificationChannels, notificationSwitches, type Db } from "@desiauction/db";

import {
  NOTIFICATIONS,
  isNotificationKind,
  notificationOf,
  orgTopics,
  personTopics,
  type NotificationChannel,
  type ResolvedNotification,
  type SwitchTopic,
} from "./catalogue";

/**
 * THE PLATFORM'S SWITCHES — the admin layer of the one send gate (Notification
 * Control Center, Phase 1).
 *
 * Phase 0 left `platformSwitch` in gate.ts as a hook that always said "on".
 * This module is what it says now: a platform admin's decisions from
 * /admin/notifications, stored in `notification_switches` (one kind on one
 * channel) and `notification_channels` (a whole channel, everywhere), migration
 * 0086.
 *
 * THE ORDER INSIDE THE ADMIN LAYER, first "no" wins:
 *
 *   1. LOGIN is never here at all. The gate answers a login code before it asks
 *      this module anything, so neither a kind switch nor a CHANNEL KILL stops
 *      a sign-in code (founder rule: login codes can never be disabled). The
 *      database refuses the row too (0086 `notification_switches_login_locked`).
 *   2. THE CHANNEL. "WhatsApp is off everywhere" beats any per-kind "on".
 *   3. THE KIND ON THAT CHANNEL. A security alert may be off only with a
 *      written reason — enforced where it is written (refuseChange), and by
 *      0086's CHECK.
 *
 * THE CONTROLLABILITY OVERRIDES only RESTRICT. An admin can stop people (or
 * clubs) switching a kind off — the gate then does not show the person's switch
 * to `maySend` at all, so their opt-out stops applying to that kind. An admin
 * can never let a person or club switch off what the catalogue locks: `&&`, not
 * `??`, exactly like the catalogue's own `resolve`, and the column cannot even
 * hold TRUE (0086 `notification_switches_restrict_only`).
 *
 * READ ON EVERY SEND, SO CACHED. One load reads both tables whole (a few dozen
 * rows at most) and serves this process for thirty seconds; a write from this
 * process drops it at once (`invalidatePlatformSwitches`). Another web process
 * picks a change up within the TTL — which is what "publishes directly" means
 * for a fleet: half a minute, not a deploy.
 */

export type PlatformRefusal =
  /** An admin switched this kind off on this channel. */
  | "admin_disabled"
  /** An admin switched the whole channel off. */
  | "channel_disabled";

export interface SwitchRow {
  readonly kind: string;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  /** NULL = the catalogue's answer; FALSE = taken away from people. Never TRUE. */
  readonly personControllable: boolean | null;
  readonly orgControllable: boolean | null;
  readonly reason: string | null;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

export interface ChannelRow {
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly reason: string | null;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

export interface PlatformSwitches {
  readonly switches: ReadonlyMap<string, SwitchRow>;
  readonly channels: ReadonlyMap<NotificationChannel, ChannelRow>;
}

/** Every channel the catalogue knows, in the admin screen's order. */
export const CHANNELS: readonly NotificationChannel[] = ["email", "whatsapp", "sms", "in_app"];

export function isChannel(value: string): value is NotificationChannel {
  return (CHANNELS as readonly string[]).includes(value);
}

export function switchKey(kind: string, channel: NotificationChannel): string {
  return `${kind}|${channel}`;
}

/** No rows: everything on, every controllability the catalogue's. */
export const CATALOGUE_DEFAULTS: PlatformSwitches = { switches: new Map(), channels: new Map() };

export type PlatformVerdict =
  { readonly enabled: true } | { readonly enabled: false; readonly reason: PlatformRefusal };

/** A catalogue entry as the platform's switches leave it, on one channel. */
export interface EffectiveNotification extends ResolvedNotification {
  readonly platform: PlatformVerdict;
}

/**
 * THE RESOLUTION — pure, so the precedence is testable without a database.
 * Controllability is narrowed per channel: an admin can take the email switch
 * away from people and leave the text switch theirs.
 */
export function effectiveOn(
  snapshot: PlatformSwitches,
  entry: ResolvedNotification,
  channel: NotificationChannel,
): EffectiveNotification {
  if (entry.category === "login") {
    // Locked. Nothing below applies, the channel kill included.
    return { ...entry, platform: { enabled: true } };
  }
  const row = snapshot.switches.get(switchKey(entry.key, channel));
  const channelOn = snapshot.channels.get(channel)?.enabled ?? true;
  const platform: PlatformVerdict = !channelOn
    ? { enabled: false, reason: "channel_disabled" }
    : row !== undefined && !row.enabled
      ? { enabled: false, reason: "admin_disabled" }
      : { enabled: true };
  return {
    ...entry,
    personControllable: entry.personControllable && row?.personControllable !== false,
    orgControllable: entry.orgControllable && row?.orgControllable !== false,
    platform,
  };
}

/** Whether people may still switch this kind off on ANY of its channels. */
export function personControllableSomewhere(
  snapshot: PlatformSwitches,
  entry: ResolvedNotification,
): boolean {
  return entry.channels.some((channel) => effectiveOn(snapshot, entry, channel).personControllable);
}

export function orgControllableSomewhere(
  snapshot: PlatformSwitches,
  entry: ResolvedNotification,
): boolean {
  return entry.channels.some((channel) => effectiveOn(snapshot, entry, channel).orgControllable);
}

/**
 * The /account switches, as the platform leaves them: a topic stays only while
 * at least one kind in it is still the person's to switch. A switch for a topic
 * the gate no longer consults them on would be a switch that does nothing —
 * the thing Phase 0 removed from the org screen.
 */
export function personSwitchTopics(snapshot: PlatformSwitches): SwitchTopic[] {
  return personTopics().filter((topic) =>
    NOTIFICATIONS.some(
      (entry) => entry.topic === topic.topic && personControllableSomewhere(snapshot, entry),
    ),
  );
}

/** The /org switches, likewise. */
export function orgSwitchTopics(snapshot: PlatformSwitches): SwitchTopic[] {
  return orgTopics().filter((topic) =>
    NOTIFICATIONS.some(
      (entry) => entry.topic === topic.topic && orgControllableSomewhere(snapshot, entry),
    ),
  );
}

// ---------------------------------------------------------------------------
// Loading, and the in-process cache.
// ---------------------------------------------------------------------------

export const PLATFORM_SWITCH_TTL_MS = 30_000;

let cached: { readonly snapshot: PlatformSwitches; readonly loadedAt: number } | null = null;

/** Both tables, uncached. The admin screen reads through this. */
export async function loadPlatformSwitches(db: Db): Promise<PlatformSwitches> {
  const switchRows = await db.select().from(notificationSwitches);
  const channelRows = await db.select().from(notificationChannels);
  return {
    switches: new Map(
      switchRows.map((row) => [switchKey(row.kind, row.channel), row satisfies SwitchRow]),
    ),
    channels: new Map(channelRows.map((row) => [row.channel, row satisfies ChannelRow])),
  };
}

/**
 * The snapshot the gate reads — at most `PLATFORM_SWITCH_TTL_MS` old.
 *
 * A failed load throws rather than falling back to "all on": a kill switch
 * that silently reads as off when the table cannot be read is not a kill
 * switch. The outbox retries a row whose gate threw; a direct send reports it.
 * (Login codes never get here — gate.ts answers them first.)
 */
export async function platformSwitches(
  db: Db,
  now: number = Date.now(),
): Promise<PlatformSwitches> {
  if (cached !== null && now - cached.loadedAt < PLATFORM_SWITCH_TTL_MS) {
    return cached.snapshot;
  }
  const snapshot = await loadPlatformSwitches(db);
  cached = { snapshot, loadedAt: now };
  return snapshot;
}

/** Drop the cache — after every write in this process, and in tests. */
export function invalidatePlatformSwitches(): void {
  cached = null;
}

/**
 * THE GATE'S ONE CALL: the entry as the platform's switches leave it on this
 * channel. A login kind resolves without touching the database, so a sign-in
 * code does not depend on this table being readable.
 */
export async function withPlatformSwitches(
  db: Db,
  entry: ResolvedNotification,
  channel: NotificationChannel,
): Promise<EffectiveNotification> {
  if (entry.category === "login") {
    return effectiveOn(CATALOGUE_DEFAULTS, entry, channel);
  }
  return effectiveOn(await platformSwitches(db), entry, channel);
}

/**
 * The admin layer alone, for one kind on one channel — what the outbox asks
 * when it chooses between WhatsApp and SMS for a text that has already passed
 * the gate as a whole (outbox.ts `sendText`). A kind the catalogue does not
 * know, or does not send on this channel, is answered "on": the gate itself
 * refuses those with a reason that says so.
 */
export async function platformVerdict(
  db: Db,
  kind: string,
  channel: NotificationChannel,
): Promise<PlatformVerdict> {
  if (!isNotificationKind(kind)) return { enabled: true };
  return (await withPlatformSwitches(db, notificationOf(kind), channel)).platform;
}

// ---------------------------------------------------------------------------
// What an admin may change — pure validation, shared by the actions and tests.
// ---------------------------------------------------------------------------

/** A security alert goes off only with at least this much written reason. */
export const SECURITY_REASON_MIN = 10;
export const REASON_MAX = 500;

export type NotificationChange =
  | {
      readonly type: "switch";
      readonly kind: string;
      readonly channel: string;
      readonly enabled: boolean;
      readonly reason?: string | undefined;
    }
  | {
      readonly type: "channel";
      readonly channel: string;
      readonly enabled: boolean;
      readonly reason?: string | undefined;
    }
  | {
      readonly type: "control";
      readonly kind: string;
      /** Omitted: every channel the kind is sent on. */
      readonly channel?: string | undefined;
      /** TRUE gives the catalogue's answer back; FALSE takes the switch away. */
      readonly person?: boolean | undefined;
      readonly org?: boolean | undefined;
    };

export type ChangeRefusal = { readonly ok: false; readonly error: string };

export function normalizeReason(reason: string | undefined): string | null {
  const trimmed = reason?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Every rule a change must pass before it is written. Returns the refusal a
 * person reads, or null. The database's CHECKs repeat the ones SQL can say.
 */
export function refuseChange(change: NotificationChange): ChangeRefusal | null {
  const reason = change.type === "control" ? null : normalizeReason(change.reason);
  if (reason !== null && reason.length > REASON_MAX) {
    return { ok: false, error: `Keep the reason under ${String(REASON_MAX)} characters.` };
  }
  if (change.type === "channel") {
    return isChannel(change.channel) ? null : { ok: false, error: "There is no such channel." };
  }
  if (!isNotificationKind(change.kind)) {
    return { ok: false, error: "There is no such notification." };
  }
  const entry = notificationOf(change.kind);
  if (entry.category === "login") {
    return {
      ok: false,
      error: "Sign-in codes are never stopped — nobody could sign in without them.",
    };
  }
  if (change.channel !== undefined) {
    if (!isChannel(change.channel)) {
      return { ok: false, error: "There is no such channel." };
    }
    if (!entry.channels.includes(change.channel)) {
      return { ok: false, error: `${entry.label} is not sent on that channel.` };
    }
  }
  if (change.type === "switch") {
    if (
      !change.enabled &&
      entry.adminNeedsReason &&
      (reason === null || reason.length < SECURITY_REASON_MIN)
    ) {
      return {
        ok: false,
        error: `A security alert can only be switched off with a written reason (at least ${String(SECURITY_REASON_MIN)} characters).`,
      };
    }
    return null;
  }
  if (change.person === undefined && change.org === undefined) {
    return { ok: false, error: "Nothing to change." };
  }
  if (change.person !== undefined && !entry.personControllable) {
    return {
      ok: false,
      error: `People can never switch ${entry.label} off, so there is nothing to restrict.`,
    };
  }
  if (change.org !== undefined && !entry.orgControllable) {
    return {
      ok: false,
      error: `Clubs can never switch ${entry.label} off, so there is nothing to restrict.`,
    };
  }
  return null;
}
