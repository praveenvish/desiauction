import { rate } from "../../../../server/admin/delivery-analytics";
import type { StatusCounts } from "../../../../server/admin/delivery-analytics-views";
import { formatCount } from "../../../../server/admin/format";

/**
 * Delivery analytics' headline, derived — pure over the per-channel figures
 * the read model already counted, so the four numbers at the top of the page
 * add up to the cards under them by construction (and by test).
 */

export interface Totals {
  readonly queued: number;
  readonly sent: number;
  readonly suppressed: number;
  readonly failed: number;
}

export function totalsOf(channels: readonly StatusCounts[]): Totals {
  return channels.reduce<Totals>(
    (acc, c) => ({
      queued: acc.queued + c.sent + c.failed + c.suppressed + c.pending,
      sent: acc.sent + c.sent,
      suppressed: acc.suppressed + c.suppressed,
      failed: acc.failed + c.failed,
    }),
    { queued: 0, sent: 0, suppressed: 0, failed: 0 },
  );
}

export interface Figure {
  readonly key: keyof Totals;
  readonly label: string;
  readonly value: number;
  readonly hint: string;
  /** Drawn in the danger colour: failures, when there were any. */
  readonly alarm: boolean;
}

/** The four headline figures, each with the one fact that reads it. */
export function headlineFigures(totals: Totals, windowDays: number): Figure[] {
  return [
    {
      key: "queued",
      label: "Queued",
      value: totals.queued,
      hint: `Last ${String(windowDays)} days`,
      alarm: false,
    },
    {
      key: "sent",
      label: "Sent",
      value: totals.sent,
      hint: `${rate(totals.sent, totals.queued)} of queued`,
      alarm: false,
    },
    {
      key: "suppressed",
      label: "Held back",
      value: totals.suppressed,
      hint: totals.suppressed === 0 ? "None held back" : "Not sent — see the reasons",
      alarm: false,
    },
    {
      key: "failed",
      label: "Failed",
      value: totals.failed,
      hint: `${rate(totals.failed, totals.sent + totals.failed)} failure rate`,
      alarm: totals.failed > 0,
    },
  ];
}

/* ── Put into words: the finding, a channel, a message's cell ──────────── */

export interface Finding {
  readonly tone: "ok" | "warn";
  readonly title: string;
  readonly body: string;
}

/**
 * THE PAGE'S ONE FINDING. "5,942 of 11,266 never went — every one for No
 * verified email" sat in a side card beside the chart; it is the first thing
 * the page says now. `name` turns a reason code into words (humanAction).
 */
export function leadFinding(
  totals: Totals,
  reasons: readonly { label: string; count: number; channels: readonly string[] }[],
  name: (label: string) => string,
  channelName: (channel: string) => string,
): Finding | null {
  if (totals.queued === 0) return null;
  const notSent = totals.suppressed + totals.failed;
  if (notSent === 0) {
    return {
      tone: "ok",
      title: `Every one of ${formatCount(totals.queued)} queued messages went`,
      body: "Nothing was held back and nothing failed.",
    };
  }
  const title = `${formatCount(notSent)} of ${formatCount(totals.queued)} messages never went`;
  const top = [...reasons].sort((a, b) => b.count - a.count);
  const [first, second] = top;
  if (first === undefined) {
    return { tone: "warn", title, body: "The reasons were not recorded." };
  }
  const on = (r: { channels: readonly string[] }) =>
    r.channels.length === 0 ? "" : ` (${r.channels.map(channelName).join(", ")})`;
  const failedNote = totals.failed === 0 ? " Nothing failed." : "";
  if (first.count >= notSent || second === undefined) {
    return {
      tone: "warn",
      title: `${title} — all for one reason`,
      body: `${name(first.label)}${on(first)} held back every one of them.${failedNote}`,
    };
  }
  return {
    tone: "warn",
    title,
    body: `Mostly ${name(first.label)}${on(first)} — ${formatCount(first.count)} — and ${name(second.label)}${on(second)} — ${formatCount(second.count)}.${failedNote}`,
  };
}

/** One channel's window in a sentence; a channel with no traffic says so. */
export function channelSentence(
  c: StatusCounts,
  label: string,
  windowDays: number,
  devInbox: boolean,
): string {
  if (c.sent + c.failed + c.suppressed + c.pending === 0) {
    return `Nothing went on ${label} in the last ${String(windowDays)} days`;
  }
  const parts = [
    `${formatCount(c.sent)} ${devInbox ? "to the development inbox" : "sent"}`,
    c.suppressed > 0 ? `${formatCount(c.suppressed)} held back` : null,
    c.failed > 0 ? `${formatCount(c.failed)} failed` : null,
    c.pending > 0 ? `${formatCount(c.pending)} still queued` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}

/** A message on one channel, in words: "4,502 sent", "4,761 held back", or null. */
export function cellWords(c: StatusCounts | undefined): string | null {
  if (c === undefined) return null;
  const parts = [
    c.sent > 0 ? `${formatCount(c.sent)} sent` : null,
    c.suppressed > 0 ? `${formatCount(c.suppressed)} held back` : null,
    c.failed > 0 ? `${formatCount(c.failed)} failed` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

export interface KindLine<C extends string> {
  readonly kind: string;
  readonly label: string;
  readonly cells: Partial<Record<C, StatusCounts>>;
  readonly total: number;
}

/**
 * One row a message, a column a channel. "By kind" listed "Registration
 * approved · Email" and then "Registration approved · SMS" as two rows.
 */
export function kindMatrix<C extends string>(
  rows: readonly (StatusCounts & { kind: string; label: string; channel: C })[],
): KindLine<C>[] {
  type Line = {
    kind: string;
    label: string;
    cells: Partial<Record<C, StatusCounts>>;
    total: number;
  };
  const byKind = new Map<string, Line>();
  for (const row of rows) {
    const line: Line = byKind.get(row.kind) ?? {
      kind: row.kind,
      label: row.label,
      cells: {},
      total: 0,
    };
    line.cells[row.channel] = row;
    line.total += row.sent + row.failed + row.suppressed + row.pending;
    byKind.set(row.kind, line);
  }
  return [...byKind.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}
