import type { KitTone } from "@desiauction/ui";

import type {
  ChannelSwitchView,
  GridCell,
  GridGroup,
  GridRow,
  RecentChange,
} from "../../../server/admin/notification-views";
import { formatCount } from "../../../lib/plural";

/**
 * THE MESSAGES CONTROL CENTRE, derived — pure over the control center's read
 * model (notification-views.ts), so every sentence the page says about the
 * state of messaging is a unit test. Nothing here decides whether a message
 * goes out: that is the gate's job. This only puts the read model into words.
 */

/* ── The channel strip ─────────────────────────────────────────────────── */

export type ChannelHealthState = "live" | "not_set_up" | "off";

export interface ChannelHealth {
  readonly channel: ChannelSwitchView["channel"];
  readonly label: string;
  readonly state: ChannelHealthState;
  /** One line under the name: what is missing, why it is off, or what it did. */
  readonly line: string;
  /** Sent across every message on this channel in the window. */
  readonly sent: number;
  /** Failed in the window; the card shows it only when there were any. */
  readonly failed: number;
  /** Messages that cannot go on this live channel yet (a template missing). */
  readonly blocked: number;
  readonly reason: string | null;
  readonly updatedAt: Date | null;
}

/**
 * readiness.ts's short causes, said as what to do about them. A cause this
 * does not know is shown as it is — never swallowed.
 */
const PLAIN_CAUSE: Readonly<Record<string, string>> = {
  "Email provider not set up": "Needs an email provider: its address, key and sender",
  "WhatsApp not set up": "Needs the WhatsApp number ID and access token",
  "SMS gateway not set up": "Needs the SMS gateway key",
};

export function plainCause(cause: string): string {
  return PLAIN_CAUSE[cause] ?? cause;
}

function cellsOn(groups: readonly GridGroup[], channel: string): GridCell[] {
  return groups.flatMap((group) =>
    group.rows
      // A sign-in code never judges a channel: it is locked, and may reach a
      // dev inbox where nothing else can.
      .filter((row) => !row.locked)
      .flatMap((row) => row.cells.filter((cell) => cell.channel === channel)),
  );
}

function allCellsOn(groups: readonly GridGroup[], channel: string): GridCell[] {
  return groups.flatMap((group) =>
    group.rows.flatMap((row) => row.cells.filter((cell) => cell.channel === channel)),
  );
}

