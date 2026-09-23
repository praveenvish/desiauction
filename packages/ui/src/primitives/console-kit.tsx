import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { IconChevronRight } from "../icons/icons";
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

type DataAttrs = { [key: `data-${string}`]: string | undefined };

/* ---- Icon tile ------------------------------------------------------------ */

export interface IconTileProps {
  icon: ReactNode;
  tone?: KitTone;
  size?: "sm" | "md" | "lg";
}

/** A rounded square of tint with an icon in it — decorative, never the name. */
export function IconTile({ icon, tone = "gold", size = "md" }: IconTileProps) {
  return (
    <span
      className={`${styles["tile"] ?? ""} ${styles["toned"] ?? ""}`}
      data-tone={tone}
      data-size={size}
      aria-hidden
    >
      {icon}
    </span>
  );
}

/* ---- Section card --------------------------------------------------------- */

export interface SectionCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  icon?: ReactNode;
  tone?: KitTone;
  description?: ReactNode;
  /** Right side of the header: a "View all →" link, a settings button. */
  action?: ReactNode;
  /** Heading level for the title (default 2). */
  headingLevel?: 2 | 3;
  /** Drop the body padding — for a table that runs edge to edge. */
  flush?: boolean;
  children?: ReactNode;
}

export function SectionCard({
  title,
  icon,
  tone = "gold",
  description,
  action,
  headingLevel = 2,
  flush = false,
  children,
  className,
  ...rest
}: SectionCardProps) {
  const Heading: ElementType = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      className={[styles["card"], className ?? ""].filter(Boolean).join(" ")}
      data-flush={flush ? "true" : undefined}
      {...rest}
    >
      <header className={styles["card-head"]}>
        {icon !== undefined ? <IconTile icon={icon} tone={tone} size="sm" /> : null}
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
  value: ReactNode;
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
  tone = "gold",
  value,
  label,
  hint,
  progress,
  href,
  onSelect,
  active = false,
  linkComponent: Link = "a",
  testId,
}: StatCardProps) {
  const body = (
    <>
      <IconTile icon={icon} tone={tone} size="lg" />
      <span className={styles["stat-text"]}>
        <span className={styles["stat-value"]}>{value}</span>
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
      <Link href={href} className={`${styles["stat"] ?? ""} ${styles["toned"] ?? ""}`} {...attrs}>
        {body}
        <span className={styles["stat-chevron"]} aria-hidden>
          <IconChevronRight size={18} />
        </span>
      </Link>
    );
  }
  if (onSelect !== undefined) {
    return (
      <button
        type="button"
        className={`${styles["stat"] ?? ""} ${styles["toned"] ?? ""}`}
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

/** A responsive row of stat cards (4 across on a laptop, 2 on a phone). */
export function StatGrid({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className={styles["stat-grid"]} data-testid={testId}>
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
  children: ReactNode;
  /** A leading dot (status). */
  dot?: boolean;
  icon?: ReactNode;
  testId?: string;
}

export function Pill({ tone = "neutral", children, dot = false, icon, testId }: PillProps) {
  return (
    <span
      className={`${styles["pill"] ?? ""} ${styles["toned"] ?? ""}`}
      data-tone={tone}
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
}: {
  steps: JourneyStep[];
  label?: string;
  linkComponent?: ElementType;
}) {
  return (
    <ol className={styles["journey"]} aria-label={label}>
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
            </span>
          </>
        );
        return (
          <li
            key={step.key}
            className={styles["journey-step"]}
            data-state={step.state}
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
  testId,
}: HeroBannerProps) {
  const Heading: ElementType = headingLevel === 1 ? "h1" : "h2";
  return (
    <section
      className={styles["hero"]}
      data-has-image={image !== undefined && image !== null ? "true" : undefined}
      data-side-align={sideAlign}
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
  weight?: "even" | "wide-left" | "wide-right";
}) {
  return (
    <div className={styles["card-grid"]} data-weight={weight}>
      {children}
    </div>
  );
}
