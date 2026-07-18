/**
 * The rupee INPUT ADAPTER (PX-7). An organizer types "70,000" or "₹1,234.50";
 * settlement speaks integer paise and nothing else.
 *
 * This is a unit conversion at the edge, NOT a money rule: it changes no amount,
 * decides no policy, and refuses anything it cannot represent exactly. Every
 * rupee that survives it goes straight into an existing writer, which re-checks
 * it against the case fold. `@desiauction/core` owns money itself (C-7); this
 * owns only the keyboard.
 */

export type RupeeParse = { ok: true; paise: number } | { ok: false; reason: RupeeParseReason };

export type RupeeParseReason = "empty" | "invalid" | "too_large" | "zero";

/** Digits a rupee amount may carry before ×100 leaves the exact-integer range. */
const MAX_RUPEE_DIGITS = 13;

/**
 * Upholds: only an exact, non-negative rupee amount with at most two decimal
 * places becomes paise. "1,20,000" → 12000000 · "1234.5" → 123450 · "1.005" → invalid.
 */
export function parseRupees(input: string): RupeeParse {
  const cleaned = input.trim().replace(/[₹,\s]/g, "");
  if (cleaned === "") {
    return { ok: false, reason: "empty" };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, reason: "invalid" };
  }
  const [whole = "", fraction = ""] = cleaned.split(".");
  if (whole.length > MAX_RUPEE_DIGITS) {
    return { ok: false, reason: "too_large" };
  }
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) {
    return { ok: false, reason: "too_large" };
  }
  // Nothing collects, waives or refunds nothing — an empty command is a mistake,
  // and settlement should never be asked to record one.
  if (value === 0) {
    return { ok: false, reason: "zero" };
  }
  return { ok: true, paise: value };
}

export const RUPEE_PARSE_MESSAGES: Record<RupeeParseReason, string> = {
  empty: "Enter an amount.",
  invalid: "Enter an amount in rupees, like 70,000 or 1234.50.",
  too_large: "That amount is too large to record.",
  zero: "Enter an amount greater than zero.",
};
