import {
  auditLog,
  newId,
  notificationChannels,
  notificationSwitches,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";

import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "../admin/capabilities";
import { isNotificationKind, notificationOf, type NotificationChannel } from "./catalogue";
import {
  invalidatePlatformSwitches,
  isChannel,
  normalizeReason,
  refuseChange,
  type NotificationChange,
} from "./platform-switches";

/**
 * THE ONE WRITER OF THE PLATFORM'S NOTIFICATION SWITCHES.
 *
 * Here, under server/messaging, and not under server/admin, for the reason every
 * desk's write lives outside that folder: administration's projections are
 * proven read-only by a source scan (admin-foundation.regression), and the
 * actions there only gate and call in. /admin/notifications is the only caller.
 *
 * EVERY CHANGE IS AUDITED, WITH ITS BEFORE AND AFTER. The row in `audit_log`
 * (scope platform, actor = the operator) carries the exact states the change
 * moved between, so "Revert" re-applies `before` — itself a change, audited the
 * same way — rather than guessing what the previous value was.
 *
 * TWO HANDLES. The switches are platform tables with no RLS, written on the
 * APP pool, which holds their DML. A platform-scoped audit row is refused to
 * the app role by `audit_tenant`'s WITH CHECK (0004: org or person scope only),
 * so it goes on the SYSTEM pool, the one that may write `audit_log` — exactly
 * as access-log.ts does. The audit insert runs INSIDE the switch transaction's
 * callback, before it commits: if the audit cannot be written the switch is
 * rolled back, so no change is ever live without its record.
 */

export const NOTIFICATION_AUDIT_ACTIONS = {
  switch: "notification.switch_changed",
  channel: "notification.channel_changed",
  control: "notification.control_changed",
} as const;

export const NOTIFICATION_AUDIT_ACTION_LIST: readonly string[] = Object.values(
  NOTIFICATION_AUDIT_ACTIONS,
);

/** One kind on one channel, as stored (or the catalogue default when absent). */
export interface KindState {
  readonly kind: string;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly personControllable: false | null;
  readonly orgControllable: false | null;
  readonly reason: string | null;
}

export interface ChannelState {
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly reason: string | null;
}

export type NotificationAuditMeta =
  | {
      readonly change: "switch" | "control";
      readonly before: readonly KindState[];
      readonly after: readonly KindState[];
      readonly reason: string | null;
      readonly revertOf?: string;
    }
  | {
      readonly change: "channel";
      readonly before: readonly ChannelState[];
      readonly after: readonly ChannelState[];
      readonly reason: string | null;
      readonly revertOf?: string;
    };

export interface WriteHandles {
  /** The app pool: the switch tables. */
  readonly db: Db;
  /** The system pool: the platform-scoped audit row. */
  readonly auditDb: Db;
}

export type WriteResult =
  | { readonly ok: true; readonly message: string; readonly auditId: string | null }
  | { readonly ok: false; readonly error: string };

const CHANNEL_LABELS: Readonly<Record<NotificationChannel, string>> = {
  email: "Email",
  whatsapp: "WhatsApp",
  sms: "SMS",
  in_app: "In-app",
};

export function channelLabel(channel: NotificationChannel): string {
  return CHANNEL_LABELS[channel];
}

function defaultKindState(kind: string, channel: NotificationChannel): KindState {
  return {
    kind,
    channel,
    enabled: true,
    personControllable: null,
    orgControllable: null,
    reason: null,
  };
}

function isDefaultKind(state: KindState): boolean {
  return state.enabled && state.personControllable === null && state.orgControllable === null;
}

function sameKind(a: KindState, b: KindState): boolean {
  return (
    a.enabled === b.enabled &&
    a.personControllable === b.personControllable &&
    a.orgControllable === b.orgControllable &&
    a.reason === b.reason
  );
}

function sameChannel(a: ChannelState, b: ChannelState): boolean {
  return a.enabled === b.enabled && a.reason === b.reason;
}

async function readKindStates(
  tx: Db,
  kind: string,
  channels: readonly NotificationChannel[],
): Promise<KindState[]> {
  const rows = await tx
    .select()
    .from(notificationSwitches)
    .where(
      and(
        eq(notificationSwitches.kind, kind),
        inArray(notificationSwitches.channel, [...channels]),
      ),
    )
    .for("update");
  return channels.map((channel) => {
    const row = rows.find((r) => r.channel === channel);
    if (row === undefined) return defaultKindState(kind, channel);
    return {
      kind,
      channel,
      enabled: row.enabled,
      // The column cannot hold TRUE (0086); narrowed for the type.
      personControllable: row.personControllable === false ? false : null,
      orgControllable: row.orgControllable === false ? false : null,
      reason: row.reason,
    };
  });
}

async function readChannelState(tx: Db, channel: NotificationChannel): Promise<ChannelState> {
  const [row] = await tx
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.channel, channel))
    .for("update");
  return row === undefined
    ? { channel, enabled: true, reason: null }
    : { channel, enabled: row.enabled, reason: row.reason };
}

