import { auditLog, messageOutbox, people, type Db } from "@desiauction/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { env } from "../../env";
import { systemDb } from "../db";
import {
  NOTIFICATIONS,
  isNotificationKind,
  notificationOf,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationTopic,
} from "../messaging/catalogue";
import { notConfiguredReason } from "../messaging/delivery-readiness";
import {
  CHANNELS,
  effectiveOn,
  loadPlatformSwitches,
  switchKey,
  type PlatformSwitches,
} from "../messaging/platform-switches";
import {
  NOTIFICATION_AUDIT_ACTION_LIST,
  channelLabel,
  type ChannelState,
  type KindState,
  type NotificationAuditMeta,
} from "../messaging/platform-switch-writer";
import { platformAdminGate } from "./authz";
import { wordingSummaries, type WordingSummary } from "./template-views";
import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "./capabilities";

/**
 * THE NOTIFICATION CONTROL CENTER, read (Phase 1) — /admin/notifications.
 *
 * A projection like every other in this folder: it reads the catalogue, the
 * platform's switches, thirty days of the outbox and the switches' own audit
 * trail, and writes nothing. The write lives in
 * server/messaging/platform-switch-writer.ts; the actions that call it are
 * notification-actions.ts.
 *
 * On the SYSTEM pool, behind `platform.admin`: the outbox counts are across
 * every club, and the recent changes are platform-scoped audit rows that no
 * tenant context can read (`audit_tenant`). Only counts leave the outbox —
 * never a body, an address or a number.
 */

export const WINDOW_DAYS = 30;
const RECENT = 20;

export type CellState =
  /** Goes out, subject to the person's and club's switches. */
  | "on"
  /** An admin switched this kind off on this channel. */
  | "admin_off"
  /** An admin switched the whole channel off. */
  | "channel_off"
  /** A sign-in code: never stopped, by anyone. */
  | "locked";

export interface CellCounts {
  readonly sent: number;
  readonly failed: number;
  readonly suppressed: number;
  /** WhatsApp only: Meta's word that it reached (or was read on) the phone. */
  readonly delivered: number;
  readonly read: number;
}

export interface GridCell {
  readonly channel: NotificationChannel;
  readonly channelLabel: string;
  readonly state: CellState;
  /** The kind's own switch on this channel — what the toggle shows. */
  readonly kindEnabled: boolean;
  readonly reason: string | null;
  /** Null when a provider is behind this cell; else why nothing can go. */
  readonly notConfigured: string | null;
  readonly counts: CellCounts;
}

export interface Controllability {
  /** The catalogue lets people (clubs) switch this kind off at all. */
  readonly allowed: boolean;
  /** …and no admin has taken that away on any channel. */
  readonly effective: boolean;
}

export interface GridRow {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly category: NotificationCategory;
  readonly locked: boolean;
  /** Security: switching off needs a reason and a warning. */
  readonly needsReason: boolean;
  readonly person: Controllability;
  readonly org: Controllability;
  readonly cells: readonly GridCell[];
}

export interface GridGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly GridRow[];
}

export interface ChannelSwitchView {
  readonly channel: NotificationChannel;
  readonly label: string;
  readonly enabled: boolean;
  readonly reason: string | null;
  readonly updatedAt: Date | null;
}

export interface RecentChange {
  readonly id: string;
  readonly at: Date;
  readonly actorName: string | null;
  readonly summary: string;
  readonly reason: string | null;
  readonly revertOf: string | null;
  /** The switches are still exactly as this change left them. */
  readonly revertable: boolean;
}

export interface NotificationCenter {
  /** Each email kind's wording: what goes out in each language, and the editor's link. */
  readonly wording: Readonly<Record<string, WordingSummary>>;
  readonly channels: readonly ChannelSwitchView[];
  readonly groups: readonly GridGroup[];
  readonly recent: readonly RecentChange[];
  readonly windowDays: number;
}

