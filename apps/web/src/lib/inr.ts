import { formatPaiseINR, paise as asPaise } from "@desiauction/core";

/**
 * Rupees for a screen, from paise.
 *
 * `exactINR` is the full figure in Indian grouping ("₹1,20,00,000"); `compactINR`
 * is the auction-room shorthand ("₹1.2 Cr", "₹52 L"); `ledgerINR` is exact to
 * the paisa, for books. Money is stored and compared in integer paise
 * everywhere; these only ever format — and every screen formats through here,
 * so one purse never reads two ways on two pages.
 */
export function exactINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

/**
 * There is no "K" rung: the Indian system groups at thousand, lakh and crore,
 * and its short forms are L and Cr. Below a lakh the figure is simply grouped
 * the Indian way (₹48,000), which is correct and as short as any abbreviation.
 */
export function compactINR(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 10_000_000) {
    return `₹${String(Math.round((rupees / 10_000_000) * 100) / 100)} Cr`;
  }
  if (rupees >= 100_000) {
    return `₹${String(Math.round((rupees / 100_000) * 100) / 100)} L`;
  }
  return `₹${rupees.toLocaleString("en-IN")}`;
}

/**
 * `compactINR`, rounded DOWN — for money that is LEFT.
 *
 * Rounding to nearest turned ₹1,99,98,000 of purse into "₹2 Cr of ₹2 Cr",
 * telling an owner they had spent nothing. What remains must never be shown as
 * more than it is.
 */
export function compactFloorINR(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 10_000_000) {
    return `₹${String(Math.floor((rupees / 10_000_000) * 100) / 100)} Cr`;
  }
  if (rupees >= 100_000) {
    return `₹${String(Math.floor((rupees / 100_000) * 100) / 100)} L`;
  }
  return `₹${Math.floor(rupees).toLocaleString("en-IN")}`;
}

/**
 * The LEDGER figure: exact to the paisa, in Indian grouping ("₹74,31,250.50").
 *
 * For the money surfaces whose job is to be reconciled — settlement cases,
 * payments, the finance register. `exactINR` above goes through
 * `toLocaleString`, which is fine for a whole-rupee purse but rounds and drops
 * trailing paise; a ledger must show the figure that was recorded. Delegates to
 * the core formatter, integer arithmetic throughout, so the screen and the
 * books can never disagree about a rupee.
 */
export function ledgerINR(value: number): string {
  return formatPaiseINR(asPaise(value));
}
