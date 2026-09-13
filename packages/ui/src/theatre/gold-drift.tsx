import type { CSSProperties } from "react";

import styles from "./gold-drift.module.css";

export interface GoldDriftProps {
  /** Fixed count, no randomness: every connected surface draws the same drift. */
  count?: number;
  className?: string;
}

/**
 * Beat three's atmosphere: gold rising slowly behind the facts — "drift, like
 * stadium lights on smoke", never confetti physics (doc 11). Deterministic:
 * each mote's column, delay and sway derive from its index, so the cockpit,
 * the big screen and a phone in the hall render the identical rise for the
 * same SOLD. Decorative (aria-hidden), absolutely positioned over its parent,
 * and removed entirely under reduced motion — the static gold frame on the
 * stage is the non-motion marker.
 */
export function GoldDrift({ count = 24, className }: GoldDriftProps) {
  return (
    <span className={[styles["drift"], className].filter(Boolean).join(" ")} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={styles["mote"]} style={{ "--i": i, "--n": count } as CSSProperties} />
      ))}
    </span>
  );
}
