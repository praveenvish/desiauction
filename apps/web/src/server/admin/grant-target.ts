import { normalizePhone } from "@desiauction/core";

import { normalizeEmail } from "../auth/email-address";

/**
 * WHO A PLATFORM GRANT IS FOR, as the operator typed it.
 *
 * `seed:admin` found people by mobile number only, but sign-in is email-first:
 * an account that signed up with an email and never added a phone could not
 * be made an administrator at all. An argument with an "@" is an email; any
 * other is a mobile number. Both go through the SAME normalisers sign-in uses,
 * so the lookup matches exactly what sign-in wrote to `people` — a local
 * normaliser that disagreed with sign-in would miss the row and report "no
 * such person" for someone who plainly exists.
 */
export type GrantTarget =
  | { kind: "email"; email: string }
  | { kind: "phone"; phone: string }
  | { kind: "invalid"; input: string };

export function parseGrantTarget(raw: string): GrantTarget {
  const input = raw.trim();
  if (input.includes("@")) {
    const email = normalizeEmail(input);
    return email === null ? { kind: "invalid", input } : { kind: "email", email };
  }
  const phone = normalizePhone(input);
  return phone.ok ? { kind: "phone", phone: phone.phone } : { kind: "invalid", input };
}

/** The target as a person would write it, for messages. */
export function describeGrantTarget(target: Exclude<GrantTarget, { kind: "invalid" }>): string {
  return target.kind === "email" ? target.email : target.phone;
}
