import type { ReactNode } from "react";

import "./season-hero.css";

/**
 * The pieces a season's `HeroBanner` is dressed in, shared by /home's club hero
 * and the /tournaments feature card so the two draw a season the same way.
 *
 * `HeroBanner` itself (console kit) owns the floodlight, the shade and the
 * layout; these are only what goes INTO its slots: the crest, the row of
 * figures, the chip and the ghost buttons that sit on a dark bed.
 */

/** "Vishnoi Cricket Club" → "VC". First code point of up to two words. */
export function monogram(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => {
        const first = word.codePointAt(0);
        return first === undefined ? "" : String.fromCodePoint(first);
      })
      .join("")
      .toUpperCase() || "—"
  );
}

/** The season's crest where the organizer set one; its initials where not. */
export function SeasonCrest({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return logoUrl !== null ? (
    <img src={logoUrl} alt="" className="sh-crest-img" />
  ) : (
    <span className="sh-crest-mono" aria-hidden>
      {monogram(name)}
    </span>
  );
}

export interface HeroFigure {
  key: string;
  icon: ReactNode;
  value: ReactNode;
  label: string;
}

/** Figures in one ruled row, number first; each item reads "4 Teams". */
export function HeroFigures({ figures, label }: { figures: HeroFigure[]; label?: string }) {
  if (figures.length === 0) {
    return null;
  }
  return (
    <ul className="sh-figures" aria-label={label}>
      {figures.map((figure) => (
        <li key={figure.key} className="sh-figure">
          <span className="sh-figure-icon" aria-hidden>
            {figure.icon}
          </span>
          <span className="sh-figure-text">
            <span className="sh-figure-value">{figure.value}</span>{" "}
            <span className="sh-figure-label">{figure.label}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A quiet outlined chip on the dark bed — the club's name, a count. */
export function HeroChip({ children }: { children: ReactNode }) {
  return <span className="sh-chip">{children}</span>;
}

/**
 * The status on the dark bed. The kit's `Pill` tints are mixed for a light
 * card and go dark-on-dark here, so the hero states its status on solid
 * ceremony gold with ink — the one treatment that reads in both themes.
 */
export function HeroStatus({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <span className="sh-status" data-live={live ? "true" : undefined}>
      {live ? <span className="sh-status-dot" aria-hidden /> : null}
      {children}
    </span>
  );
}
