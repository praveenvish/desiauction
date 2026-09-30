import type { ReactNode } from "react";

/**
 * THE AUCTION GLYPHS (home page, 2026-09-30). One family drawn for this product:
 * a 24px grid, 1.75 stroke, round caps and joins, and one gold plane per glyph —
 * the part that IS the auction (the paddle's face, the gavel's head, the
 * purse's clasp). Ink follows the text colour; gold stays gold. Decorative
 * beside a label, so aria-hidden; a control that is only an icon names itself.
 */
const GOLD = "#E6B24A";

const plane = { fill: GOLD, fillOpacity: 0.3 } as const;

const GLYPHS = {
  paddle: (
    <>
      <rect x="6" y="2.75" width="12" height="12" rx="3.6" {...plane} />
      <path d="M12 14.75v6.75" />
      <path d="M10.2 6.2h3.6l-2.2 5.4" />
    </>
  ),
  gavel: (
    <>
      <path d="M8.6 8.4 13.9 3.1l5 5-5.3 5.3z" {...plane} />
      <path d="m11.2 10.8-7.7 7.7M13 21.25h8" />
    </>
  ),
  phone: (
    <>
      <rect x="6.75" y="2.5" width="10.5" height="19" rx="2.6" />
      <path d="M12 15.5V8.5M9.4 11 12 8.4l2.6 2.6" stroke={GOLD} strokeWidth="2" />
      <path d="M10.8 18.6h2.4" />
    </>
  ),
  sold: (
    <g transform="rotate(-12 12 12)">
      <rect x="2.5" y="6.5" width="19" height="11" rx="2.4" />
      <rect x="5" y="9" width="14" height="6" rx="1" stroke={GOLD} {...plane} />
    </g>
  ),
  live: (
    <>
      <circle cx="12" cy="12" r="2.4" fill={GOLD} stroke={GOLD} />
      <path d="M8 8a5.6 5.6 0 0 0 0 8M16 8a5.6 5.6 0 0 1 0 8M5.1 5.1a9.7 9.7 0 0 0 0 13.8M18.9 5.1a9.7 9.7 0 0 1 0 13.8" />
    </>
  ),
  squad: (
    <>
      <circle cx="12" cy="8" r="3.25" {...plane} />
      <circle cx="5.2" cy="10" r="2.3" />
      <circle cx="18.8" cy="10" r="2.3" />
      <path d="M6.25 20.25a5.75 5.75 0 0 1 11.5 0M1.75 18.5a4 4 0 0 1 4.6-3.6M22.25 18.5a4 4 0 0 0-4.6-3.6" />
    </>
  ),
  fixture: (
    <>
      <rect x="3" y="4.75" width="18" height="16.5" rx="2.2" />
      <path d="M3 9.75h18M8 2.75v4M16 2.75v4" />
      <path d="M7.5 13.5l2 2.75M9.5 13.5l-2 2.75M14.5 13.4h2.2l-2.2 2.9h2.2" stroke={GOLD} />
    </>
  ),
  trophy: (
    <>
      <path d="M7.5 3.75h9v5.5a4.5 4.5 0 0 1-9 0z" {...plane} />
      <path d="M7.5 5.75H4.5a3 3 0 0 0 3.2 4M16.5 5.75h3a3 3 0 0 1-3.2 4M12 13.75v3.5M8 21.25h8M9.25 17.25h5.5" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 2.75h12v18.5l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z" />
      <path d="M9 7.5h6M9 11h6" />
      <path d="M9.5 15.2 11 16.6l3.5-3.4" stroke={GOLD} strokeWidth="2" />
    </>
  ),
  message: (
    <>
      <path d="M4 4.75h16a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-9.5l-5 3.75v-3.75H4a1.5 1.5 0 0 1-1.5-1.5v-9.5A1.5 1.5 0 0 1 4 4.75Z" />
      <path d="M7 9.25h10M7 12.75h6" stroke={GOLD} strokeWidth="2" />
    </>
  ),
  career: (
    <>
      <rect x="5" y="2.75" width="14" height="18.5" rx="2.6" />
      <circle cx="12" cy="9" r="2.75" {...plane} />
      <path d="M8.25 16.5a3.75 3.75 0 0 1 7.5 0" />
    </>
  ),
  shield: (
    <>
      <path
        d="M12 2.75 4.5 5.75v5.5c0 4.6 3.2 8.4 7.5 9.75 4.3-1.35 7.5-5.15 7.5-9.75v-5.5z"
        {...plane}
      />
      <path d="m8.8 12 2.2 2.2 4.4-4.4" />
    </>
  ),
  replay: (
    <>
      <path d="M3.75 12a8.25 8.25 0 1 0 2.4-5.8" />
      <path d="M3.75 4.5v3.75H7.5" />
      <path d="m10.25 9 5 3-5 3z" fill={GOLD} stroke={GOLD} />
    </>
  ),
  form: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke={GOLD} />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({
  name,
  size = 24,
  strokeWidth = 1.75,
}: {
  name: GlyphName;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}
