"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keeps a scrolling strip's current item on screen.
 *
 * Tab strips scroll sideways on a phone with the scrollbar hidden, and the
 * browser always opens them at the left end — so on the eighth admin section
 * or the "Waitlisted" status tab, the one thing the strip exists to say (where
 * you are) was off the right edge. On mount, and whenever `activeKey` changes,
 * this scrolls the strip itself (never the page) just far enough to centre the
 * item marked `aria-current="page"` or `data-active`. A strip that fits does
 * nothing.
 */
export function useActiveInView(
  ref: RefObject<HTMLElement | null>,
  activeKey: string | number | null | undefined,
): void {
  useEffect(() => {
    const strip = ref.current;
    if (strip === null || strip.scrollWidth <= strip.clientWidth + 1) return;
    const candidates = strip.querySelectorAll<HTMLElement>('[aria-current="page"], [data-active]');
    // Skip anything drawn in a closed menu: it has no box.
    const active = Array.from(candidates).find((el) => el.getBoundingClientRect().width > 0);
    if (active === undefined) return;
    const box = strip.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    const margin = 24;
    if (item.left >= box.left + margin && item.right <= box.right - margin) return;
    strip.scrollLeft += item.left - box.left - (box.width - item.width) / 2;
  }, [ref, activeKey]);
}