/** The most common "not set up" cause among cells that share a channel. */
function commonCause(cells: readonly GridCell[]): string | null {
  const tally = new Map<string, number>();
  for (const cell of cells) {
    if (cell.notConfigured !== null) {
      tally.set(cell.notConfigured, (tally.get(cell.notConfigured) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let most = 0;
  for (const [cause, n] of tally) {
    if (n > most) {
      best = cause;
      most = n;
    }
  }
  return best;
}

export function channelHealth(
  channels: readonly ChannelSwitchView[],
  groups: readonly GridGroup[],
  windowDays: number,
): ChannelHealth[] {
  return channels.map((channel) => {
    const cells = cellsOn(groups, channel.channel);
    const counted = allCellsOn(groups, channel.channel);
    const sent = counted.reduce((sum, cell) => sum + cell.counts.sent, 0);
    const failed = counted.reduce((sum, cell) => sum + cell.counts.failed, 0);
    const blockedCells = cells.filter((cell) => cell.notConfigured !== null);
    const nothingReady = cells.length > 0 && blockedCells.length === cells.length;
    const base = {
      channel: channel.channel,
      label: channel.label,
      sent,
      failed,
      reason: channel.reason,
      updatedAt: channel.updatedAt,
    };
    if (!channel.enabled) {
      return {
        ...base,
        state: "off",
        line: channel.reason === null ? "Switched off, no reason given" : channel.reason,
        blocked: 0,
      };
    }
    if (nothingReady) {
      return {
        ...base,
        state: "not_set_up",
        line: plainCause(commonCause(blockedCells) ?? "Not set up"),
        blocked: blockedCells.length,
      };
    }
    return {
      ...base,
      state: "live",
      line:
        sent === 0
          ? `Nothing sent in the last ${String(windowDays)} days`
          : `${formatCount(sent)} sent in the last ${String(windowDays)} days`,
      blocked: blockedCells.length,
    };
  });
}

/* ── Needs attention ───────────────────────────────────────────────────── */

export interface Attention {
  readonly title: string;
  readonly lines: readonly string[];
  /** Messages an admin switched off — the banner names each, as a way to it. */
  readonly stopped: readonly { key: string; label: string }[];
  /** The words before those names, or null when there are none. */
  readonly stoppedLead: string | null;
}

/** "Email", "Email and WhatsApp", "Email, WhatsApp and SMS". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/** Every message an admin switched off on at least one channel. */
export function switchedOffMessages(groups: readonly GridGroup[]): GridRow[] {
  return groups.flatMap((group) => group.rows.filter(isSwitchedOff));
}

function isAre(n: number): string {
  return n === 1 ? "message is" : "messages are";
}

/**
 * The one banner, or null when there is nothing to say. Channels switched off
 * everywhere lead (an incident), then channels not set up, then messages an
 * admin switched off — each named, so the banner is the list, not a count.
 */
export function attentionOf(
  health: readonly ChannelHealth[],
  groups: readonly GridGroup[],
): Attention | null {
  const off = health.filter((channel) => channel.state === "off").map((c) => c.label);
  const unset = health.filter((channel) => channel.state === "not_set_up").map((c) => c.label);
  const live = health.filter((channel) => channel.state === "live").map((c) => c.label);
  const stopped = switchedOffMessages(groups).map((row) => ({ key: row.key, label: row.label }));
  const lines: string[] = [];
  let title: string | null = null;
  if (off.length > 0) {
    title = `${listWords(off)} ${off.length === 1 ? "is" : "are"} switched off everywhere`;
  }
  if (unset.length > 0) {
    const sentence = `${listWords(unset)} ${unset.length === 1 ? "isn't" : "aren't"} set up yet`;
    if (title === null) {
      title = sentence;
    } else {
      lines.push(`${sentence}.`);
    }
    lines.push(
      live.length === 0
        ? "Nothing can go out until a channel is set up."
        : `Messages go by ${listWords(live)} until ${unset.length === 1 ? "it is" : "they are"}.`,
    );
  }
  let stoppedLead: string | null = null;
  if (stopped.length > 0) {
    if (title === null) {
      title = `${String(stopped.length)} ${isAre(stopped.length)} switched off`;
      stoppedLead = "Switched off by an admin:";
    } else {
      stoppedLead = `${String(stopped.length)} ${isAre(stopped.length)} switched off by an admin:`;
    }
  }
  return title === null ? null : { title, lines, stopped, stoppedLead };
}

/* ── A message row ─────────────────────────────────────────────────────── */

export interface ChannelChip {
  readonly channel: string;
  readonly tone: KitTone;
  readonly text: string;
  /** Sorts live channels first, then the always-on, then the stopped. */
  readonly rank: number;
}

export function chipOf(cell: GridCell): ChannelChip {
  const name = cell.channelLabel;
  if (cell.state === "locked") {
    return { channel: cell.channel, tone: "blue", text: `${name} · always`, rank: 1 };
  }
  if (cell.state === "admin_off") {
    return { channel: cell.channel, tone: "red", text: `${name} · off`, rank: 2 };
  }
  if (cell.state === "channel_off") {
    return { channel: cell.channel, tone: "amber", text: `${name} · channel off`, rank: 2 };
  }
  if (cell.notConfigured !== null) {
    return { channel: cell.channel, tone: "neutral", text: `${name} · not set up`, rank: 3 };
  }
  return {
    channel: cell.channel,
    tone: "green",
    text: cell.counts.sent > 0 ? `${name} · ${formatCount(cell.counts.sent)}` : name,
    rank: 0,
  };
}

export function chipsOf(row: GridRow): ChannelChip[] {
  // A stable sort keeps the catalogue's channel order within a rank.
  return row.cells.map(chipOf).sort((a, b) => a.rank - b.rank);
}

/** Who can stop it, in the row's words. */
export function optOutSummary(row: GridRow): string {
  if (row.locked) return "Always sent";
  const person = row.person.allowed && row.person.effective;
  const org = row.org.allowed && row.org.effective;
  if (person && org) return "People & clubs can opt out";
  if (person) return "People can opt out";
  if (org) return "Clubs can opt out";
  return "Admin only";
}

export function isSwitchedOff(row: GridRow): boolean {
  return row.cells.some((cell) => cell.state === "admin_off");
}

export const CATEGORY_TAG: Readonly<
  Record<GridRow["category"], { label: string; tone: KitTone } | null>
> = {
  login: null,
  security: { label: "Security", tone: "red" },
  transactional: null,
  operational: { label: "Our team", tone: "neutral" },
  promotional: { label: "Promotional", tone: "amber" },
};

/** What the (client) list needs of a message — plain data, no dates. */
export interface MessageRow {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly tag: { label: string; tone: KitTone } | null;
  readonly chips: readonly ChannelChip[];
  readonly optOut: string;
  readonly locked: boolean;
  readonly off: boolean;
  /** "Off on WhatsApp — “Meta template paused”", one per switched-off channel. */
  readonly offNotes: readonly string[];
}

export interface MessageGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly MessageRow[];
}

export function messageRow(row: GridRow): MessageRow {
  return {
    key: row.key,
    label: row.label,
    description: row.description,
    tag: CATEGORY_TAG[row.category],
    chips: chipsOf(row),
    optOut: optOutSummary(row),
    locked: row.locked,
    off: isSwitchedOff(row),
    offNotes: row.cells
      .filter((cell) => cell.state === "admin_off")
      .map(
        (cell) => `Off on ${cell.channelLabel}${cell.reason === null ? "" : ` — “${cell.reason}”`}`,
      ),
  };
}

export function messageGroups(groups: readonly GridGroup[]): MessageGroup[] {
  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    rows: group.rows.map(messageRow),
  }));
}

