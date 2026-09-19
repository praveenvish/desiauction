import { createElement, type CSSProperties, type ElementType, type HTMLAttributes } from "react";

export interface RevealProps extends HTMLAttributes<HTMLElement> {
  /** The element to render. Defaults to a div. */
  as?: ElementType;
  /** Position in a group; each step delays the reveal by one stagger rung. */
  index?: number;
}

/**
 * Scroll-linked entrance for content below the fold. The work is CSS
 * (`.da-reveal` in motion.css): a `view()` timeline, transform only, and a
 * stagger driven by `--reveal-index`. There is no observer and no state — a
 * browser without scroll timelines simply shows the content at rest, which is
 * the correct fallback for information.
 */
export function Reveal({
  as = "div",
  index = 0,
  className,
  style,
  children,
  ...rest
}: RevealProps) {
  const merged = {
    ...style,
    "--reveal-index": String(index),
  } as CSSProperties;
  return createElement(
    as,
    {
      className: ["da-reveal", className].filter(Boolean).join(" "),
      style: merged,
      ...rest,
    },
    children,
  );
}
