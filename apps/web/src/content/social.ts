/**
 * DesiAuction's social accounts, in the order the footer shows them.
 *
 * Real profiles only (2026-10-02). Each `href` also becomes an Organization
 * `sameAs` in the site's structured data, so an entry must name an account the
 * company owns. Not listed yet, on purpose:
 *   · LinkedIn — the company page can't be created until the admin profile has
 *     enough connections; the personal profile is not the Organization.
 *   · Facebook, WhatsApp — no Page or Channel exists yet.
 *   · Threads — @desiauction is live, but the footer has no Threads glyph yet.
 * Add each here when it exists; nothing else in the app names an account.
 */
export type SocialNetwork = "instagram" | "youtube" | "whatsapp" | "x" | "linkedin" | "facebook";

export interface SocialAccount {
  readonly network: SocialNetwork;
  /** The network's name, as the link's accessible name says it. */
  readonly label: string;
  readonly href: string;
}

export const SOCIAL_ACCOUNTS: readonly SocialAccount[] = [
  { network: "instagram", label: "Instagram", href: "https://www.instagram.com/desiauction/" },
  { network: "youtube", label: "YouTube", href: "https://www.youtube.com/@DesiAuction" },
  { network: "x", label: "X", href: "https://x.com/thedesiauction" },
];
