import type { SVGProps } from "react";

/**
 * THE ICON SET — one file, one grid, one stroke.
 *
 * There used to be two: a shell set in this package (1.5 stroke, 20px) and a
 * marketing set in the web app (1.75 stroke, 24px), with six glyphs drawn
 * twice by different hands. The product then filled the gaps with typed
 * characters — "→", "✓", "★", "←" — and three emoji, so an arrow on one
 * screen was a font glyph and on the next a line drawing. This is the merge.
 *
 * Outline, 24-unit Lucide grid, 1.6 stroke, round caps and joins, rendered at
 * 20px by default and sized through the `size` prop. Every icon inherits
 * `currentColor`, so the same glyph reads correctly in Daylight and Floodlight.
 * Decorative by default (aria-hidden): the parent carries the accessible name.
 * Pass `aria-hidden={false}` with a `<title>` only for an icon that stands alone.
 */
export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Rendered width and height in px. Shell chrome 20, tiles 22–24, inline 16. */
  size?: number;
}

function base({ size = 20, ...props }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...props,
  };
}

/* ---------------------------------------------------------------- navigation */

export function IconHome(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </svg>
  );
}

export function IconTrophy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0Z" />
      <path d="M7 6H4a1 1 0 0 0-1 1c0 2.2 1.8 4 4 4M17 6h3a1 1 0 0 1 1 1c0 2.2-1.8 4-4 4" />
    </svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M18.5 14.6c1.5 1 2.5 2.9 2.5 5.4" />
    </svg>
  );
}

export function IconRupee(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3h12M6 8h12M6 3c6 0 8 2 8 5s-2 5-8 5l8 8" />
    </svg>
  );
}

export function IconHelp(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.2-3 4" />
      <path d="M12 17.5h.01" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

/** The row overflow trigger. Dots are drawn as zero-length round caps. */
export function IconKebab(props: IconProps) {
  return (
    <svg {...base(props)} strokeWidth={2}>
      <path d="M12 5.5h.01M12 12h.01M12 18.5h.01" />
    </svg>
  );
}

/* ------------------------------------------------------------------- status */

export function IconAlert(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 2.5 19.5h19L12 3Z" />
      <path d="M12 10v4M12 17.5h.01" />
    </svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

/** An empty ring: the "not yet" half of a checklist. */
export function IconCircle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function IconCheckCircle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.6 2.6L16.5 9" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </svg>
  );
}

/** Read-only, observation: the administration surfaces' mark. */
export function IconEye(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconStar(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <path d="M12 3.2l2.7 5.6 6.1.8-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.8L12 3.2z" />
    </svg>
  );
}

export function IconStarOutline(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.2l2.7 5.6 6.1.8-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.8L12 3.2z" />
    </svg>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M18.5 16l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" />
    </svg>
  );
}

/* ------------------------------------------------------------------- domain */

/** A season runs between two dates — the calendar is its mark throughout. */
export function IconCalendar(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/** Matches: the cricket ball and its seam. */
export function IconMatch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6c3.5 3.5 9.3 9.3 12.8 12.8" />
      <path d="M15 3.8c-1.4 2.4-1.9 5.6.4 7.9s5.5 1.8 7.9.4M.7 11.9c2.4-1.4 5.6-1.9 7.9.4s1.8 5.5.4 7.9" />
    </svg>
  );
}

export function IconPin(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function IconGavel(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.5 5.5l5 5M11 8l5 5M12.25 6.75l-4.5 4.5M17.25 11.75l-4.5 4.5" />
      <path d="M10 10l-6.5 6.5 4 4L14 14" />
      <path d="M14 20.5h7" />
    </svg>
  );
}

export function IconShieldCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l7 3v5c0 4.4-2.9 7.9-7 9.5C7.9 18.9 5 15.4 5 11V6l7-3z" />
      <path d="M9 11.5l2 2 4-4.5" />
    </svg>
  );
}

export function IconLedger(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1.5 1.5 0 0 1-1.5-1.5v-14A1.5 1.5 0 0 1 6 3.5z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export function IconReceipt(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3h12v18l-2.4-1.6L13.2 21l-2.4-1.6L8.4 21 6 19.4V3z" />
      <path d="M9.5 8h5M9.5 12h5" />
    </svg>
  );
}

