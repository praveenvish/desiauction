import { forwardRef, type HTMLAttributes } from "react";

import styles from "./card.module.css";

export type CardElevation = "flat" | "raised" | "floating";

interface CardStyleProps {
  /** doc 10 densities: default space-5, dense space-4, none for media edges. */
  padding?: "default" | "dense" | "none";
  /** Resting elevation (doc 10): flat sits in the page, raised is the card
   *  default, floating is for a card that is itself the focus of a screen. */
  elevation?: CardElevation;
  /**
   * The card is a single target — a link's body, a peek trigger, a tile. It
   * gains the shared rest → hover → active → focus-visible set (doc 15), so no
   * screen hand-rolls its own lift. Decorative containers stay still.
   */
  interactive?: boolean;
}

/**
 * Shared class computation so an anchor or a button can be a card without
 * nesting one inside another — the same pattern `buttonClassName` set.
 */
export function cardClassName(
  { padding = "default", elevation = "raised", interactive = false }: CardStyleProps,
  extra?: string,
): string {
  return [
    styles["card"],
    styles[padding],
    styles[elevation],
    interactive ? styles["interactive"] : undefined,
    // The shared card recipe (motion.css): lift, gold rim, gold top edge.
    interactive ? "da-lift" : undefined,
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface CardProps extends HTMLAttributes<HTMLDivElement>, CardStyleProps {}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = "default", elevation = "raised", interactive = false, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cardClassName({ padding, elevation, interactive }, className)}
      {...rest}
    >
      {children}
    </div>
  );
});
