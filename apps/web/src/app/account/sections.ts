/**
 * THE ACCOUNT'S SECTIONS — the settings hub's one list (2026-09-27).
 *
 * /account used to be every form on one page (3,658px on a laptop, 4,828px on
 * a phone). It is now five sections, one open at a time: the address says
 * which (`?section=`), a laptop shows the list beside the open one, and a phone
 * shows the list, then the one it opens. Pure, so the mapping of old links and
 * the status lines are tested rather than trusted.
 */

export type AccountSection = "profile" | "player" | "security" | "notifications" | "data";

export const ACCOUNT_SECTIONS: readonly { key: AccountSection; label: string }[] = [
  { key: "profile", label: "Name & contact" },
  { key: "player", label: "Player profile" },
  { key: "security", label: "Sign-in & security" },
  { key: "notifications", label: "Notifications" },
  { key: "data", label: "Privacy & data" },
];

/**
 * Old in-page anchors, and what they open now. Links elsewhere in the product
 * (and in sent emails) still say `/account#whatsapp` or `#sports`.
 */
const LEGACY: Record<string, AccountSection> = {
  profile: "profile",
  email: "profile",
  player: "player",
  sports: "player",
  security: "security",
  activity: "security",
  notifications: "notifications",
  whatsapp: "notifications",
  "message-language": "notifications",
  data: "data",
};

/** `?section=` or an old `#anchor`, read as a section; null for anything else. */
export function sectionOf(value: string | null | undefined): AccountSection | null {
  if (value === null || value === undefined) {
    return null;
  }
  const key = value.replace(/^#/, "").trim();
  return LEGACY[key] ?? null;
}

/** "4 of 5 on · English" — the notifications section at a glance. */
export function notificationsStatus(
  topics: readonly { allowed: boolean }[],
  whatsapp: boolean,
  language: string,
): string {
  const on = topics.filter((topic) => topic.allowed).length + (whatsapp ? 1 : 0);
  const all = topics.length + 1;
  const tongue = language === "hi" ? "हिन्दी" : "English";
  return `${String(on)} of ${String(all)} on · ${tongue}`;
}

/** "No passkey · 24 devices signed in" — sign-in at a glance. */
export function securityStatus(passkeys: number, devices: number): string {
  const keys =
    passkeys === 0 ? "No passkey" : `${String(passkeys)} passkey${passkeys === 1 ? "" : "s"}`;
  return `${keys} · ${String(devices)} device${devices === 1 ? "" : "s"} signed in`;
}

/** "Phone verified · no email yet" — how this account is reached. */
export function contactStatus(
  phone: string | null,
  email: string | null,
  emailVerified: boolean,
): string {
  const parts = [
    phone !== null ? "Phone verified" : "No phone",
    email === null ? "no email yet" : emailVerified ? "email verified" : "email not confirmed",
  ];
  return parts.join(" · ");
}
