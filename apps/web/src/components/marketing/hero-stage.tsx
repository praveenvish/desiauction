"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

import { IconTrophy } from "./icons";

/**
 * The hero's live-auction visual, upgraded from a static mock to a lightly
 * interactive one (2026-07-18 restructure). Two motions, both purposeful and
 * both transform-first:
 *   • a count-up on the current bid — animates the NUMBER TEXT only, which holds
 *     full contrast at every frame (axe scans visual contrast regardless of
 *     aria-hidden — no opacity keyframes on text, ever);
 *   • a pointer parallax that separates the trophy plate from the stage card for
 *     depth, applied as translate on wrapper layers so the card keeps its CSS
 *     tilt.
 * The whole block is decorative (aria-hidden). Both motions no-op under
 * prefers-reduced-motion, and the server render already shows the final bid, so
 * with JS off nothing is lost.
 */

export interface HeroPlayer {
  name: string;
  role: string;
  amount: string;
  team: string;
}

const PARALLAX_STAGE_PX = 10;
const PARALLAX_TROPHY_PX = 22;
const COUNT_UP_MS = 950;

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Split "₹85,000" into its non-digit prefix and integer value. */
function parseAmount(amount: string): { prefix: string; value: number } {
  const match = /[\d,]+/.exec(amount);
  if (match === null) {
    return { prefix: amount, value: 0 };
  }
  return {
    prefix: amount.slice(0, match.index),
    value: Number(match[0].replace(/,/g, "")),
  };
}

export function HeroStage({ player }: { player: HeroPlayer }) {
  const { prefix, value } = parseAmount(player.amount);
  const [bid, setBid] = useState(player.amount);
  const visualRef = useRef<HTMLDivElement>(null);
  const trophyRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Count the bid up from a nearby figure on mount — a bidding war settling.
  useEffect(() => {
    if (reducedMotion() || value <= 0) {
      setBid(player.amount);
      return;
    }
    const from = Math.round(value * 0.6);
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(from + (value - from) * eased);
      setBid(`${prefix}${current.toLocaleString("en-IN")}`);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [player.amount, prefix, value]);

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (reducedMotion()) {
      return;
    }
    const el = visualRef.current;
    if (el === null) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      if (trophyRef.current !== null) {
        trophyRef.current.style.transform = `translate3d(${(-nx * PARALLAX_TROPHY_PX).toFixed(1)}px, ${(-ny * PARALLAX_TROPHY_PX).toFixed(1)}px, 0)`;
      }
      if (stageRef.current !== null) {
        stageRef.current.style.transform = `translate3d(${(nx * PARALLAX_STAGE_PX).toFixed(1)}px, ${(ny * PARALLAX_STAGE_PX).toFixed(1)}px, 0)`;
      }
    });
  }

  function resetParallax() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (trophyRef.current !== null) {
      trophyRef.current.style.transform = "";
    }
    if (stageRef.current !== null) {
      stageRef.current.style.transform = "";
    }
  }

  const initials = player.name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("");

  return (
    <div
      className="mk-hero-visual"
      aria-hidden="true"
      ref={visualRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetParallax}
    >
      <div className="mk-hero-trophy mk-parallax-layer" ref={trophyRef}>
        <span className="mk-hero-trophy-icon">
          <IconTrophy />
        </span>
      </div>
      <div className="mk-stage-wrap mk-parallax-layer" ref={stageRef}>
        <div className="mk-stage">
          <div className="mk-stage-top">
            <span className="mk-stage-live">
              <i />
              Live
            </span>
            <span className="mk-stage-lot">Lot 23 · 42 sold</span>
          </div>
          <div className="mk-stage-player">
            <span className="mk-stage-mark">{initials}</span>
            <span>
              <span className="mk-stage-name">{player.name}</span>
              <span className="mk-stage-role">{player.role}</span>
            </span>
          </div>
          <div className="mk-stage-bid">
            <span>
              <span className="mk-stage-bid-label">Current bid</span>
              <span className="mk-stage-amount">{bid}</span>
            </span>
            <span className="mk-stage-sold">SOLD</span>
          </div>
          {/* Bid momentum: the war climbing to the winning gold bar. */}
          <div className="mk-stage-spark">
            {Array.from({ length: 7 }).map((_, bar) => (
              <i key={bar} />
            ))}
          </div>
          <div className="mk-stage-teams">
            <span className="mk-stage-team mk-stage-team-a">
              <i />
              by {player.team}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
