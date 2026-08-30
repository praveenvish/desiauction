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

/**
 * A FEE AS A PERSON WROTE IT, IN PAISE.
 *
 * `parsePaise` is deliberately fail-closed and bijective with `serializePaise`
 * — it reads OUR canonical integer and nothing else, which is exactly right for
 * a serialized value. It is exactly wrong for a spreadsheet cell, where an
 * entry fee arrives as "500", "₹500", "1,500.00" or "500 /-".
 *
 * So this is a separate door, and it stays a separate door: nothing that reads
 * a stored amount should become tolerant, and nothing tolerant should be used
 * to read one back.
 *
 * RUPEES ARE THE UNIT ON THE PAGE. A club writes an entry fee in rupees, so a
 * bare "500" means five hundred rupees and returns 50000 paise. At most two
 * decimal places; a third is a typo we refuse rather than round, because
 * silently dropping a digit off money is the one failure nobody forgives.
 */
export function parseRupeesToPaise(input: string): ParsePaiseResult {
  const cleaned = input
    .trim()
    .replace(/^(₹|rs\.?|inr)\s*/i, "")
    .replace(/\s*(\/-|only)$/i, "")
    .replace(/,/g, "")
    .trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (match === null) {
    return { ok: false, reason: "invalid" };
  }
  const rupees = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const total = rupees * 100 + Number(fraction);
  if (!Number.isSafeInteger(total)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, value: paise(total) };
}

/** Fee states a registration desk records. */
export const FEE_STATUSES = ["pending", "paid", "waived", "refunded"] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

const FEE_STATUS_ALIASES: Record<FeeStatus, readonly string[]> = {
  pending: ["pending", "unpaid", "not paid", "due", "no", "n", "0", "false"],
  paid: ["paid", "yes", "y", "done", "received", "cleared", "1", "true", "complete"],
  waived: ["waived", "waiver", "free", "exempt", "complimentary", "comp"],
  refunded: ["refunded", "refund", "returned"],
};

const FEE_STATUS_BY_KEY: ReadonlyMap<string, FeeStatus> = new Map(
  FEE_STATUSES.flatMap((status) =>
    [status, ...FEE_STATUS_ALIASES[status]].map(
      (alias) => [alias.toLowerCase().replace(/[\s\-_]+/g, ""), status] as const,
    ),
  ),
);

/**
 * Read a fee state the way a form records it — a "Paid?" column answered "Yes"
 * is the commonest shape there is. Null for anything unplaceable, so the caller
 * reports rather than defaulting someone to `paid`.
 */
export function parseFeeStatus(value: string): FeeStatus | null {
  return FEE_STATUS_BY_KEY.get(value.trim().toLowerCase().replace(/[\s\-_]+/g, "")) ?? null;
}
