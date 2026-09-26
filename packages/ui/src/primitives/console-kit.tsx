import {
  cloneElement,
  isValidElement,
  type ElementType,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

import { IconChevronRight } from "../icons/icons";
import { KitFigure } from "./console-kit-figure";
import styles from "./console-kit.module.css";

/**
 * THE CONSOLE KIT — the building blocks every signed-in screen is made of
 * (founder mockups, 2026-09-19): a tinted icon tile, a card with an icon
 * header, a figure card, a warm notice, pills and team chips, a journey
 * stepper and a hero banner. One implementation each, so a Teams page and an
 * Auction page cannot drift apart. Colours come from theme tokens only; the
 * tints are mixed from them, so light and dark both hold.
 */

export type KitTone = "gold" | "green" | "blue" | "amber" | "purple" | "red" | "neutral";

/**
 * ONE CONCEPT, ONE COLOUR (wow pass, 2026-09-25). Tones used to be picked per
 * call site, so Teams was green on /home and red on the season overview, and
 * seven tints rotated with no meaning. A tile, card or figure that names a
 * concept passes `concept` instead of `tone`, and the colour comes from here —
 * so the same idea reads the same colour on every screen.
 *
 * ROUND 2 (2026-09-26): one calm palette. Gold for the primary thing (the
 * season, its money, its auction), neutral for information, and green / amber
 * / red only when the tile states something true (done, waiting, wrong).
 * `blue` and `purple` stay in the type for backwards compatibility but draw
 * the neutral recipe — no screen gets a hue that means nothing.
 */
export type KitConcept =
  | "season"
  | "tournament"
  | "club"
  | "teams"
  | "players"
  | "money"
  | "auction"
  | "fixtures"
  | "venue"
  | "results"
  | "alert"
  | "done"
  | "activity"
  | "neutral";

export const CONCEPT_TONE: Record<KitConcept, KitTone> = {
  // Gold: the thing the product is about — the season and its money night.
  season: "gold",
  tournament: "gold",
  club: "gold",
  money: "gold",
  auction: "gold",
  // Neutral: information. A tile that only says "this card is about teams"
  // is a label, and a label is not a colour.
  teams: "neutral",
  players: "neutral",
  fixtures: "neutral",
  venue: "neutral",
  results: "neutral",
  activity: "neutral",
  neutral: "neutral",
  // State, and only state, is coloured.
  alert: "red",
  done: "green",
};

/** The tone a concept stands for, else the explicit tone, else the fallback. */
export function kitTone(
  concept: KitConcept | undefined,
  tone: KitTone | undefined,
  fallback: KitTone = "gold",
): KitTone {
  return concept !== undefined ? CONCEPT_TONE[concept] : (tone ?? fallback);
}

type DataAttrs = { [key: `data-${string}`]: string | undefined };

/** Tile icons draw Phosphor's duotone weight unless the caller chose one. */
function duotone(icon: ReactNode): ReactNode {
  if (!isValidElement(icon)) {
    return icon;
  }
  const props = icon.props as { weight?: string };
  if (props.weight !== undefined || typeof icon.type === "string") {
    return icon;
  }
  return cloneElement(icon as ReactElement<{ weight?: string }>, { weight: "duotone" });
}

/* ---- Icon tile ------------------------------------------------------------ */

export interface IconTileProps {
  icon: ReactNode;
  tone?: KitTone;
  /** Wins over `tone`: the colour this concept always wears. */
  concept?: KitConcept;
  size?: "sm" | "md" | "lg";
}

/** A rounded square of tint with an icon in it — decorative, never the name. */
export function IconTile({ icon, tone, concept, size = "md" }: IconTileProps) {
  return (
    <span
      className={`${styles["tile"] ?? ""} ${styles["toned"] ?? ""}`}
      data-tone={kitTone(concept, tone)}
      data-size={size}
      aria-hidden
    >
      {duotone(icon)}
    </span>
  );
}

/* ---- Section card --------------------------------------------------------- */

export interface SectionCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  icon?: ReactNode;
  tone?: KitTone;
  /** Wins over `tone` for the header tile. */
  concept?: KitConcept;
  description?: ReactNode;
  /** Right side of the header: a "View all →" link, a settings button. */
  action?: ReactNode;
  /** Heading level for the title (default 2). */
  headingLevel?: 2 | 3;
  /** Drop the body padding — for a table that runs edge to edge. */
  flush?: boolean;
  /**
   * "feature": 20px padding for a page's lead card. "default": 16px (the
   * console density). The header can also be visually hidden with
   * `hideHeader` when an EmptyState inside says the same thing.
   */
  size?: "default" | "feature";
  /** Keep the title for assistive tech only (the body names the card). */
  hideHeader?: boolean;
  children?: ReactNode;
}

