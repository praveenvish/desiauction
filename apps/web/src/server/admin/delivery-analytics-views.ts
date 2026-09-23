import { messageOutbox, type Db } from "@desiauction/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { systemDb } from "../db";
import { isNotificationKind, notificationOf } from "../messaging/catalogue";
import { platformAdminGate } from "./authz";
import {
  normalizeDeliveryError,
  normalizeFailureReason,
  type AnalyticsWindow,
} from "./delivery-analytics";

/**
 * DELIVERY ANALYTICS, read (Notification Control Center, Phase 4) —
 * /admin/notifications/analytics.
 *
 * Counts, and only counts. Every query here is a GROUP BY over the outbox
 * inside the chosen window (capped at ninety days by `parseWindow`); nothing
 * selects a recipient, an address, a subject or a body. Reasons leave the
 * database as raw `last_error` strings only to be collapsed into redacted
 * labels (`normalizeFailureReason`) before anything is returned.
 *
 * THE WINDOW. `message_outbox_window_idx` (0089) leads with `created_at` and
 * carries kind, channel, status and delivery_status after it, so the counts
 * and the daily series are index-only range scans; the reason queries visit
 * the heap for their error text, but only inside the window. Keep a new query
 * here on that shape — a `created_at` range first — or it scans the table.
 *
 * SCOPE. The outbox is QUEUED messages. Sign-in codes, receipts and our own
 * security emails are sent directly and are not here; the page says so.
 */

/** The raw reason strings read before labelling, most frequent first. */
const REASON_ROWS = 500;
const DELIVERY_ERROR_ROWS = 200;
const TOP_REASONS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export const ANALYTICS_CHANNELS = ["email", "whatsapp", "sms"] as const;
export type AnalyticsChannel = (typeof ANALYTICS_CHANNELS)[number];

export interface StatusCounts {
  readonly sent: number;
  readonly failed: number;
  readonly suppressed: number;
  readonly pending: number;
}

export interface ChannelTotals extends StatusCounts {
  readonly channel: AnalyticsChannel;
  /** WhatsApp only: Meta's callbacks. Zero on the other channels. */
  readonly delivered: number;
  readonly read: number;
}

export interface KindRow extends StatusCounts {
  readonly kind: string;
  readonly label: string;
  readonly channel: AnalyticsChannel;
}

export interface ReasonRow {
  readonly label: string;
  readonly status: "failed" | "suppressed" | "undelivered";
  readonly channels: readonly AnalyticsChannel[];
  readonly count: number;
}

export interface DayRow {
  /** YYYY-MM-DD, India time. */
  readonly day: string;
  readonly sent: number;
  readonly failed: number;
  readonly suppressed: number;
}

export interface DeliveryAnalytics {
  readonly windowDays: AnalyticsWindow;
  readonly since: Date;
  readonly channels: readonly ChannelTotals[];
  readonly kinds: readonly KindRow[];
  readonly reasons: readonly ReasonRow[];
  readonly daily: readonly DayRow[];
}

const EMPTY: StatusCounts = { sent: 0, failed: 0, suppressed: 0, pending: 0 };

function isChannel(value: string): value is AnalyticsChannel {
  return (ANALYTICS_CHANNELS as readonly string[]).includes(value);
}

function add(counts: StatusCounts, status: string, n: number): StatusCounts {
  switch (status) {
    case "sent":
      return { ...counts, sent: counts.sent + n };
    case "failed":
      return { ...counts, failed: counts.failed + n };
    case "suppressed":
      return { ...counts, suppressed: counts.suppressed + n };
    case "pending":
      return { ...counts, pending: counts.pending + n };
    default:
      return counts;
  }
}

/** India's calendar day for an instant — the day the operator lived through. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The window starts at India's midnight, `days - 1` days before today: "last
 * seven days" is today and the six before it, whole days, so the totals and
 * the daily trend count exactly the same rows.
 */
export function windowStart(days: number, now: Date): Date {
  const first = istDay(new Date(now.getTime() - (days - 1) * DAY_MS));
  return new Date(Date.parse(`${first}T00:00:00.000Z`) - IST_OFFSET_MS);
}

/** Every day in the window, oldest first, zero where nothing was queued. */
export function fillDays(
  rows: readonly { day: string; status: string; n: number }[],
  days: number,
  now: Date,
): DayRow[] {
  const byDay = new Map<string, DayRow>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = istDay(new Date(now.getTime() - i * DAY_MS));
    byDay.set(day, { day, sent: 0, failed: 0, suppressed: 0 });
  }
  for (const row of rows) {
    const current = byDay.get(row.day);
    if (current === undefined) continue;
    byDay.set(row.day, {
      ...current,
      sent: current.sent + (row.status === "sent" ? row.n : 0),
      failed: current.failed + (row.status === "failed" ? row.n : 0),
      suppressed: current.suppressed + (row.status === "suppressed" ? row.n : 0),
    });
  }
  return [...byDay.values()];
}