/** The grid's sections, in the catalogue's order. */
const GROUPS: readonly { key: string; label: string; topics: readonly NotificationTopic[] }[] = [
  { key: "access", label: "Sign-in and security", topics: ["login", "security"] },
  { key: "registration", label: "Registration", topics: ["registration"] },
  { key: "auction", label: "Auction and team", topics: ["auction"] },
  { key: "money", label: "Money", topics: ["money"] },
  { key: "feedback", label: "Feedback requests", topics: ["feedback"] },
  { key: "outside", label: "Demos and support", topics: ["demo", "support"] },
  { key: "staff", label: "To our own team", topics: ["staff"] },
];

const ZERO: CellCounts = { sent: 0, failed: 0, suppressed: 0, delivered: 0, read: 0 };

type CountRow = {
  kind: string;
  channel: string;
  status: string;
  deliveryStatus: string | null;
  n: number;
};

function countsBy(rows: readonly CountRow[]): Map<string, CellCounts> {
  const out = new Map<string, CellCounts>();
  for (const row of rows) {
    if (!(CHANNELS as readonly string[]).includes(row.channel)) continue;
    const key = switchKey(row.kind, row.channel as NotificationChannel);
    const c = out.get(key) ?? ZERO;
    out.set(key, {
      sent: c.sent + (row.status === "sent" ? row.n : 0),
      failed: c.failed + (row.status === "failed" ? row.n : 0),
      suppressed: c.suppressed + (row.status === "suppressed" ? row.n : 0),
      delivered:
        c.delivered +
        (row.deliveryStatus === "delivered" || row.deliveryStatus === "read" ? row.n : 0),
      read: c.read + (row.deliveryStatus === "read" ? row.n : 0),
    });
  }
  return out;
}

/** The grid, pure over its inputs. */
export function buildGrid(
  snapshot: PlatformSwitches,
  counts: ReadonlyMap<string, CellCounts>,
  envRecord: Readonly<Record<string, string | undefined>>,
): GridGroup[] {
  return GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    rows: NOTIFICATIONS.filter((entry) => group.topics.includes(entry.topic)).map((entry) => {
      const cells = entry.channels.map((channel): GridCell => {
        const effective = effectiveOn(snapshot, entry, channel);
        const row = snapshot.switches.get(switchKey(entry.key, channel));
        const kindEnabled = row?.enabled ?? true;
        const state: CellState =
          entry.category === "login"
            ? "locked"
            : !effective.platform.enabled && effective.platform.reason === "channel_disabled"
              ? "channel_off"
              : kindEnabled
                ? "on"
                : "admin_off";
        return {
          channel,
          channelLabel: channelLabel(channel),
          state,
          kindEnabled,
          reason: row?.reason ?? null,
          notConfigured: notConfiguredReason(entry, channel, envRecord),
          counts: counts.get(switchKey(entry.key, channel)) ?? ZERO,
        };
      });
      const allChannels = (test: (channel: NotificationChannel) => boolean) =>
        entry.channels.every(test);
      return {
        key: entry.key,
        label: entry.label,
        description: entry.description,
        category: entry.category,
        locked: entry.category === "login",
        needsReason: entry.adminNeedsReason,
        person: {
          allowed: entry.personControllable,
          effective:
            entry.personControllable &&
            allChannels((c) => effectiveOn(snapshot, entry, c).personControllable),
        },
        org: {
          allowed: entry.orgControllable,
          effective:
            entry.orgControllable &&
            allChannels((c) => effectiveOn(snapshot, entry, c).orgControllable),
        },
        cells,
      };
    }),
  })).filter((group) => group.rows.length > 0);
}

function kindLabel(kind: string): string {
  return isNotificationKind(kind) ? notificationOf(kind).label : kind;
}

function onOff(enabled: boolean): string {
  return enabled ? "on" : "off";
}