export function SectionCard({
  title,
  icon,
  tone,
  concept,
  description,
  action,
  headingLevel = 2,
  flush = false,
  size = "default",
  hideHeader = false,
  children,
  className,
  ...rest
}: SectionCardProps) {
  const Heading: ElementType = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      className={[styles["card"], className ?? ""].filter(Boolean).join(" ")}
      data-flush={flush ? "true" : undefined}
      data-size={size === "feature" ? "feature" : undefined}
      {...rest}
    >
      <header className={styles["card-head"]} data-hidden={hideHeader ? "true" : undefined}>
        {icon !== undefined ? (
          <IconTile icon={icon} tone={kitTone(concept, tone)} size="sm" />
        ) : null}
        <div className={styles["card-titles"]}>
          <Heading className={styles["card-title"]}>{title}</Heading>
          {description !== undefined ? <p className={styles["card-desc"]}>{description}</p> : null}
        </div>
        {action !== undefined ? <div className={styles["card-action"]}>{action}</div> : null}
      </header>
      {children !== undefined ? <div className={styles["card-body"]}>{children}</div> : null}
    </section>
  );
}

/* ---- Stat card ------------------------------------------------------------ */

export interface StatCardProps {
  icon: ReactNode;
  tone?: KitTone;
  /** Wins over `tone`: the colour this concept always wears. */
  concept?: KitConcept;
  value: ReactNode;
  /**
   * Roll the figure's digits in from zero on first paint and on every change
   * (an odometer — transform only, still under reduced motion). Only for a
   * plain string or number value; a ReactNode value is drawn as given.
   */
  rolling?: boolean;
  label: ReactNode;
  hint?: ReactNode;
  /** 0–100: a thin bar under the figure. */
  progress?: number;
  /** Makes the whole card a link (with a chevron). */
  href?: string;
  /** Makes the whole card a toggle button (a filter). */
  onSelect?: () => void;
  /** The filter this card stands for is the open one. */
  active?: boolean;
  linkComponent?: ElementType;
  testId?: string;
}