/** Raw reason rows → labelled, merged, most frequent first. */
export function groupReasons(
  reasonRows: readonly { status: string; channel: string; lastError: string | null; n: number }[],
  deliveryRows: readonly { deliveryError: string | null; n: number }[],
): ReasonRow[] {
  const merged = new Map<
    string,
    { label: string; status: ReasonRow["status"]; channels: Set<AnalyticsChannel>; count: number }
  >();
  const put = (
    label: string,
    status: ReasonRow["status"],
    channel: AnalyticsChannel,
    n: number,
  ) => {
    const key = `${status}|${label}`;
    const entry = merged.get(key) ?? { label, status, channels: new Set(), count: 0 };
    entry.channels.add(channel);
    entry.count += n;
    merged.set(key, entry);
  };
  for (const row of reasonRows) {
    if (!isChannel(row.channel)) continue;
    if (row.status !== "failed" && row.status !== "suppressed") continue;
    put(normalizeFailureReason(row.lastError), row.status, row.channel, row.n);
  }
  for (const row of deliveryRows) {
    put(normalizeDeliveryError(row.deliveryError), "undelivered", "whatsapp", row.n);
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, TOP_REASONS)
    .map((entry) => ({
      label: entry.label,
      status: entry.status,
      channels: ANALYTICS_CHANNELS.filter((c) => entry.channels.has(c)),
      count: entry.count,
    }));
}

export async function deliveryAnalytics(
  db: Db,
  windowDays: AnalyticsWindow,
  now: Date = new Date(),
): Promise<DeliveryAnalytics> {
  const since = windowStart(windowDays, now);
  const inWindow = gte(messageOutbox.createdAt, since);

  const statusRows = await db
    .select({
      kind: messageOutbox.kind,
      channel: messageOutbox.channel,
      status: messageOutbox.status,
      deliveryStatus: messageOutbox.deliveryStatus,
      n: sql<number>`count(*)::int`,
    })
    .from(messageOutbox)
    .where(inWindow)
    .groupBy(
      messageOutbox.kind,
      messageOutbox.channel,
      messageOutbox.status,
      messageOutbox.deliveryStatus,
    );

  const count = sql<number>`count(*)::int`;
  const reasonRows = await db
    .select({
      status: messageOutbox.status,
      channel: messageOutbox.channel,
      lastError: messageOutbox.lastError,
      n: count,
    })
    .from(messageOutbox)
    .where(and(inWindow, inArray(messageOutbox.status, ["failed", "suppressed"])))
    .groupBy(messageOutbox.status, messageOutbox.channel, messageOutbox.lastError)
    .orderBy(desc(count))
    .limit(REASON_ROWS);

  const deliveryRows = await db
    .select({ deliveryError: messageOutbox.deliveryError, n: count })
    .from(messageOutbox)
    .where(
      and(
        inWindow,
        eq(messageOutbox.channel, "whatsapp"),
        eq(messageOutbox.deliveryStatus, "failed"),
      ),
    )
    .groupBy(messageOutbox.deliveryError)
    .orderBy(desc(count))
    .limit(DELIVERY_ERROR_ROWS);

  const day = sql<string>`to_char(${messageOutbox.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
  const dayRows = await db
    .select({ day, status: messageOutbox.status, n: count })
    .from(messageOutbox)
    .where(inWindow)
    .groupBy(day, messageOutbox.status);

  const channels = new Map<AnalyticsChannel, ChannelTotals>(
    ANALYTICS_CHANNELS.map((channel) => [channel, { channel, ...EMPTY, delivered: 0, read: 0 }]),
  );
  const kinds = new Map<string, KindRow>();
  for (const row of statusRows) {
    if (!isChannel(row.channel)) continue;
    const totals = channels.get(row.channel) as ChannelTotals;
    channels.set(row.channel, {
      ...totals,
      ...add(totals, row.status, row.n),
      delivered:
        totals.delivered +
        (row.deliveryStatus === "delivered" || row.deliveryStatus === "read" ? row.n : 0),
      read: totals.read + (row.deliveryStatus === "read" ? row.n : 0),
    });
    const key = `${row.kind}|${row.channel}`;
    const kind = kinds.get(key) ?? {
      kind: row.kind,
      label: isNotificationKind(row.kind) ? notificationOf(row.kind).label : row.kind,
      channel: row.channel,
      ...EMPTY,
    };
    kinds.set(key, { ...kind, ...add(kind, row.status, row.n) });
  }

  return {
    windowDays,
    since,
    channels: [...channels.values()],
    kinds: [...kinds.values()].sort(
      (a, b) =>
        b.sent + b.failed + b.suppressed - (a.sent + a.failed + a.suppressed) ||
        a.label.localeCompare(b.label) ||
        a.channel.localeCompare(b.channel),
    ),
    reasons: groupReasons(reasonRows, deliveryRows),
    daily: fillDays(dayRows, windowDays, now),
  };
}

/**
 * The page's read: `platform.admin`, or nothing. On the SYSTEM pool, because
 * the counts are across every club and the outbox is org-scoped for everyone
 * else.
 */
export async function adminDeliveryAnalytics(
  windowDays: AnalyticsWindow,
): Promise<DeliveryAnalytics | null> {
  if ((await platformAdminGate()) === null) return null;
  return deliveryAnalytics(systemDb, windowDays);
}