/**
 * A row that says nothing the catalogue does not is DELETED rather than kept:
 * absence is the catalogue (0086), and the audit row keeps the history.
 */
async function writeKindState(tx: Db, state: KindState, actorId: string): Promise<void> {
  if (isDefaultKind(state)) {
    await tx
      .delete(notificationSwitches)
      .where(
        and(
          eq(notificationSwitches.kind, state.kind),
          eq(notificationSwitches.channel, state.channel),
        ),
      );
    return;
  }
  const values = {
    enabled: state.enabled,
    personControllable: state.personControllable,
    orgControllable: state.orgControllable,
    reason: state.reason,
    updatedBy: actorId,
    updatedAt: new Date(),
  };
  await tx
    .insert(notificationSwitches)
    .values({ kind: state.kind, channel: state.channel, ...values })
    .onConflictDoUpdate({
      target: [notificationSwitches.kind, notificationSwitches.channel],
      set: values,
    });
}

async function writeChannelState(tx: Db, state: ChannelState, actorId: string): Promise<void> {
  if (state.enabled) {
    await tx.delete(notificationChannels).where(eq(notificationChannels.channel, state.channel));
    return;
  }
  const values = {
    enabled: false,
    reason: state.reason,
    updatedBy: actorId,
    updatedAt: new Date(),
  };
  await tx
    .insert(notificationChannels)
    .values({ channel: state.channel, ...values })
    .onConflictDoUpdate({ target: notificationChannels.channel, set: values });
}

async function audit(
  handles: WriteHandles,
  actorId: string,
  subject: string,
  meta: NotificationAuditMeta,
): Promise<string> {
  const id = newId();
  await handles.auditDb.insert(auditLog).values({
    id,
    actor: actorId,
    action: NOTIFICATION_AUDIT_ACTIONS[meta.change],
    scopeType: PLATFORM_SCOPE_TYPE,
    scopeId: PLATFORM_SCOPE_ID,
    subject,
    meta,
  });
  return id;
}

/**
 * The next states a validated change leads to. Pure over the current ones, so
 * "what would this do" never needs a database to answer.
 */
export function nextKindStates(
  change: Extract<NotificationChange, { type: "switch" | "control" }>,
  current: readonly KindState[],
): KindState[] {
  if (change.type === "switch") {
    const reason = normalizeReason(change.reason);
    return current.map((state) => ({ ...state, enabled: change.enabled, reason }));
  }
  return current.map((state) => ({
    ...state,
    // TRUE gives the catalogue's answer back (NULL); FALSE restricts.
    ...(change.person === undefined ? {} : { personControllable: change.person ? null : false }),
    ...(change.org === undefined ? {} : { orgControllable: change.org ? null : false }),
  }));
}

function describeKind(
  change: Extract<NotificationChange, { type: "switch" | "control" }>,
  channels: readonly NotificationChannel[],
): string {
  const label = isNotificationKind(change.kind) ? notificationOf(change.kind).label : change.kind;
  const where = channels.map(channelLabel).join(", ");
  if (change.type === "switch") {
    return `${label} is ${change.enabled ? "on" : "off"} on ${where}.`;
  }
  const parts: string[] = [];
  if (change.person !== undefined) {
    parts.push(change.person ? "people can switch it off" : "people can no longer switch it off");
  }
  if (change.org !== undefined) {
    parts.push(change.org ? "clubs can switch it off" : "clubs can no longer switch it off");
  }
  return `${label}: ${parts.join("; ")}.`;
}

/**
 * Apply one admin change: validate, write, audit, drop the cache. Resolves to
 * the sentence the operator reads, or the refusal.
 */
export async function applyNotificationChange(
  handles: WriteHandles,
  actorId: string,
  change: NotificationChange,
): Promise<WriteResult> {
  const refusal = refuseChange(change);
  if (refusal !== null) return refusal;
  let result: WriteResult;
  if (change.type === "channel") {
    const channel = change.channel as NotificationChannel;
    result = await handles.db.transaction(async (tx) => {
      const before = await readChannelState(tx, channel);
      const after: ChannelState = {
        channel,
        enabled: change.enabled,
        reason: normalizeReason(change.reason),
      };
      if (sameChannel(before, after)) {
        return { ok: true, message: "Nothing changed.", auditId: null } as const;
      }
      await writeChannelState(tx, after, actorId);
      const auditId = await audit(handles, actorId, channel, {
        change: "channel",
        before: [before],
        after: [after],
        reason: after.reason,
      });
      return {
        ok: true,
        message: `${channelLabel(channel)} is ${change.enabled ? "back on" : "off everywhere"}.`,
        auditId,
      } as const;
    });
  } else {
    const entry = notificationOf(change.kind as Parameters<typeof notificationOf>[0]);
    const channels: readonly NotificationChannel[] =
      change.channel === undefined ? entry.channels : [change.channel as NotificationChannel];
    result = await handles.db.transaction(async (tx) => {
      const before = await readKindStates(tx, change.kind, channels);
      const after = nextKindStates(change, before);
      if (before.every((state, i) => sameKind(state, after[i] ?? state))) {
        return { ok: true, message: "Nothing changed.", auditId: null } as const;
      }
      for (const state of after) await writeKindState(tx, state, actorId);
      const auditId = await audit(handles, actorId, change.kind, {
        change: change.type,
        before,
        after,
        reason: change.type === "switch" ? normalizeReason(change.reason) : null,
      });
      return { ok: true, message: describeKind(change, channels), auditId } as const;
    });
  }
  invalidatePlatformSwitches();
  return result;
}

