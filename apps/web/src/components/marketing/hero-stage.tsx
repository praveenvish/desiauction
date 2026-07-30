"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero's scripted auction replay (2026-07-24 council rebuild). Engineering
 * Council ruling: the landing demonstrates the product with a SCRIPTED timeline
 * through stage markup — a static asset with zero server dependency — never a
 * live room. The loop: bids climb in Indian-grouped rupees while the calling
 * team flips, the SOLD stamp slams (transform-only — axe scans visual contrast
 * regardless of aria-hidden, so no opacity keyframes on text, ever), then the
 * next fictional player takes the block.
 *
 * The server render IS the final SOLD frame of the first player, so no-JS and
 * prefers-reduced-motion both show a truthful, complete scene. The whole block
 * is decorative (aria-hidden); the visible "simulated demo" label lives in the
 * page, outside this block. The old pointer parallax is deliberately gone —
 * the council's motion rule is one signature gesture, and it's the stamp.
 */

export interface StagePlayer {
  lot: number;
  sold: number;
  name: string;
  role: string;
  team: string;
  opening: number;
  final: number;
}

const BID_STEP_MS = 950;
const SOLD_HOLD_MS = 2600;
const BID_STEPS = 5;

function rupees(value: number): string {
  return `₹${value.toLocaleString("en-IN")}`;
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("");
}

/** The bid ladder for one player: opening → final in BID_STEPS moves. */
function ladder(player: StagePlayer): number[] {
  const steps: number[] = [];
  for (let i = 0; i <= BID_STEPS; i += 1) {
    const t = i / BID_STEPS;
    // Ease-out so the war slows as it nears the winning bid.
    const eased = 1 - Math.pow(1 - t, 2);
    const raw = player.opening + (player.final - player.opening) * eased;
    steps.push(Math.round(raw / 500) * 500);
  }
  steps[steps.length - 1] = player.final;
  return steps;
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function HeroStage({
  script,
  teams,
}: {
  script: readonly StagePlayer[];
  teams: readonly string[];
}) {
  const first = script[0] as StagePlayer;
  // SSR truth: the completed SOLD frame of player one.
  const [playerIndex, setPlayerIndex] = useState(0);
  const [bidIndex, setBidIndex] = useState(BID_STEPS);
  const [phase, setPhase] = useState<"bidding" | "sold">("sold");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion() || script.length === 0) {
      return;
    }
    let alive = true;
    let player = 0;
    let bid = BID_STEPS;
    const tick = (delay: number, fn: () => void) => {
      timerRef.current = window.setTimeout(() => {
        if (alive) {
          fn();
        }
      }, delay);
    };
    const advance = () => {
      if (bid < BID_STEPS) {
        bid += 1;
        setBidIndex(bid);
        if (bid === BID_STEPS) {
          setPhase("sold");
          tick(SOLD_HOLD_MS, advance);
        } else {
          tick(BID_STEP_MS, advance);
        }
      } else {
        player = (player + 1) % script.length;
        bid = 0;
        setPlayerIndex(player);
        setBidIndex(0);
        setPhase("bidding");
        tick(BID_STEP_MS, advance);
      }
    };
    // Hold the server-rendered SOLD frame for a beat, then begin the loop.
    tick(SOLD_HOLD_MS, advance);
    return () => {
      alive = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [script]);

  const player = script[playerIndex] ?? first;
  const bids = ladder(player);
  const amount = rupees(bids[Math.min(bidIndex, bids.length - 1)] ?? player.final);
  // While bidding, the calling team rotates; the winner calls the final bid.
  const callingTeam =
    phase === "sold"
      ? player.team
      : (teams[(playerIndex + bidIndex) % teams.length] ?? player.team);
  const teamSlot = ["a", "b", "c"][teams.indexOf(callingTeam) % 3] ?? "a";

  return (
    <div className="mk-hero-visual" aria-hidden="true">
      <div className="mk-stage-wrap">
        <div className="mk-stage" data-phase={phase}>
          <div className="mk-stage-top">
            <span className="mk-stage-live">
              <i />
              Live
            </span>
            <span className="mk-stage-lot">
              Lot {player.lot} · {player.sold} sold
            </span>
          </div>
          <div className="mk-stage-player">
            <span className="mk-stage-mark">{initialsOf(player.name)}</span>
            <span>
              <span className="mk-stage-name">{player.name}</span>
              <span className="mk-stage-role">{player.role}</span>
            </span>
          </div>
          <div className="mk-stage-bid">
            <span>
              <span className="mk-stage-bid-label">
                {phase === "sold" ? "Winning bid" : "Current bid"}
              </span>
              <span className="mk-stage-amount">{amount}</span>
            </span>
            <span className="mk-stage-sold">SOLD</span>
          </div>
          <div className="mk-stage-spark">
            {Array.from({ length: BID_STEPS + 2 }).map((_, bar) => (
              <i key={bar} data-lit={bar <= bidIndex + 1} />
            ))}
          </div>
          <div className="mk-stage-teams">
            <span className={`mk-stage-team mk-stage-team-${teamSlot}`}>
              <i />
              {phase === "sold" ? `to ${player.team}` : `${callingTeam} calling`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
