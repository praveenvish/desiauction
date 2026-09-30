/**
 * DesiAuction's social accounts, in the order the footer shows them.
 *
 * PLACEHOLDERS (2026-09-30): each `href` is the network's own home page until
 * the founder sends the real profile URLs. Replace the `href`s here — nothing
 * else in the app names an account. Remove an entry to drop its icon.
 */
export type SocialNetwork = "instagram" | "youtube" | "whatsapp" | "x" | "linkedin" | "facebook";

export interface SocialAccount {
  readonly network: SocialNetwork;
  /** The network's name, as the link's accessible name says it. */
  readonly label: string;
  readonly href: string;
}

export const SOCIAL_ACCOUNTS: readonly SocialAccount[] = [
  { network: "instagram", label: "Instagram", href: "https://www.instagram.com/" },
  { network: "youtube", label: "YouTube", href: "https://www.youtube.com/" },
  { network: "whatsapp", label: "WhatsApp", href: "https://www.whatsapp.com/" },
  { network: "x", label: "X", href: "https://x.com/" },
  { network: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/" },
  { network: "facebook", label: "Facebook", href: "https://www.facebook.com/" },
];
