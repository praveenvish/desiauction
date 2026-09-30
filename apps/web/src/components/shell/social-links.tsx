import type { ReactElement } from "react";

import { SOCIAL_ACCOUNTS, type SocialNetwork } from "../../content/social";

/**
 * THE FOOTER'S SOCIAL ROW (site footer 9.5, 2026-09-30). Filled monochrome
 * marks in round, borderless buttons, under the lockup at every width. Each is
 * a real link named for where it goes ("DesiAuction on Instagram"); `rel="me"`
 * tells the networks the profile belongs to this site.
 */
const GLYPHS: Record<SocialNetwork, ReactElement> = {
  instagram: (
    <path d="M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Zm0 1.8A3.2 3.2 0 0 0 4.8 8v8A3.2 3.2 0 0 0 8 19.2h8a3.2 3.2 0 0 0 3.2-3.2V8A3.2 3.2 0 0 0 16 4.8H8Zm4 2.9a4.3 4.3 0 1 1 0 8.6 4.3 4.3 0 0 1 0-8.6Zm0 1.8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm5.1-3.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z" />
  ),
  youtube: (
    <path d="M6.5 5h11A4.5 4.5 0 0 1 22 9.5v5a4.5 4.5 0 0 1-4.5 4.5h-11A4.5 4.5 0 0 1 2 14.5v-5A4.5 4.5 0 0 1 6.5 5Zm3.5 4v6l5.2-3L10 9Z" />
  ),
  whatsapp: (
    <path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5Zm-3.3 5.1c.2 0 .4 0 .6.4l.8 1.9c.1.2.1.4 0 .6l-.4.6c-.1.2-.2.3 0 .6a7 7 0 0 0 3.3 2.9c.2.1.4.1.5-.1l.7-.9c.2-.2.3-.2.6-.1l1.8.9c.3.1.4.2.4.4 0 .4-.2 1.2-.7 1.6-.6.5-1.4.7-2.3.5a9.5 9.5 0 0 1-5.8-5.4c-.4-.9-.5-1.9 0-2.8.3-.6.9-1.1 1.5-1.1Z" />
  ),
  x: (
    <path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L1.8 3h6.4l4.4 5.9L17.8 3Zm-1.1 16.2h1.7L7.3 4.7H5.5l11.2 14.5Z" />
  ),
  linkedin: (
    <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2.6 7.4v7.2h2.3v-7.2H7.6Zm1.2-3.7a1.3 1.3 0 1 0 0 2.7 1.3 1.3 0 0 0 0-2.7Zm3 3.7v7.2h2.3v-3.8c0-1 .6-1.6 1.4-1.6.8 0 1.2.6 1.2 1.6v3.8H19v-4.3c0-2.2-1.2-3.1-2.7-3.1-1.1 0-1.9.5-2.2 1.1v-.9h-2.3Z" />
  ),
  facebook: (
    <path d="M12 2.5a9.5 9.5 0 0 0-1.5 18.9v-6.6H8.1V12h2.4V9.9c0-2.4 1.4-3.7 3.6-3.7 1 0 2.1.2 2.1.2v2.3h-1.2c-1.2 0-1.5.7-1.5 1.5V12h2.6l-.4 2.8h-2.2v6.6A9.5 9.5 0 0 0 12 2.5Z" />
  ),
};

export function SocialLinks() {
  return (
    <ul className="shell-social" aria-label="Follow DesiAuction">
      {SOCIAL_ACCOUNTS.map((account) => (
        <li key={account.network}>
          <a
            className="shell-social-link"
            data-network={account.network}
            href={account.href}
            target="_blank"
            rel="noopener me"
            aria-label={`DesiAuction on ${account.label}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              // X's mark is one outline with its stroke cut out by winding; the
              // others are drawn as rings and need even-odd.
              fillRule={account.network === "x" ? undefined : "evenodd"}
              clipRule={account.network === "x" ? undefined : "evenodd"}
              aria-hidden
              focusable="false"
            >
              {GLYPHS[account.network]}
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}
