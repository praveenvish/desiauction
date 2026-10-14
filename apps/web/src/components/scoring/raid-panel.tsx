"use client";
import { useEffect, useState } from "react";
import { raidClockDisplay } from "@desiauction/core/scoring/raid-clock";
import type { RaidClockContext, RaidPanel, PublicLiveState } from "@desiauction/core/scoring";
export function RaidLiveScore({
  panel,
  live,
  clock,
  observedAt,
}: {
  panel: RaidPanel;
  live: PublicLiveState;
  clock: RaidClockContext | undefined;
  observedAt: number | undefined;
}) {
  const key = clock ? `${String(clock.serverAtMs)}:${String(clock.delayMs)}` : "";
  const [tick, setTick] = useState({ key: "", elapsed: 0 });
  useEffect(() => {
    if (!clock) return;
    const started = observedAt ?? performance.now();
    const timer = setInterval(() => {
      setTick({ key, elapsed: Math.max(0, performance.now() - started) });
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [clock, key, observedAt]);
  const display = clock
    ? raidClockDisplay(panel, clock, tick.key === key ? tick.elapsed : 0)
    : { halfElapsedMs: panel.halfElapsedMs, raidElapsedMs: panel.raidElapsedMs };
  const time = (ms: number) =>
    `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  return (
    <div data-testid="live-score" data-seq={live.seq} id="live-score" tabIndex={-1}>
      <p className="live-side">
        Half {panel.half || 1} ·{" "}
        <span data-testid="live-raid-half-clock">{time(display.halfElapsedMs)}</span>
      </p>
      <div className="live-score" aria-label="Current points">
        {panel.points.home}–{panel.points.away}
      </div>
      <p>
        Raid timer (advisory):{" "}
        <span data-testid="live-raid-timer">{time(30000 - display.raidElapsedMs)}</span>
      </p>
      <p>
        {live.teams.home.name} · {panel.matCount.home} on mat · {live.teams.away.name} ·{" "}
        {panel.matCount.away} on mat
      </p>
      {live.phase === "live" && !panel.halfClosed ? (
        <p>
          Raiding: {live.teams[panel.nextRaidingSide].name}
          {panel.doOrDie[panel.nextRaidingSide] ? " · Do-or-die raid" : ""}
        </p>
      ) : null}
    </div>
  );
}