function isKindStates(value: unknown): value is KindState[] {
  return (
    Array.isArray(value) &&
    value.every(
      (s: unknown) =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as KindState).kind === "string" &&
        isNotificationKind((s as KindState).kind) &&
        isChannel((s as KindState).channel) &&
        typeof (s as KindState).enabled === "boolean",
    )
  );
}

function isChannelStates(value: unknown): value is ChannelState[] {
  return (
    Array.isArray(value) &&
    value.every(
      (s: unknown) =>
        typeof s === "object" &&
        s !== null &&
        isChannel((s as ChannelState).channel) &&
        typeof (s as ChannelState).enabled === "boolean",
    )
  );
}

/**
 * REVERT: re-apply what an audited change moved AWAY from.
 *
 * Refused when the switches have moved on since — reverting an older change on
 * top of a newer one would silently undo the newer one too. Revert the newer
 * change first; each step is on the list. A revert is itself a change, audited
 * with `revertOf`, so it can be reverted in turn.
 */
export async function revertNotificationChange(
  handles: WriteHandles,
  actorId: string,
  auditId: string,
): Promise<WriteResult> {
  const [row] = await handles.auditDb
    .select({ action: auditLog.action, subject: auditLog.subject, meta: auditLog.meta })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.id, auditId),
        eq(auditLog.scopeType, PLATFORM_SCOPE_TYPE),
        inArray(auditLog.action, [...NOTIFICATION_AUDIT_ACTION_LIST]),
      ),
    )
    .limit(1);
  if (row === undefined || row.subject === null) {
    return { ok: false, error: "That change is not on the list." };
  }
  const meta = row.meta as Partial<NotificationAuditMeta> | null;
  const moved = "Those switches have changed since. Revert the later change first.";
  let result: WriteResult;
  if (meta?.change === "channel") {
    const before = meta.before;
    const after = meta.after;
    if (!isChannelStates(before) || !isChannelStates(after) || before.length !== 1) {
      return { ok: false, error: "That change cannot be reverted." };
    }
    const target = before[0] as ChannelState;
    result = await handles.db.transaction(async (tx) => {
      const now = await readChannelState(tx, target.channel);
      if (!sameChannel(now, after[0] as ChannelState)) return { ok: false, error: moved } as const;
      await writeChannelState(tx, target, actorId);
      const id = await audit(handles, actorId, target.channel, {
        change: "channel",
        before: [now],
        after: [target],
        reason: target.reason,
        revertOf: auditId,
      });
      return {
        ok: true,
        message: `Reverted: ${channelLabel(target.channel)} is ${target.enabled ? "on" : "off everywhere"} again.`,
        auditId: id,
      } as const;
    });
  } else if (meta?.change === "switch" || meta?.change === "control") {
    const before = meta.before;
    const after = meta.after;
    if (!isKindStates(before) || !isKindStates(after) || before.length === 0) {
      return { ok: false, error: "That change cannot be reverted." };
    }
    const change = meta.change;
    const kind = row.subject;
    result = await handles.db.transaction(async (tx) => {
      const now = await readKindStates(
        tx,
        kind,
        before.map((s) => s.channel),
      );
      if (!now.every((state, i) => after[i] !== undefined && sameKind(state, after[i]))) {
        return { ok: false, error: moved } as const;
      }
      for (const state of before) await writeKindState(tx, state, actorId);
      const id = await audit(handles, actorId, kind, {
        change,
        before: now,
        after: before,
        reason: change === "switch" ? (before[0]?.reason ?? null) : null,
        revertOf: auditId,
      });
      const label = isNotificationKind(kind) ? notificationOf(kind).label : kind;
      return { ok: true, message: `Reverted: ${label} is back as it was.`, auditId: id } as const;
    });
  } else {
    return { ok: false, error: "That change cannot be reverted." };
  }
  invalidatePlatformSwitches();
  return result;
}
