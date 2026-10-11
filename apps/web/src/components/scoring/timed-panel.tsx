"use client";
import { useEffect, useState } from "react";
import { timedClockDisplay } from "@desiauction/core/scoring/timed-clock";
import type { TimedPanel, RaidClockContext, PublicLiveState } from "@desiauction/core/scoring";
export function TimedLiveScore({
  panel,
  live,
  clock,
  observedAt,
}: {
  panel: TimedPanel;
  live: PublicLiveState;
  clock: RaidClockContext | undefined;
  observedAt: number | undefined;
}) {
  const key = clock ? `${String(clock.serverAtMs)}:${String(clock.delayMs)}` : "";
  const [tick, setTick] = useState({ key: "", elapsed: 0 });
  useEffect(() => {
    if (!clock) return;
    const start = observedAt ?? performance.now();
    const timer = setInterval(() => {
      setTick({ key, elapsed: Math.max(0, performance.now() - start) });
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [clock, key, observedAt]);
  const display = clock
    ? timedClockDisplay(panel, clock, tick.key === key ? tick.elapsed : 0)
    : panel;
  const time = (ms: number) =>
    `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  return (
    <div data-testid="live-score" data-seq={live.seq} id="live-score" tabIndex={-1}>
      <p>
        Period {panel.period || 1} ·{" "}
        <span data-testid="live-timed-clock">{time(display.periodElapsedMs)}</span>
      </p>
      <div className="live-score" aria-label="Current score">
        {panel.points.home}–{panel.points.away}
      </div>
      <p>Game time {time(display.gameClockMs)}</p>
      {panel.shootout ? (
        <p>
          Penalties {panel.shootout.points.home}–{panel.shootout.points.away}
        </p>
      ) : null}
      <ol aria-label="Match timeline">
        {panel.timeline.map((entry) => (
          <li key={entry.seq}>
            {Math.floor(entry.gameClockMs / 60000)}′ ·{" "}
            {entry.kind === "card"
              ? `${entry.colour ?? ""} card · ${entry.playerName ?? "Player"}`
              : `${entry.side ? live.teams[entry.side].name : "Team"} +${String(entry.points)} · ${entry.playerName ?? "Scorer not recorded"}${entry.assistName ? ` · Assist ${entry.assistName}` : ""}`}
          </li>
        ))}
      </ol>
    </div>
  );
}
