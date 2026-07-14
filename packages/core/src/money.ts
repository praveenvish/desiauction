/**
 * Money is integer paise, branded so rupee/paise unit bugs are type errors (C-7).
 */
export type Paise = number & { readonly __brand: "Paise" };

/** Upholds: money is a non-negative safe integer number of paise (C-7). */
export function paise(value: number): Paise {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      `money must be a non-negative integer number of paise, got: ${String(value)}`,
    );
  }
  return value as Paise;
}

/** Upholds: addition never leaves the safe-integer range silently. */
export function addPaise(a: Paise, b: Paise): Paise {
  return paise(a + b);
}

export type DeductResult = { ok: true; value: Paise } | { ok: false; reason: "insufficient" };

/** Upholds: a purse can never go negative — insufficiency is a value, not an exception (§28). */
export function deductPaise(from: Paise, amount: Paise): DeductResult {
  if (amount > from) {
    return { ok: false, reason: "insufficient" };
  }
  return { ok: true, value: paise(from - amount) };
}

/**
 * Deterministic three-way comparison — THE ordering for bids, purses and
 * ladders (M-IP4-1). Integers compare exactly; no locale, no float.
 */
export function comparePaise(a: Paise, b: Paise): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Upholds: scaling money by a whole count (e.g. reserve = players × price) stays exact. */
export function multiplyPaise(amount: Paise, factor: number): Paise {
  if (!Number.isSafeInteger(factor) || factor < 0) {
    throw new TypeError(`money factor must be a non-negative integer, got: ${String(factor)}`);
  }
  return paise(amount * factor);
}

/**
 * Canonical serialization for events and wire payloads (M-IP4-1): the plain
 * base-10 integer string. Bijective with parsePaise — deterministic, byte-stable,
 * no formatting concerns (display formatting is formatPaiseINR, a separate path).
 */
export function serializePaise(value: Paise): string {
  return String(value);
}

export type ParsePaiseResult = { ok: true; value: Paise } | { ok: false; reason: "invalid" };

/** Fail-closed inverse of serializePaise: only canonical integer strings parse. */
export function parsePaise(input: string): ParsePaiseResult {
  if (!/^(0|[1-9]\d*)$/.test(input)) {
    return { ok: false, reason: "invalid" };
  }
  const value = Number(input);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, value: paise(value) };
}

/**
 * Upholds: money renders in Indian notation with the exact value preserved (C-7).
 * 110500000 paise → "₹11,05,000" · 150 paise → "₹1.50"
 */
export function formatPaiseINR(value: Paise): string {
  const rupees = Math.floor(value / 100);
  const remainder = value % 100;
  const grouped = groupIndian(String(rupees));
  return remainder === 0 ? `₹${grouped}` : `₹${grouped}.${String(remainder).padStart(2, "0")}`;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) {
    return digits;
  }
  const last3 = digits.slice(-3);
  let head = digits.slice(0, -3);
  const groups: string[] = [];
  while (head.length > 2) {
    groups.unshift(head.slice(-2));
    head = head.slice(0, -2);
  }
  groups.unshift(head);
  return `${groups.join(",")},${last3}`;
}
