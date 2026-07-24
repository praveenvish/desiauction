import type { SVGProps } from "react";

/**
 * Shell icon set (PX-1 04 §4): outline, 1.5px stroke, 24-unit grid, rendered
 * at 20px default. Hand-inlined rather than a dependency so @desiauction/ui
 * stays dependency-light; geometry follows the Lucide grid so a later swap to
 * lucide-react is a drop-in. Decorative by default (aria-hidden) — parents
 * carry the accessible name.
 */
function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </svg>
  );
}

export function IconTrophy(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0Z" />
      <path d="M7 6H4a1 1 0 0 0-1 1c0 2.2 1.8 4 4 4M17 6h3a1 1 0 0 1 1 1c0 2.2-1.8 4-4 4" />
    </svg>
  );
}

export function IconUsers(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M18.5 14.6c1.5 1 2.5 2.9 2.5 5.4" />
    </svg>
  );
}

export function IconRupee(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M6 3h12M6 8h12M6 3c6 0 8 2 8 5s-2 5-8 5l8 8" />
    </svg>
  );
}

export function IconHelp(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.2-3 4" />
      <path d="M12 17.5h.01" />
    </svg>
  );
}

export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

export function IconBell(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

export function IconMenu(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconArrowLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

export function IconAlert(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 2.5 19.5h19L12 3Z" />
      <path d="M12 10v4M12 17.5h.01" />
    </svg>
  );
}

/** A season runs between two dates — the calendar is its mark throughout. */
export function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/** Matches: the cricket ball and its seam. */
export function IconMatch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6c3.5 3.5 9.3 9.3 12.8 12.8" />
      <path d="M15 3.8c-1.4 2.4-1.9 5.6.4 7.9s5.5 1.8 7.9.4M.7 11.9c2.4-1.4 5.6-1.9 7.9.4s1.8 5.5.4 7.9" />
    </svg>
  );
}

export function IconPin(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function IconArrowRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconList(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

export function IconGrid(props: SVGProps<SVGSVGElement>) {
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
export function IconKebab(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)} strokeWidth={2}>
      <path d="M12 5.5h.01M12 12h.01M12 18.5h.01" />
    </svg>
  );
}

/** Marks a link that leaves the app (help centre, docs). */
export function IconExternal(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

/**
 * The brand glyph: rising bids-as-stumps and the gavel mid-strike, with a gold
 * spark. Decorative — always wrap it in an aria-hidden chip. Filled (not the
 * outline `base` set), so it renders standalone with its own viewBox and colors
 * (bars inherit `currentColor`; the spark is fixed ceremony gold).
 */
export function BrandGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="currentColor" aria-hidden>
      <rect x="7" y="39" width="9" height="18" rx="4.5" />
      <rect x="19.5" y="30" width="9" height="27" rx="4.5" />
      <rect x="32" y="21" width="9" height="36" rx="4.5" />
      <g transform="translate(47 14) rotate(-45)">
        <rect x="3.5" y="-1.9" width="13" height="3.8" rx="1.9" />
        <rect x="-4.5" y="-9" width="9" height="18" rx="4.5" />
      </g>
      <path
        style={{ fill: "var(--ceremony-gold, #F0B429)" }}
        d="M40 13.4 L41.1 15.9 L43.6 17 L41.1 18.1 L40 20.6 L38.9 18.1 L36.4 17 L38.9 15.9 Z"
      />
    </svg>
  );
}