/* ── Search and quick filters ──────────────────────────────────────────── */

export type MessageFilter = "all" | "off" | "locked";

export function matchesFilter(row: MessageRow, filter: MessageFilter): boolean {
  if (filter === "off") return row.off;
  if (filter === "locked") return row.locked;
  return true;
}

export function matchesQuery(row: MessageRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return (
    row.label.toLowerCase().includes(needle) ||
    row.description.toLowerCase().includes(needle) ||
    (row.tag?.label.toLowerCase().includes(needle) ?? false)
  );
}

/** The groups that still have a row after the search and the filter; empty groups go. */
export function filterGroups(
  groups: readonly MessageGroup[],
  query: string,
  filter: MessageFilter,
): MessageGroup[] {
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => matchesFilter(row, filter) && matchesQuery(row, query)),
    }))
    .filter((group) => group.rows.length > 0);
}

/** The quick filters' counts, over the whole catalogue (not the search). */
export function filterCounts(groups: readonly MessageGroup[]): Record<MessageFilter, number> {
  const rows = groups.flatMap((group) => group.rows);
  return {
    all: rows.length,
    off: rows.filter((row) => row.off).length,
    locked: rows.filter((row) => row.locked).length,
  };
}

/* ── One message's own history ─────────────────────────────────────────── */

export function changesFor(recent: readonly RecentChange[], kind: string): RecentChange[] {
  return recent.filter((change) => change.subject === kind);
}

/** The selected message, or null for a missing or unknown `?kind=`. */
export function findRow(
  groups: readonly GridGroup[],
  kind: string | undefined,
): { group: GridGroup; row: GridRow } | null {
  if (kind === undefined || kind === "") return null;
  for (const group of groups) {
    const row = group.rows.find((candidate) => candidate.key === kind);
    if (row !== undefined) return { group, row };
  }
  return null;
}
