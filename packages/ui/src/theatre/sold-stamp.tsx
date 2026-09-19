import type { HTMLAttributes } from "react";

import styles from "./sold-stamp.module.css";

export type StampTone = "sold" | "unsold";
export type StampSize = "md" | "lg" | "stage";

export interface SoldStampProps extends HTMLAttributes<HTMLSpanElement> {
  /** SOLD is gold and struck; UNSOLD is neutral ink and brief (C-23). */
  tone?: StampTone;
  size?: StampSize;
  /** The word on the stamp. Defaults to the tone, upper-cased by the face. */
  label?: string;
  /** Draws the gavel strike before the stamp lands. SOLD only. */
  hammer?: boolean;
}

/**
 * The gavel. One group rotates about the handle's heel: raised, then the
 * strike, then a short rebound. Decorative — the stamp's word is the
 * announcement, so the drawing is hidden from assistive tech.
 */
export function HammerStrike({ className }: { className?: string }) {
  return (
    <svg
      className={[styles["hammer"], className].filter(Boolean).join(" ")}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <g className={styles["hammer-swing"]}>
        {/* handle */}
        <path
          d="M9 39 27 21"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
        {/* head */}
        <path
          d="M26 10l12 12-6 6-12-12z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M22 14l-3-3M37 29l3 3"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      {/* the block it lands on */}
      <path
        d="M6 44h20"
        className={styles["hammer-block"]}
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * THE STAMP — the product's signature frame (doc 11, C-5).
 *
 * Beat two of the SOLD ceremony: after the freeze, gold "SOLD" lands on the
 * lot with a spring (1.15 → 1) and one soft flash behind it. The whole
 * element scales, so the lettering is on screen at full contrast from the
 * first frame — nothing fades in, and the axe pass that samples mid-animation
 * reads the same word it reads at rest.
 *
 * UNSOLD is the same component with the ceremony taken out: neutral ink, no
 * hammer, no flash, and a brisk entrance (the 400 ms of dignified brevity the
 * canon gives to rejection of a person).
 */
export function SoldStamp({
  tone = "sold",
  size = "md",
  label,
  hammer = tone === "sold",
  className,
  ...rest
}: SoldStampProps) {
  return (
    <span
      className={[styles["stamp"], styles[size], className].filter(Boolean).join(" ")}
      data-tone={tone}
      data-testid="stamp"
      {...rest}
    >
      {hammer && tone === "sold" ? <HammerStrike /> : null}
      <span className={styles["word"]}>{label ?? (tone === "sold" ? "SOLD" : "UNSOLD")}</span>
    </span>
  );
}