export function IconFileCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5L14 3z" />
      <path d="M14 3v4.5h4.5M9 14l2 2 4-4.5" />
    </svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5" />
    </svg>
  );
}

export function IconBolt(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 2.5L5 13.5h6l-1 8 8-11h-6l1-8z" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 3.5V7h-3.5" />
    </svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}

/* ----------------------------------------------------------------- devices */

export function IconBroadcast(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
      <path d="M4.9 19a10 10 0 0 1 0-14M19.1 5a10 10 0 0 1 0 14" />
    </svg>
  );
}

export function IconTv(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="12.5" rx="2" />
      <path d="M9 21h6" />
    </svg>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="7.5" y="2.5" width="9" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

export function IconMail(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6.25L20.5 7" />
    </svg>
  );
}

export function IconCamera(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function IconMessageCircle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12a8 8 0 1 1 3.2 6.4L4 19.5l1.2-3.4A7.96 7.96 0 0 1 4 12z" />
    </svg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.4-3.8-8.5S9.5 5.9 12 3.5z" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
    </svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 14.2A8 8 0 1 1 9.8 4a6.3 6.3 0 0 0 10.2 10.2z" />
    </svg>
  );
}

export function IconVolume(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
    </svg>
  );
}

export function IconVolumeOff(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </svg>
  );
}

/* ------------------------------------------------ console kit (2026-09-19) */

export function IconLogOut(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
      <path d="M16 16.5 20.5 12 16 7.5M20.5 12H9" />
    </svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function IconChart(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4v16h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </svg>
  );
}

export function IconMegaphone(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10v4h3l7 4V6L7 10H4z" />
      <path d="M17.5 9.5a3.5 3.5 0 0 1 0 5M8 14l1.2 5h2.3L10.4 15" />
    </svg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5z" />
    </svg>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
      <path d="M4 7.5V17a2 2 0 0 0 2 2h14V9H6.5A2.5 2.5 0 0 1 4 7.5z" />
      <circle cx="16" cy="14" r="1.2" />
    </svg>
  );
}

export function IconCrown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8l4 4 4-7 4 7 4-4-1.5 10h-13L4 8z" />
      <path d="M6 20h12" />
    </svg>
  );
}

export function IconFlag(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

export function IconCog(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
      <circle cx="12" cy="12" r="6.8" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20.5 16-5-5-8.5 8.5" />
    </svg>
  );
}

export function IconFilter(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5z" />
    </svg>
  );
}

export function IconBat(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14.5 4.5 19.5 9.5 10 19l-5-5 9.5-9.5z" />
      <path d="m5 14-2 2 5 5 2-2M17 7l3-3" />
    </svg>
  );
}

export function IconBall(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M7 5.5c2.5 3.5 2.5 9.5 0 13M17 5.5c-2.5 3.5-2.5 9.5 0 13" />
    </svg>
  );
}

export function IconFile(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5z" />
      <path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" />
    </svg>
  );
}

export function IconEyeOff(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.5 6.9C3.9 8.6 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.4 9.4 0 0 0 4.4-1.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17" />
    </svg>
  );
}

export function IconXCircle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
    </svg>
  );
}

export function IconMinusCircle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12h7" />
    </svg>
  );
}

export function IconKey(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="15" r="4.5" />
      <path d="M11.2 11.8l8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2" />
    </svg>
  );
}

export function IconDevice(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M8.5 20h7M12 16.5V20" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5l.8 12.6a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.6" />
      <path d="M10 10.5v6M14 10.5v6" />
    </svg>
  );
}

export function IconInbox(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 13.5l2.6-7.8A1.5 1.5 0 0 1 7.5 4.7h9a1.5 1.5 0 0 1 1.4 1l2.6 7.8" />
      <path d="M3.5 13.5V18A1.5 1.5 0 0 0 5 19.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5h-5l-1.5 2.5h-4L8.5 13.5z" />
    </svg>
  );
}