/** One sentence for an audited change, from its before and after. */
export function summarize(subject: string, meta: NotificationAuditMeta): string {
  if (meta.change === "channel") {
    const after = meta.after[0];
    return after === undefined
      ? `${subject} changed`
      : `${channelLabel(after.channel)} everywhere: ${after.enabled ? "back on" : "switched off"}`;
  }
  const channels = meta.after.map((s) => channelLabel(s.channel)).join(", ");
  if (meta.change === "switch") {
    const before = meta.before[0];
    const after = meta.after[0];
    return `${kindLabel(subject)} on ${channels}: ${onOff(before?.enabled ?? true)} → ${onOff(after?.enabled ?? true)}`;
  }
  const parts: string[] = [];
  const b = meta.before[0];
  const a = meta.after[0];
  if (b !== undefined && a !== undefined) {
    if (b.personControllable !== a.personControllable) {
      parts.push(
        a.personControllable === false
          ? "people can no longer turn it off"
          : "people can turn it off again",
      );
    }
    if (b.orgControllable !== a.orgControllable) {
      parts.push(
        a.orgControllable === false
          ? "clubs can no longer turn it off"
          : "clubs can turn it off again",
      );
    }
  }
  return `${kindLabel(subject)}: ${parts.length === 0 ? "who can turn it off changed" : parts.join("; ")}`;
}

function stillAsLeft(snapshot: PlatformSwitches, meta: NotificationAuditMeta): boolean {
  if (meta.change === "channel") {
    return meta.after.every((s: ChannelState) => {
      const row = snapshot.channels.get(s.channel);
      return (row?.enabled ?? true) === s.enabled && (row?.reason ?? null) === s.reason;
    });
  }
  return meta.after.every((s: KindState) => {
    const row = snapshot.switches.get(switchKey(s.kind, s.channel));
    return (
      (row?.enabled ?? true) === s.enabled &&
      (row?.personControllable === false ? false : null) === s.personControllable &&
      (row?.orgControllable === false ? false : null) === s.orgControllable &&
      (row?.reason ?? null) === s.reason
    );
  });
}

function isAuditMeta(value: unknown): value is NotificationAuditMeta {
  if (typeof value !== "object" || value === null) return false;
  const meta = value as { change?: unknown; before?: unknown; after?: unknown };
  return (
    (meta.change === "switch" || meta.change === "control" || meta.change === "channel") &&
    Array.isArray(meta.before) &&
    Array.isArray(meta.after)
  );
}

export async function notificationControlCenter(
  db: Db,
  envRecord: Readonly<Record<string, string | undefined>>,
): Promise<NotificationCenter> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const snapshot = await loadPlatformSwitches(db);
  const countRows = await db
    .select({
      kind: messageOutbox.kind,
      channel: messageOutbox.channel,
      status: messageOutbox.status,
      deliveryStatus: messageOutbox.deliveryStatus,
      n: sql<number>`count(*)::int`,
    })
    .from(messageOutbox)
    .where(gte(messageOutbox.createdAt, since))
    .groupBy(
      messageOutbox.kind,
      messageOutbox.channel,
      messageOutbox.status,
      messageOutbox.deliveryStatus,
    );
  const auditRows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      subject: auditLog.subject,
      meta: auditLog.meta,
      actorName: people.name,
    })
    .from(auditLog)
    .leftJoin(people, eq(people.id, auditLog.actor))
    .where(
      and(
        eq(auditLog.scopeType, PLATFORM_SCOPE_TYPE),
        eq(auditLog.scopeId, PLATFORM_SCOPE_ID),
        inArray(auditLog.action, [...NOTIFICATION_AUDIT_ACTION_LIST]),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(RECENT);

  const recent: RecentChange[] = auditRows.flatMap((row) => {
    if (!isAuditMeta(row.meta) || row.subject === null) return [];
    const meta = row.meta;
    return [
      {
        id: row.id,
        at: row.at,
        actorName: row.actorName,
        summary: summarize(row.subject, meta),
        reason: meta.reason,
        revertOf: meta.revertOf ?? null,
        revertable: stillAsLeft(snapshot, meta),
      },
    ];
  });

  return {
    wording: await wordingSummaries(db),
    channels: CHANNELS.map((channel) => {
      const row = snapshot.channels.get(channel);
      return {
        channel,
        label: channelLabel(channel),
        enabled: row?.enabled ?? true,
        reason: row?.reason ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    }),
    groups: buildGrid(snapshot, countsBy(countRows), envRecord),
    recent,
    windowDays: WINDOW_DAYS,
  };
}

/** The page's read: `platform.admin`, or nothing. */
export async function adminNotificationCenter(): Promise<NotificationCenter | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return notificationControlCenter(
    systemDb,
    env as unknown as Readonly<Record<string, string | undefined>>,
  );
}
