/**
 * DesiAuction's social accounts, in the order the footer shows them.
 *
 * ONLY LIVE PROFILES (2026-10-01). An icon is listed only once its account
 * exists and was checked from a logged-out browser — a dead or generic link is
 * worse than no icon, and every `href` here is also published to search
 * engines as the organisation's `sameAs`. X, Facebook, LinkedIn and WhatsApp
 * return when their profiles are confirmed (docs/operations/SOCIAL_SETUP_SHEET.md).
 * Nothing else in the app names an account.
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
];
