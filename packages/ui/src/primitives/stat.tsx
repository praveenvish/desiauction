import type { ReactNode } from "react";

import styles from "./stat.module.css";

/**
 * The console summary row (the band of figures under a PageHeader).
 *
 * Every workspace opens with the same question — how much of this is there, and
 * how much of it needs me — so the answer gets one shape everywhere rather than
 * a bespoke tile grid per page. `StatRow` owns the grid; `Stat` owns one figure.
 *
 * Values are pre-formatted by the caller: money goes through `<Money>` and
 * counts through the caller's own locale formatting. This component never sees
 * a number it has to decide how to print (C-7).
 */

export interface StatRowProps {
  /** Accessible name for the group, e.g. "Season summary". */
  label: string;
  children: ReactNode;
}

export function StatRow({ label, children }: StatRowProps) {
  return (
    <ul className={styles["row"]} aria-label={label}>
      {children}
    </ul>
  );
}

export interface StatProps {
  /** What the figure counts. Sits under the value — the figure leads. */
  label: ReactNode;
  value: ReactNode;
  /** Optional leading glyph, tinted by `tone`. */
  icon?: ReactNode;
  /** A line of context under the label (e.g. "3 awaiting review"). */
  hint?: ReactNode;
  /**
   * Draws the eye to figures that mean something. `accent` is the page's one
   * highlighted figure; the status tones carry their own meaning and should
   * track the thing they describe, not the designer's mood.
   */
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info";
}

export function Stat({ label, value, icon, hint, tone = "neutral" }: StatProps) {
  return (
    <li className={[styles["stat"], styles[tone]].join(" ")}>
      {icon !== undefined ? (
        <span className={styles["icon"]} aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className={styles["body"]}>
        <span className={styles["stat-value"]}>{value}</span>
        <span className={styles["label"]}>{label}</span>
        {hint !== undefined ? <span className={styles["hint"]}>{hint}</span> : null}
      </span>
    </li>
  );
}
