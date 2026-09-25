/**
 * THE SPORT ICONS — one glyph per pack in `@desiauction/core`'s `SPORTS`.
 *
 * ONE FAMILY WITH THE REST (wow pass, 2026-09-25). Every other icon in the
 * product is Phosphor; these were hand-drawn and sat on every card and hero
 * looking like a different hand had made them. Where Phosphor draws the sport
 * it is used as-is (regular weight). The four it does not draw — box cricket,
 * kabaddi, badminton, pickleball — are redrawn on Phosphor's own grid: a 256
 * box with a 16-unit stroke, round caps and joins, which is what "regular"
 * is, so they sit beside the others without a seam.
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
import { BasketballIcon } from "@phosphor-icons/react/dist/ssr/Basketball";
import { CricketIcon } from "@phosphor-icons/react/dist/ssr/Cricket";
import { CrosshairIcon } from "@phosphor-icons/react/dist/ssr/Crosshair";
import { GameControllerIcon } from "@phosphor-icons/react/dist/ssr/GameController";
import { HockeyIcon } from "@phosphor-icons/react/dist/ssr/Hockey";
import { PingPongIcon } from "@phosphor-icons/react/dist/ssr/PingPong";
import { SoccerBallIcon } from "@phosphor-icons/react/dist/ssr/SoccerBall";
import { VolleyballIcon } from "@phosphor-icons/react/dist/ssr/Volleyball";
import type { ReactNode, SVGProps } from "react";

export interface SportIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  /** Announce the glyph. Omitted (the default) it is `aria-hidden`. */
  title?: string;
}

type PhosphorGlyph = typeof CricketIcon;

/** A Phosphor glyph behind the sport-icon contract (size, optional title). */
function phosphor(Glyph: PhosphorGlyph, { size = 24, title, ...rest }: SportIconProps) {
  // `ref` and `color` differ in type between plain SVG props and Phosphor's;
  // neither is passed by any caller, so they are dropped rather than forwarded.
  const { ref: _ref, color: _color, ...svg } = rest;
  return (
    <Glyph
      size={size}
      weight="regular"
      aria-hidden={title === undefined ? true : undefined}
      role={title === undefined ? undefined : "img"}
      {...(title === undefined ? {} : { alt: title })}
      {...svg}
    />
  );
}

/** Phosphor's regular grid: 256 box, 16-unit stroke, round everything. */
function Svg({ size = 24, title, children, ...rest }: SportIconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={16}
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

/** Cricket: Phosphor's bat and ball. */
export function IconSportCricket(props: SportIconProps) {
  return phosphor(CricketIcon, props);
}

/** Box cricket: the ball, inside the cage's netting. */
export function IconSportBoxCricket(props: SportIconProps) {
  return (
    <Svg {...props}>
      <rect x="32" y="40" width="192" height="176" rx="16" />
      <path d="M32 96h40M184 96h40M32 160h40M184 160h40" />
      <circle cx="128" cy="128" r="40" />
      <path d="M100 100c20 12 32 34 32 58" />
    </Svg>
  );
}

/** Football: Phosphor's panelled ball. */
export function IconSportFootball(props: SportIconProps) {
  return phosphor(SoccerBallIcon, props);
}

/** Basketball: Phosphor's ball. */
export function IconSportBasketball(props: SportIconProps) {
  return phosphor(BasketballIcon, props);
}

/** Hockey: Phosphor's stick and ball. */
export function IconSportHockey(props: SportIconProps) {
  return phosphor(HockeyIcon, props);
}

/** Kabaddi: a raider reaching across the mid-line. */
export function IconSportKabaddi(props: SportIconProps) {
  return (
    <Svg {...props}>
      <circle cx="80" cy="56" r="20" />
      <path d="M80 76v56l-24 48M80 132l32 16M56 180l-16 36" />
      <path d="M128 32v192" strokeDasharray="16 20" />
      <circle cx="184" cy="64" r="20" />
      <path d="M184 84v60l20 64M184 112l-40 20M204 208h-24" />
    </Svg>
  );
}

/** Volleyball: Phosphor's ball. */
export function IconSportVolleyball(props: SportIconProps) {
  return phosphor(VolleyballIcon, props);
}

/** Badminton: a shuttlecock, cork down, feathers up. */
export function IconSportBadminton(props: SportIconProps) {
  return (
    <Svg {...props}>
      <path d="M100 176h56l32-120a16 16 0 0 0-16-16H84a16 16 0 0 0-16 16Z" />
      <path d="M106 40l14 136M150 40l-14 136" />
      <path d="M100 176v12a28 28 0 0 0 56 0v-12" />
    </Svg>
  );
}

/** Table tennis: Phosphor's bat and ball. */
export function IconSportTableTennis(props: SportIconProps) {
  return phosphor(PingPongIcon, props);
}

/** Pickleball: the solid paddle with its drilled ball. */
export function IconSportPickleball(props: SportIconProps) {
  return (
    <Svg {...props}>
      <rect x="44" y="28" width="112" height="128" rx="48" />
      <path d="M84 156v52a16 16 0 0 0 32 0v-52" />
      <circle cx="192" cy="192" r="28" />
      <path d="M186 184h.01M200 196h.01" />
    </Svg>
  );
}

/** Esports: Phosphor's controller. */
export function IconSportEsports(props: SportIconProps) {
  return phosphor(GameControllerIcon, props);
}

/** Battle royale: Phosphor's crosshair — the drop zone. */
export function IconSportBattleRoyale(props: SportIconProps) {
  return phosphor(CrosshairIcon, props);
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
