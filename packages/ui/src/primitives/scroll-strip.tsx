"use client";

import { useRef, type ElementType, type HTMLAttributes, type ReactNode } from "react";

import { useScrollStrip } from "./use-scroll-strip";

export interface ScrollStripProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** The element to render: a <nav> for tab rails, a <div> (default) otherwise. */
  as?: ElementType;
  /** Changes when the current item changes, so it is scrolled into view again. */
  activeKey?: string | number | null;
}

/**
 * A horizontal scroller that says it scrolls: edge fades where there is more,
 * and the current item scrolled into view. The wrapper form of
 * `useScrollStrip` for strips a page draws itself (chip rows, sport rows).
 * Lay the children out with your own class (flex, gap); this only scrolls.
 */
export function ScrollStrip({
  children,
  as: Tag = "div",
  activeKey,
  className,
  ...rest
}: ScrollStripProps) {
  const ref = useRef<HTMLElement>(null);
  useScrollStrip(ref, activeKey);
  return (
    <Tag ref={ref} className={["da-scroll-strip", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </Tag>
  );
}
