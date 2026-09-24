import { formatAmount, paise as asPaise, type MoneyUnit } from "@desiauction/core";

import { compactFloorINR, compactINR, exactINR, ledgerINR } from "./inr";

/**
 * AN AMOUNT IN ITS SEASON'S UNIT (0091) — rupees or points.
 *
 * Every auction amount is stored ×100 of the unit it is shown in, whichever
 * unit that is, so the arithmetic on a screen never changes; only the words
 * do. A screen that shows a purse, a bid or a price asks for the formatter of
 * ITS season and never writes "₹" itself — a points league reading "₹1,000"
 * on its purse board is being told it owes money it does not.
 *
 * The four shapes mirror `inr.ts`: `exact` for a full figure, `compact` for
 * the room's shorthand, `compactFloor` for what is LEFT (never shown as more
 * than it is), `ledger` for books. Registration fees are real money in every
 * season and keep using `inr.ts` directly.
 */
export interface MoneyFormat {
  unit: MoneyUnit;
  exact: (amount: number) => string;
  compact: (amount: number) => string;
  compactFloor: (amount: number) => string;
  ledger: (amount: number) => string;
  /** The unit as a field label suffix: "₹" or "points". */
  label: string;
  /** Spoken form for announcers and alt text: "rupees" or "points". */
  word: string;
}

const INR: MoneyFormat = {
  unit: "inr",
  exact: exactINR,
  compact: compactINR,
  compactFloor: compactFloorINR,
  ledger: ledgerINR,
  label: "₹",
  word: "rupees",
};

function compactPoints(amount: number, round: (value: number) => number): string {
  const points = amount / 100;
  if (points >= 10_000_000) {
    return `${String(round((points / 10_000_000) * 100) / 100)} Cr pts`;
  }
  if (points >= 100_000) {
    return `${String(round((points / 100_000) * 100) / 100)} L pts`;
  }
  return `${round(points).toLocaleString("en-IN")} pts`;
}

const POINTS: MoneyFormat = {
  unit: "points",
  exact: (amount) => formatAmount(asPaise(amount), "points"),
  compact: (amount) => compactPoints(amount, Math.round),
  compactFloor: (amount) => compactPoints(amount, Math.floor),
  ledger: (amount) => formatAmount(asPaise(amount), "points"),
  label: "points",
  word: "points",
};

export function moneyFormat(unit: MoneyUnit): MoneyFormat {
  return unit === "points" ? POINTS : INR;
}