export function StatCard({
  icon,
  tone: toneProp,
  concept,
  value,
  rolling = false,
  label,
  hint,
  progress,
  href,
  onSelect,
  active = false,
  linkComponent: Link = "a",
  testId,
}: StatCardProps) {
  const tone = kitTone(concept, toneProp);
  const figure =
    rolling && (typeof value === "string" || typeof value === "number") ? (
      <KitFigure value={String(value)} />
    ) : (
      value
    );
  const body = (
    <>
      <IconTile icon={icon} tone={tone} size="md" />
      <span className={styles["stat-text"]}>
        <span className={styles["stat-value"]}>{figure}</span>
        <span className={styles["stat-label"]}>{label}</span>
        {hint !== undefined ? <span className={styles["stat-hint"]}>{hint}</span> : null}
        {progress !== undefined ? (
          <span className={styles["stat-bar"]} aria-hidden>
            <span
              className={styles["stat-bar-fill"]}
              style={{ width: `${String(Math.max(0, Math.min(100, progress)))}%` }}
            />
          </span>
        ) : null}
      </span>
    </>
  );
  const attrs: DataAttrs = {
    "data-tone": tone,
    "data-active": active ? "true" : undefined,
    "data-testid": testId,
  };
  if (href !== undefined) {
    return (
      <Link
        href={href}
        className={`${styles["stat"] ?? ""} ${styles["toned"] ?? ""} da-lift`}
        {...attrs}
      >
        {body}
        <span className={styles["stat-chevron"]} aria-hidden>
          <IconChevronRight size={16} />
        </span>
      </Link>
    );
  }
  if (onSelect !== undefined) {
    return (
      <button
        type="button"
        className={`${styles["stat"] ?? ""} ${styles["toned"] ?? ""} da-lift`}
        aria-pressed={active}
        onClick={onSelect}
        {...attrs}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={`${styles["stat"] ?? ""} ${styles["toned"] ?? ""}`} {...attrs}>
      {body}
    </div>
  );
}

/**
 * A responsive row of stat cards (4 across on a laptop, 2 on a phone), and
 * they settle in one after another on first paint (`.da-stagger`).
 */
export function StatGrid({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className={`${styles["stat-grid"] ?? ""} da-stagger`} data-testid={testId}>
      {children}
    </div>
  );
}

/* ---- Notice --------------------------------------------------------------- */

export interface NoticeProps {
  tone?: "warning" | "info" | "success" | "danger";
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}

export function Notice({ tone = "warning", icon, title, children, action, testId }: NoticeProps) {
  return (
    <div
      className={styles["notice"]}
      data-tone={tone}
      role={tone === "danger" ? "alert" : undefined}
      data-testid={testId}
    >
      {icon !== undefined ? (
        <span className={styles["notice-icon"]} aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className={styles["notice-text"]}>
        {title !== undefined ? <p className={styles["notice-title"]}>{title}</p> : null}
        {children !== undefined ? <div className={styles["notice-body"]}>{children}</div> : null}
      </div>
      {action !== undefined ? <div className={styles["notice-action"]}>{action}</div> : null}
    </div>
  );
}

/* ---- Pills and team chips ------------------------------------------------- */

export interface PillProps {
  tone?: KitTone;
  concept?: KitConcept;
  children: ReactNode;
  /** A leading dot (status). */
  dot?: boolean;
  icon?: ReactNode;
  testId?: string;
}

export function Pill({ tone, concept, children, dot = false, icon, testId }: PillProps) {
  return (
    <span
      className={`${styles["pill"] ?? ""} ${styles["toned"] ?? ""}`}
      data-tone={kitTone(concept, tone, "neutral")}
      data-testid={testId}
    >
      {dot ? <span className={styles["pill-dot"]} aria-hidden /> : null}
      {icon !== undefined ? (
        <span className={styles["pill-icon"]} aria-hidden>
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

/** A team's name on a wash of the team's own colour. */
export function TeamChip({ color, children }: { color: string | null; children: ReactNode }) {
  return (
    <span
      className={styles["team-chip"]}
      style={color !== null ? { ["--team" as string]: color } : undefined}
    >
      {children}
    </span>
  );
}

/* ---- Journey stepper ------------------------------------------------------ */

export interface JourneyStep {
  key: string;
  label: ReactNode;
  state: "done" | "current" | "upcoming";
  /** One small line under the label ("Completed", "Live"). */
  hint?: ReactNode;
  href?: string;
  icon?: ReactNode;
}

export function JourneyStepper({
  steps,
  label = "Season progress",
  linkComponent: Link = "a",
  variant = "strip",
}: {
  steps: JourneyStep[];
  label?: string;
  linkComponent?: ElementType;
  /**
   * "strip": its own card under a page head. "rail": slim and transparent,
   * for the bottom edge of a HeroBanner (pass it as the hero's `footer`).
   * On a phone both collapse to marks plus the one step that matters —
   * "Step 4 of 5 · Fixtures" — so nothing clips mid-word.
   */
  variant?: "strip" | "rail";
}) {
  // The step a phone spells out: the current one, else the last one done.
  let focus = steps.findIndex((step) => step.state === "current");
  if (focus === -1) {
    focus = steps.reduce((last, step, index) => (step.state === "done" ? index : last), 0);
  }
  return (
    <ol className={styles["journey"]} aria-label={label} data-variant={variant}>
      {steps.map((step, index) => {
        const inner = (
          <>
            <span className={styles["journey-mark"]} aria-hidden>
              {step.state === "done" ? (
                <svg viewBox="0 0 16 16" width="12" height="12">
                  <path
                    d="M3.5 8.5l3 3 6-7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                (step.icon ?? index + 1)
              )}
            </span>
            <span className={styles["journey-text"]}>
              <span className={styles["journey-label"]}>{step.label}</span>
              {step.hint !== undefined ? (
                <span className={styles["journey-hint"]}>{step.hint}</span>
              ) : null}
              {index === focus ? (
                <span className={styles["journey-count"]}>
                  Step {index + 1} of {steps.length}
                </span>
              ) : null}
            </span>
          </>
        );
        return (
          <li
            key={step.key}
            className={styles["journey-step"]}
            data-state={step.state}
            data-focus={index === focus ? "true" : undefined}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            {step.href !== undefined ? (
              <Link href={step.href} className={styles["journey-link"]}>
                {inner}
              </Link>
            ) : (
              <span className={styles["journey-link"]}>{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ---- Hero banner ---------------------------------------------------------- */

export interface HeroBannerProps {
  /** The organizer's cover photo; the designed floodlight gradient without one. */
  image?: string | null;
  /** A crest or logo beside the title. */
  crest?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Facts in one row: dates, place, club — each with its own icon. */
  meta?: ReactNode[];
  actions?: ReactNode;
  /** Right side: a quote, figures, a switcher. */
  aside?: ReactNode;
  headingLevel?: 1 | 2;
  /**
   * Where the side column (actions + aside) sits: "end" (bottom, for a quote
   * or figures) or "start" (top right, for a club chip and a menu).
   */
  sideAlign?: "start" | "end";
  /** Along the bottom edge: a `JourneyStepper variant="rail"`, a stat strip. */
  footer?: ReactNode;
  /** "compact": ~120px, for a tournament or club head rather than a season. */
  size?: "default" | "compact";
  testId?: string;
}

export function HeroBanner({
  image,
  crest,
  eyebrow,
  title,
  meta,
  actions,
  aside,
  headingLevel = 2,
  sideAlign = "end",
  footer,
  size = "default",
  testId,
}: HeroBannerProps) {
  const Heading: ElementType = headingLevel === 1 ? "h1" : "h2";
  return (
    <section
      className={styles["hero"]}
      data-has-image={image !== undefined && image !== null ? "true" : undefined}
      data-side-align={sideAlign}
      data-size={size === "compact" ? "compact" : undefined}
      data-testid={testId}
    >
      {image !== undefined && image !== null ? (
        // Intrinsic size = the 1600 × 500 cover the upload flow asks for, so the
        // browser reserves the right box before a (≤2048px, re-encoded) file
        // arrives; the CSS still fills and crops it. Above the fold, so eager.
        <img
          className={styles["hero-image"]}
          src={image}
          alt=""
          width={1600}
          height={500}
          decoding="async"
        />
      ) : null}
      <span className={styles["hero-shade"]} aria-hidden />
      <div className={styles["hero-inner"]}>
        <div className={styles["hero-main"]}>
          {eyebrow !== undefined ? <div className={styles["hero-eyebrow"]}>{eyebrow}</div> : null}
          <div className={styles["hero-title-row"]}>
            {crest !== undefined ? <span className={styles["hero-crest"]}>{crest}</span> : null}
            <Heading className={styles["hero-title"]}>{title}</Heading>
          </div>
          {meta !== undefined && meta.length > 0 ? (
            <ul className={styles["hero-meta"]}>
              {meta.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {aside !== undefined || actions !== undefined ? (
          <div className={styles["hero-side"]}>
            {actions !== undefined ? <div className={styles["hero-actions"]}>{actions}</div> : null}
            {aside !== undefined ? <div className={styles["hero-aside"]}>{aside}</div> : null}
          </div>
        ) : null}
      </div>
      {footer !== undefined ? <div className={styles["hero-footer"]}>{footer}</div> : null}
    </section>
  );
}

/* ---- Card grid ------------------------------------------------------------ */

/** Two columns on a laptop (optionally weighted), one on a phone. */
export function CardGrid({
  children,
  weight = "even",
}: {
  children: ReactNode;
  weight?: "even" | "wide-left" | "wide-right" | "golden";
}) {
  return (
    <div className={styles["card-grid"]} data-weight={weight}>
      {children}
    </div>
  );
}
