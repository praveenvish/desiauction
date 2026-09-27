import { rate } from "../../../../server/admin/delivery-analytics";
import type { StatusCounts } from "../../../../server/admin/delivery-analytics-views";

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
      label: "Suppressed",
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
