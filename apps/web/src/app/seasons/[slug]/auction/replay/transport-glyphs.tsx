import type { ReactNode } from "react";

/*
 * Three transport glyphs the shared icon set (@desiauction/ui, Phosphor) does
 * not carry yet — pause, skip to start, skip to end. Drawn on Phosphor's 256
 * grid with its round joins so they sit beside IconPlay and the chevrons
 * without looking borrowed. Wanted upstream as IconPause / IconSkipBack /
 * IconSkipForward; delete this file when they land.
 */

interface GlyphProps {
  size?: 16 | 20 | 24 | undefined;
}

function Glyph({ size = 16, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function GlyphPause({ size }: GlyphProps) {
  return (
    <Glyph size={size}>
      <rect x="52" y="36" width="52" height="184" rx="14" />
      <rect x="152" y="36" width="52" height="184" rx="14" />
    </Glyph>
  );
}

export function GlyphSkipBack({ size }: GlyphProps) {
  return (
    <Glyph size={size}>
      <rect x="40" y="40" width="28" height="176" rx="14" />
      <path d="M208 52.4v151.2a16 16 0 0 1-24.4 13.6L86.7 141.6a16 16 0 0 1 0-27.2l96.9-75.6A16 16 0 0 1 208 52.4Z" />
    </Glyph>
  );
}

export function GlyphSkipForward({ size }: GlyphProps) {
  return (
    <Glyph size={size}>
      <rect x="188" y="40" width="28" height="176" rx="14" />
      <path d="M48 52.4v151.2a16 16 0 0 0 24.4 13.6l96.9-75.6a16 16 0 0 0 0-27.2L72.4 38.8A16 16 0 0 0 48 52.4Z" />
    </Glyph>
  );
}
