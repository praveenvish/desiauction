/**
 * DesiAuction's social accounts, in the order the footer shows them.
 *
 * ONLY LIVE PROFILES. An icon is listed only once its account exists and was
 * checked from a logged-out browser — a dead or generic link is worse than no
 * icon. Checked 2026-10-02: all six below load logged out. An entry also
 * becomes an Organization `sameAs` in the structured data unless it sets
 * `organization: false` — that list tells search engines which accounts ARE
 * the company, so a profile that belongs to a person (the LinkedIn admin
 * profile, until the company page exists) is linked but never claimed.
 * WhatsApp returns when a Channel exists. Nothing else in the app names an account.
 */
export type SocialNetwork =
  "instagram" | "youtube" | "whatsapp" | "x" | "linkedin" | "facebook" | "threads";

export interface SocialAccount {
  readonly network: SocialNetwork;
  /** The network's name, as the link's accessible name says it. */
  readonly label: string;
  readonly href: string;
  /** False when the profile is not the company itself. Defaults to true. */
  readonly organization?: boolean;
}

export const SOCIAL_ACCOUNTS: readonly SocialAccount[] = [
  { network: "instagram", label: "Instagram", href: "https://www.instagram.com/desiauction/" },
  { network: "youtube", label: "YouTube", href: "https://www.youtube.com/@DesiAuction" },
  { network: "facebook", label: "Facebook", href: "https://www.facebook.com/thedesiauction" },
  { network: "x", label: "X", href: "https://x.com/thedesiauction" },
  { network: "threads", label: "Threads", href: "https://www.threads.com/@desiauction" },
  {
    network: "linkedin",
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/the-desiauction-38439042b/",
    organization: false,
  },
];

/** The profiles that are the company, for the Organization's `sameAs`. */
export const ORGANIZATION_PROFILES: readonly string[] = SOCIAL_ACCOUNTS.filter(
  (account) => account.organization !== false,
).map((account) => account.href);
