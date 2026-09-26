"use client";

import { useEffect, type RefObject } from "react";

import { useActiveInView } from "./use-active-in-view";

/**
 * THE SCROLL STRIP (round 3B). Every horizontal scroller in the product —
 * section tabs, status tabs, filter chips, sport rows, facets — hides its
 * scrollbar, and each used to solve "does this scroll?" its own way (a
 * background shadow on two strips, nothing at all on six), so on a phone they
 * hard-cut mid-word: "Not…", "Waitlis", "Hoc…".
 *
 * Give the scroller the global class `da-scroll-strip` (system.css) and call
 * this hook on it. It:
 *  - marks `data-fade-start` / `data-fade-end` while there is more to see past
 *    that edge, which the class turns into a 32px mask fade; and
 *  - scrolls the current item (`aria-current="page"` or `data-active`) into
 *    view, never the page (see useActiveInView).
 *
 * Fails open: with no script the strip is a plain scroller without fades.
 */
export function useScrollStrip(
  ref: RefObject<HTMLElement | null>,
  activeKey?: string | number | null,
): void {
  useActiveInView(ref, activeKey);
  useEffect(() => {
    const strip = ref.current;
    if (strip === null) return;
    const update = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      toggle(strip, "data-fade-start", max > 1 && strip.scrollLeft > 1);
      toggle(strip, "data-fade-end", max > 1 && strip.scrollLeft < max - 1);
    };
    update();
    strip.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(strip);
    return () => {
      strip.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [ref, activeKey]);
}

function toggle(el: HTMLElement, name: string, on: boolean): void {
  if (on) {
    if (!el.hasAttribute(name)) el.setAttribute(name, "");
  } else if (el.hasAttribute(name)) {
    el.removeAttribute(name);
  }
}
