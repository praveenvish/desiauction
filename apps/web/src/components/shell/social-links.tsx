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
  threads: (
    <path d="M12.19 24h-.01c-3.58-.02-6.33-1.2-8.18-3.51C2.35 18.44 1.5 15.59 1.47 12.01v-.02c.03-3.58.88-6.43 2.53-8.48C5.85 1.2 8.6.02 12.18 0h.01c2.75.02 5.04.73 6.83 2.1 1.68 1.29 2.86 3.13 3.51 5.47l-2.04.57c-1.1-3.96-3.9-5.99-8.3-6.02-2.91.02-5.11.94-6.54 2.72C4.31 6.5 3.62 8.91 3.59 12c.03 3.09.72 5.5 2.06 7.16 1.43 1.79 3.63 2.7 6.54 2.72 2.62-.02 4.36-.63 5.8-2.05 1.65-1.61 1.62-3.59 1.09-4.8-.31-.71-.87-1.3-1.63-1.75-.19 1.35-.62 2.45-1.28 3.27-.89 1.1-2.14 1.7-3.73 1.79-1.2.07-2.36-.22-3.26-.8-1.06-.69-1.69-1.74-1.75-2.96-.07-1.19.41-2.29 1.33-3.08.88-.76 2.12-1.21 3.58-1.29a13.85 13.85 0 0 1 3.02.14c-.13-.74-.38-1.33-.75-1.76-.51-.59-1.31-.88-2.36-.89h-.03c-.84 0-1.99.23-2.72 1.32L7.73 7.85c.98-1.45 2.57-2.26 4.48-2.26h.04c3.2.02 5.1 1.98 5.29 5.39l.32.14c1.49.7 2.58 1.76 3.15 3.07.8 1.82.87 4.79-1.55 7.16-1.85 1.81-4.09 2.63-7.28 2.65Zm1-11.69c-.24 0-.49.01-.74.02-1.84.1-2.98.95-2.92 2.14.07 1.26 1.45 1.84 2.78 1.77 1.23-.07 2.82-.54 3.09-3.71a10.5 10.5 0 0 0-2.21-.22Z" />
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
              // X's and Threads' marks are outlines cut out by winding; the
              // others are drawn as rings and need even-odd.
              fillRule={
                account.network === "x" || account.network === "threads" ? undefined : "evenodd"
              }
              clipRule={
                account.network === "x" || account.network === "threads" ? undefined : "evenodd"
              }
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
