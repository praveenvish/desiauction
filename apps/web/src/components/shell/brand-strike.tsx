"use client";

import { useSoundCue, useSoundPreference } from "@desiauction/ui";
import { useEffect, useId, useLayoutEffect, useRef } from "react";

import { STRIKE_DONE_MS, STRIKE_IMPACT_MS, strikeFrame, type StrikeFrame } from "./strike-timeline";

// THE STRIKE — the DA mark's motion logo, for the surfaces that open a night:
// the projector board and the stream overlay. Headers, the console rail and
// the live strip keep the still mark; a strike everywhere would mean nothing.
//
// It plays once on mount and rests as the exact drawn mark. The frames are
// applied as SVG attributes, never CSS transforms or opacity: a CSS transform
// promotes the tile to a cached GPU layer and the edges drift frame to frame.
// The server renders the mark hidden (`pending`), so there is no flash of the
// finished mark before the strike; if script never runs, brand.css reveals it,
// and reduced motion reveals it at once with no strike and no sound.
//
// The sting is the "sting" cue on the product's sound engine, so it only sounds
// when the person has switched sound on — the same rule as every other cue.
// On the board that switch is the projector's sound toggle, and browsers need
// that tap before any audio, so a strike on page load is always silent there.
// With `replayOnSound`, switching sound on replays the strike with the sting:
// the hall's sound check is the brand landing.

const D = "M13 16h10c9 0 16 7 16 16s-7 16-16 16H13V16Zm7 7v18h3a9 9 0 0 0 0-18h-3Z";
const SLASH = "M30 48 43 16h7L37 48h-7Z";
const LEG = "m46.5 24 9 24h-7l-2-6h-8l3-7h3l-1.5-4 3.5-7Z";

export function BrandStrike({ replayOnSound = false }: { replayOnSound?: boolean }) {
  const rootRef = useRef<SVGSVGElement>(null);
  const play = useSoundCue();
  const { enabled, unlocked } = useSoundPreference();
  const runRef = useRef<(withSting: boolean) => void>(() => undefined);
  // Stable across server and client (a random id would break hydration); the
  // characters React uses are not valid inside url(#…), so keep only [\w-].
  const clipId = `da-strike-${useId().replace(/[^\w-]/g, "")}`;

  useLayoutEffect(() => {
    const svg = rootRef.current;
    if (svg === null) return;
    const q = (sel: string) => svg.querySelector(sel);
    const tile = q("[data-part=tile]");
    const glyph = q("[data-part=glyph]");
    const rise = svg.querySelectorAll("[data-part=rise]");
    const clip = q("[data-part=clip]");
    const sweep = q("[data-part=sweep]");
    const apply = (f: StrikeFrame) => {
      tile?.setAttribute("opacity", String(f.tileOpacity));
      tile?.setAttribute(
        "transform",
        `translate(32 32) scale(${String(f.tileScale)}) translate(-32 -32)`,
      );
      rise.forEach((el) => {
        el.setAttribute("opacity", String(f.riseOpacity));
      });
      glyph?.setAttribute("transform", `translate(0 ${String(f.glyphDy)})`);
      clip?.setAttribute("height", String(f.clipHeight));
      sweep?.setAttribute("transform", `translate(${String(f.sweepX)} 0)`);
      sweep?.setAttribute("opacity", String(f.sweepOpacity));
    };

    let raf = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    runRef.current = (withSting) => {
      cancelAnimationFrame(raf);
      if (reduced) {
        apply(strikeFrame(STRIKE_DONE_MS));
        svg.dataset.strike = "done";
        return;
      }
      svg.dataset.strike = "running";
      let stung = !withSting;
      const start = performance.now();
      const step = (now: number) => {
        const t = now - start;
        apply(strikeFrame(t));
        if (!stung && t >= STRIKE_IMPACT_MS) {
          stung = true;
          play("sting");
        }
        if (t < STRIKE_DONE_MS) {
          raf = requestAnimationFrame(step);
        } else {
          svg.dataset.strike = "done";
        }
      };
      apply(strikeFrame(0));
      raf = requestAnimationFrame(step);
    };
    runRef.current(true);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [play]);

  // Sound switched on after mount: replay once with the sting.
  const armed = useRef(false);
  useEffect(() => {
    if (!replayOnSound) return;
    if (enabled && unlocked) {
      if (armed.current) runRef.current(true);
      armed.current = false;
    } else {
      armed.current = true;
    }
  }, [enabled, unlocked, replayOnSound]);

  return (
    <svg
      ref={rootRef}
      className="da-strike"
      data-strike="pending"
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <rect data-part="clip" x="0" y="10" width="64" height={44} />
        </clipPath>
        <clipPath id={`${clipId}-tile`}>
          <rect x="1" y="1" width="62" height="62" rx="17" />
        </clipPath>
      </defs>
      <g data-part="tile">
        <rect x="1" y="1" width="62" height="62" rx="17" fill="#E6B24A" />
        <g data-part="glyph">
          <g transform="translate(-2.25 0)">
            <path data-part="rise" d={D} fill="#0B1018" />
            <g clipPath={`url(#${clipId})`}>
              <path d="M23 44h5v4h-5z" fill="#0B1018" />
              <path
                d={SLASH}
                fill="#E6B24A"
                stroke="#E6B24A"
                strokeWidth="5"
                strokeLinejoin="round"
              />
              <path d={SLASH} fill="#0B1018" />
            </g>
            <path data-part="rise" d={LEG} fill="#0B1018" />
          </g>
        </g>
        <g clipPath={`url(#${clipId}-tile)`}>
          <path data-part="sweep" d="M0 -6h9L-8 70h-9Z" fill="#FFFFFF" opacity="0" />
        </g>
      </g>
    </svg>
  );
}
