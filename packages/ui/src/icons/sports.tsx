/**
 * THE SPORT ICONS — one glyph per pack in `@desiauction/core`'s `SPORTS`.
 *
 * Deliberately its own module rather than more exports appended to
 * `icons.tsx`: that file is the tail two parallel streams both appended to,
 * and a bad merge there has already eaten the end of an icon once.
 *
 * These were inline SVGs inside the landing page's `SportGlyph`, which meant
 * the directory card, the season hero and the sign-in page could not show a
 * sport without copying them. One set, used by every public surface.
 *
 * Contract, same as `icons.tsx`: `currentColor` only — the package's guardrail
 * test rejects hex literals and rgb functions, and it scans comments too, so
 * this sentence deliberately names neither in a form it would match. 24×24
 * viewBox, decorative by default; a caller that needs it announced passes a
 * `title`.
 */
import type { ReactNode, SVGProps } from "react";

export interface SportIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  /** Announce the glyph. Omitted (the default) it is `aria-hidden`. */
  title?: string;
}

function Svg({ size = 24, title, children, ...rest }: SportIconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title === undefined ? true : undefined}
      role={title === undefined ? undefined : "img"}
      {...rest}
    >
      {title === undefined ? null : <title>{title}</title>}
      {children}
    </svg>
  );
}

/** Cricket: ball and seam, with a bat at rest. */
export function IconSportCricket(props: SportIconProps) {
  return (
    <Svg {...props}>
      <circle cx="7.5" cy="16.5" r="4" />
      <path d="M5.2 13.2c1.6 1 2.6 2.7 2.7 4.6" />
      <path d="m13 15 6.2-9.3a1.6 1.6 0 0 0-2.4-2L11 10" />
      <path d="m10.4 12.6 2.9-2.2" />
    </Svg>
  );
}

/** Box cricket: the same ball, inside the cage. */
export function IconSportBoxCricket(props: SportIconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M9.6 9.8c1.4.8 2.3 2.3 2.4 3.9M3 9h18M3 15h18" />
    </Svg>
  );
}

/** Football: the classic panelled ball. */
export function IconSportFootball(props: SportIconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 7.5 3.6 2.6-1.4 4.3H9.8l-1.4-4.3z" />
      <path d="M12 3v4.5M4.2 9.3l4.2.8M19.8 9.3l-4.2.8M7.4 19.7l2.4-5.3M16.6 19.7l-2.4-5.3" />
    </Svg>
  );
}

/** Basketball: ball with its two crossing seams. */
export function IconSportBasketball(props: SportIconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3v18" />
      <path d="M5.6 5.6c3.6 3.5 3.6 9.3 0 12.8M18.4 5.6c-3.6 3.5-3.6 9.3 0 12.8" />
    </Svg>
  );
}

/** Hockey: stick and ball. */
export function IconSportHockey(props: SportIconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3v9.5A4.5 4.5 0 0 0 11.5 17H17" />
      <path d="M17 17c1.4 0 2.4-1 2.4-2.2S18.4 12.6 17 12.6" />
      <circle cx="5" cy="19" r="2" />
      <path d="M7 3H5" />
    </Svg>
  );
}

/** Kabaddi: two players, one reaching across the line. */
export function IconSportKabaddi(props: SportIconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="5.5" r="2" />
      <path d="M7 7.5v5l-2 4M7 12.5l3 1.5M5 16.5 3.5 20" />
      <path d="M12 3v18" strokeDasharray="2 2.6" />
      <circle cx="17.5" cy="6.5" r="2" />
      <path d="M17.5 8.5V14l1.8 5M17.5 11l-3.5 1.8M19.3 19h-2" />
    </Svg>
  );
}

/** Volleyball: ball with its curved seams. */
export function IconSportVolleyball(props: SportIconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3c-3 4.5-3 9 0 18M3.6 8.4c5 1.4 9.2 3.6 12.8 9.4M20.4 8.4c-5.4.2-9.7 1.6-14 6.6" />
    </Svg>
  );
}

