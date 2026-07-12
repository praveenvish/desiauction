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
