/**
 * Phone-first identity (C-24), India-first normalization. The canonical
 * stored form is E.164 (+91XXXXXXXXXX for Indian mobiles).
 */
export type NormalizedPhone = string & { readonly __brand: "NormalizedPhone" };

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export type PhoneResult = { ok: true; phone: NormalizedPhone } | { ok: false; reason: "invalid" };

/** Upholds: only plausible Indian mobiles enter the system, in one shape. */
export function normalizePhone(input: string): PhoneResult {
  const digits = input.replace(/[\s\-().]/g, "");
  const candidate = digits.startsWith("+91")
    ? digits.slice(3)
    : digits.startsWith("91") && digits.length === 12
      ? digits.slice(2)
      : digits.startsWith("0") && digits.length === 11
        ? digits.slice(1)
        : digits;
  if (!INDIAN_MOBILE.test(candidate)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, phone: `+91${candidate}` as NormalizedPhone };
}
