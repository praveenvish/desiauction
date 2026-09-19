"use client";

import { GoldDrift, RollingNumber, SoldStamp, Tilt } from "@desiauction/ui";
import { useEffect, useRef, useState } from "react";

/**
 * The hero's scripted auction replay (2026-07-24 council rebuild; PREMIUM-1
 * theatre). Engineering Council ruling: the landing demonstrates the product
 * with a SCRIPTED timeline through stage markup — a static asset with zero
 * server dependency — never a live room.
 *
 * What the visitor now sees is the DUEL, not a number: three fictional
 * franchises call the lot in turn, the price rolls up digit by digit, the
 * paddle that called it lights, and at the top of the ladder the gavel strikes
 * and gold SOLD lands on the card — the same `SoldStamp`, `RollingNumber` and
 * `GoldDrift` the real auction room uses, so the demo IS the product's
 * choreography and cannot drift from it.
 *
 * The server render IS the final SOLD frame of the first player, so no-JS and
 * prefers-reduced-motion both show a truthful, complete scene. The whole block
 * is decorative (aria-hidden); the visible "simulated demo" label lives in the
 * page, outside this block. Text never animates opacity (axe samples every
 * frame); the digits roll by transform and the stamp scales.
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
const SOLD_HOLD_MS = 3200;
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

  /**
   * Who called each rung. The winner always calls the last one; the rungs
   * before it rotate through the other franchises, so every paddle gets a
   * turn and the final call visibly changes hands.
   */
  const callerAt = (step: number): string | null => {
    if (step === 0) return null;
    if (step === BID_STEPS) return player.team;
    const rivals = teams.filter((team) => team !== player.team);
    return rivals[(playerIndex + step) % Math.max(1, rivals.length)] ?? player.team;
  };
  const callingTeam = callerAt(bidIndex);
  const lastCallOf = (team: string): number | null => {
    for (let step = bidIndex; step >= 1; step -= 1) {
      if (callerAt(step) === team) return bids[step] ?? null;
    }
    return null;
  };

  return (
    <div className="mk-hero-visual" aria-hidden="true">
      <Tilt className="mk-stage-wrap" glare max={4}>
        <div className="mk-stage" data-phase={phase}>
          {phase === "sold" ? <GoldDrift count={14} className="mk-stage-drift" /> : null}
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
              <RollingNumber className="mk-stage-amount" value={amount} />
            </span>
            {phase === "sold" ? <SoldStamp className="mk-stage-stamp" /> : null}
          </div>
          <ul className="mk-stage-paddles">
            {teams.map((team, index) => {
              const call = lastCallOf(team);
              const won = phase === "sold" && team === player.team;
              const leading = !won && phase === "bidding" && callingTeam === team;
              const slot = ["a", "b", "c"][index % 3] ?? "a";
              return (
                <li
                  key={team}
                  className={`mk-stage-paddle mk-stage-team-${slot}`}
                  data-leading={leading ? "true" : "false"}
                  data-won={won ? "true" : "false"}
                >
                  <i />
                  <span className="mk-stage-paddle-name">{team}</span>
                  <span className="mk-stage-paddle-call">{call === null ? "—" : rupees(call)}</span>
                  <span className="mk-stage-paddle-tag">
                    {won ? "Sold" : leading ? "Leading" : call === null ? "Watching" : "Outbid"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </Tilt>
    </div>
  );
}