/** Badminton: shuttle in flight. */
export function IconSportBadminton(props: SportIconProps) {
  return (
    <Svg {...props}>
      <path d="M13.8 4.4a2.6 2.6 0 0 1 3.7 3.7l-1.6 1.6-3.7-3.7z" />
      <path d="m12.2 6 3.7 3.7-6.4 6.4a3 3 0 0 1-1.6.8l-3.6.7.7-3.6a3 3 0 0 1 .8-1.6z" />
      <path d="m8.8 9.4 3.7 3.7M6.3 11.9l3.7 3.7" />
    </Svg>
  );
}

/** Table tennis: bat and ball. */
export function IconSportTableTennis(props: SportIconProps) {
  return (
    <Svg {...props}>
      <path d="M14.8 3.6a5.6 5.6 0 0 0-7.9 7.9l1.8 1.8 7.9-7.9z" />
      <path d="m8.7 13.3 2.5 2.5a1.8 1.8 0 0 1 0 2.5l-1.4 1.4a1.8 1.8 0 0 1-2.5 0l-2.5-2.5" />
      <circle cx="18" cy="15" r="2" />
    </Svg>
  );
}

/** Pickleball: paddle with its drilled face. */
export function IconSportPickleball(props: SportIconProps) {
  return (
    <Svg {...props}>
      <path d="M12.5 3a6.5 6.5 0 0 1 0 13 6.5 6.5 0 0 1 0-13z" />
      <path d="M10.5 16v3.5a1.5 1.5 0 0 0 3 0V16" />
      <path d="M10.6 7.8h.01M14.4 7.8h.01M10.6 11.4h.01M14.4 11.4h.01" />
    </Svg>
  );
}

/** Esports: a controller. */
export function IconSportEsports(props: SportIconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 3.6l.8 4.3A2.6 2.6 0 0 1 19.2 18c-.9 0-1.7-.5-2.2-1.2L16 15.5H8l-1 1.3c-.5.7-1.3 1.2-2.2 1.2a2.6 2.6 0 0 1-2.5-3.1l.8-4.3A4.5 4.5 0 0 1 7.5 7z" />
      <path d="M7 10.6v2.2M5.9 11.7h2.2M15.6 11h.01M17.8 12.6h.01" />
    </Svg>
  );
}

/** Battle royale: the drop marker over a ring. */
export function IconSportBattleRoyale(props: SportIconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="13.5" r="7.5" />
      <circle cx="12" cy="13.5" r="3" />
      <path d="M12 2.5v4M9.2 4.2 12 6.5l2.8-2.3" />
    </Svg>
  );
}

/** Every sport we can draw, keyed by the pack key in `@desiauction/core`. */
export const SPORT_ICONS = {
  cricket: IconSportCricket,
  box_cricket: IconSportBoxCricket,
  football: IconSportFootball,
  basketball: IconSportBasketball,
  hockey: IconSportHockey,
  kabaddi: IconSportKabaddi,
  volleyball: IconSportVolleyball,
  badminton: IconSportBadminton,
  table_tennis: IconSportTableTennis,
  pickleball: IconSportPickleball,
  esports: IconSportEsports,
  battle_royale: IconSportBattleRoyale,
} as const;

export type SportIconKey = keyof typeof SPORT_ICONS;

/**
 * The glyph for a sport key. An unknown key falls back to cricket rather than
 * rendering nothing: a season always has a sport, and a blank tile in a card
 * grid reads as a broken image.
 */
export function SportIcon({ sport, ...props }: SportIconProps & { sport: string }) {
  /*
   * `sport` is a plain string from the database, so the lookup can miss — but
   * casting it to `SportIconKey` told the type-checker it never could, which
   * made the fallback below look like dead code to lint. The cast belongs on
   * the RECORD, not the key: widened this way the miss is expressible, and the
   * `??` that keeps an unknown sport from rendering a blank tile survives.
   */
  const icons: Partial<Record<string, (typeof SPORT_ICONS)[SportIconKey]>> = SPORT_ICONS;
  const Glyph = icons[sport] ?? IconSportCricket;
  return <Glyph {...props} />;
}
