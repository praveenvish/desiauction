import styles from "./roster-mark.module.css";

/** A squad member's standing: what the squad made them, or that it is you. */
export type RosterMarkKind = "captain" | "vice-captain" | "icon" | "retained" | "you";

const LABEL: Record<RosterMarkKind, string> = {
  captain: "Captain",
  "vice-captain": "Vice-captain",
  icon: "Icon",
  retained: "Retained",
  you: "You",
};

export interface RosterMarkProps {
  kind: RosterMarkKind;
  /** Extra class for placement only (margins, flex) — never for the look. */
  className?: string | undefined;
}

/**
 * THE ONE ROSTER BADGE. Captain, Icon, Retained and You were drawn in three
 * dialects — a filled pill beside outlined ones, all-caps pills in the rooms,
 * bare gold words on the team pages — so the same squad read differently on
 * every surface. This is the only one: a small soft-gold pill in sentence
 * case, identical wherever a squad row is drawn, in both themes.
 */
export function RosterMark({ kind, className }: RosterMarkProps) {
  return (
    <span
      className={className === undefined ? styles["mark"] : `${styles["mark"]} ${className}`}
      data-mark={kind}
    >
      {LABEL[kind]}
    </span>
  );
}
