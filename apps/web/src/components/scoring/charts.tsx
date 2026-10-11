"use client";
import { useState } from "react";
import { Button, Tabs } from "@desiauction/ui";
import type { PublicCharts, PublicLiveState } from "@desiauction/core/scoring";
import { WagonWheel } from "./wagon-wheel";
import { WormChart } from "./worm-chart";
import { ManhattanChart } from "./manhattan-chart";
import "./charts.css";
export function Charts({
  live,
  charts,
}: {
  live: PublicLiveState | null;
  charts: PublicCharts | undefined;
}) {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [inningsNo, setInningsNo] = useState<number | null>(null);
  if (!live || !charts || charts.seq !== live.seq)
    return (
      <section className="live-panel">
        <h2>Charts</h2>
        <p>Charts unavailable for this score.</p>
      </section>
    );
  const groups = new Map<string, PublicCharts["innings"]>();
  const firstSuper = charts.innings.find((innings) => innings.superOver)?.no ?? 0;
  for (const innings of charts.innings) {
    const key = innings.superOver
      ? `s${String(Math.floor((innings.no - firstSuper) / 2))}`
      : `r${String(Math.floor((innings.no - 1) / 2))}`;
    groups.set(key, [...(groups.get(key) ?? []), innings]);
  }
  const entries = [...groups.entries()];
  const group = entries.find(([id]) => id === groupId) ?? entries.at(-1);
  if (!group)
    return (
      <section className="live-panel">
        <h2>Charts</h2>
        <p>Charts appear after the first innings starts.</p>
      </section>
    );
  const innings = group[1].find((value) => value.no === inningsNo) ?? group[1].at(-1);
  if (!innings) return null;
  const name = (teamId: string) =>
    Object.values(live.teams).find((team) => team.id === teamId)?.name ?? "Team";
  const series = group[1].map((value) => ({ innings: value, name: name(value.battingTeamId) }));
  return (
    <div className="match-charts">
      <div className="chart-groups" aria-label="Choose innings group">
        {entries.map(([id, values]) => (
          <Button
            key={id}
            variant="ghost"
            aria-pressed={id === group[0]}
            onClick={() => {
              setGroupId(id);
              setInningsNo(null);
            }}
          >
            {values[0]?.superOver
              ? `Super over ${String(Number(id.slice(1)) + 1)}`
              : entries.filter(([key]) => key.startsWith("r")).length > 1
                ? `Regulation innings ${values.map((value) => String(value.no)).join("–")}`
                : "Regulation"}
          </Button>
        ))}
      </div>
      <label className="chart-innings-choice">
        Shot map innings
        <select
          value={innings.no}
          onChange={(event) => {
            setInningsNo(Number(event.target.value));
          }}
        >
          {group[1].map((value) => (
            <option key={value.no} value={value.no}>
              {name(value.battingTeamId)} · innings {value.no}
            </option>
          ))}
        </select>
      </label>
      <Tabs
        label="Chart types"
        tabs={[
          {
            id: "wagon",
            label: "Wagon wheel",
            content: <WagonWheel key={innings.no} innings={innings} />,
          },
          {
            id: "worm",
            label: "Worm",
            content: <WormChart series={series} ballsPerOver={charts.ballsPerOver} />,
          },
          { id: "manhattan", label: "Manhattan", content: <ManhattanChart series={series} /> },
        ]}
      />
    </div>
  );
}
