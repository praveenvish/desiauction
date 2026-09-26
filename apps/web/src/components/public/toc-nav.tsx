"use client";

import { useEffect, useState } from "react";

/** A heading a content page can jump to. Lives here, not in content-layout,
    so the two modules do not import each other. */
export interface ContentAnchor {
  id: string;
  label: string;
}

/**
 * "ON THIS PAGE", WITH THE CURRENT SECTION MARKED (wow pass, round 2).
 *
 * The list was a static set of links: a reader half-way down the terms could
 * not see where they were. The section whose heading most recently crossed the
 * top third of the viewport is marked `aria-current="location"`. Server
 * rendered with nothing marked, so it reads the same without JavaScript.
 */
export function TocNav({ anchors }: { anchors: ContentAnchor[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const targets = anchors
      .map((anchor) => document.getElementById(anchor.id))
      .filter((node): node is HTMLElement => node !== null);
    if (targets.length === 0) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      const atEnd =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current: string | null = targets[0]?.id ?? null;
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= line) current = target.id;
      }
      // The last sections are often too short to reach the line: at the end
      // of the page, the last one is where the reader is.
      setActive(atEnd ? (targets[targets.length - 1]?.id ?? current) : current);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [anchors]);

  return (
    <nav className="cl-aside" aria-label="On this page">
      <p className="cl-aside-title">On this page</p>
      <ol className="cl-aside-list">
        {anchors.map((anchor) => (
          <li key={anchor.id}>
            <a href={`#${anchor.id}`} aria-current={active === anchor.id ? "location" : undefined}>
              {anchor.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
