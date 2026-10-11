"use client";

import { useState } from "react";
import Link from "next/link";
import type { CricketCareer } from "../server/player/career-stats";
import { StatStrip } from "./public/public-kit";
import "./cricket-career.css";

const decimal = (value: number | null) => (value === null ? "—" : value.toFixed(1));
const trustLabels = {
  verified: "Verified",
  confirmed: "Confirmed",
  self_scored: "Self-scored · Not on leaderboards",
  flagged: "Flagged · Not on leaderboards",
};
function groupLabel(key: string) {
  if (key === "all") return "All";
  const value = key.split(":")[1] ?? key;
  return (
    (
      {
        t20: "T20",
        t10: "T10",
        odi: "One day",
        box: "Box",
        six_over: "Six overs",
        tennis_gully: "Tennis gully",
        unspecified: "Ball unspecified",
      } as Record<string, string>
    )[value] ?? `${value[0]?.toUpperCase() ?? ""}${value.slice(1)} ball`
  );
}
export function CricketCareerSection({ career }: { career: CricketCareer }) {
  const [selected, setSelected] = useState("all");
  const group = career.groups.find((row) => row.key === selected) ?? career.groups[0];
  if (!group) return null;
  return (
    <section
      className="cricket-career"
      aria-labelledby="cricket-career-heading"
      data-testid="cricket-career"
    >
      <h2 id="cricket-career-heading">Cricket stats</h2>
      <p>Scored matches · All trust levels. Super overs excluded.</p>
      <div className="career-filters" aria-label="Career format and ball filters">
        {career.groups.map((row) => (
          <button
            key={row.key}
            type="button"
            aria-pressed={selected === row.key}
            onClick={() => {
              setSelected(row.key);
            }}
          >
            {groupLabel(row.key)}
          </button>
        ))}
      </div>
      {group.matches === 0 ? (
        <p>Your playing figures will appear after a scored match finishes.</p>
      ) : (
        <>
          <h3>
            Batting · {String(group.matches)} {group.matches === 1 ? "match" : "matches"}
          </h3>
          <StatStrip
            label="Batting figures, all trust levels"
            stats={[
              { label: "Runs", value: String(group.runs) },
              { label: "Average", value: decimal(group.average) },
              { label: "Strike rate", value: decimal(group.strikeRate) },
              {
                label: "Best",
                value: group.best
                  ? `${String(group.best.runs)}${group.best.notOut ? "*" : ""}`
                  : "—",
              },
              { label: "Fifties", value: String(group.fifties) },
              { label: "Sixes", value: String(group.sixes) },
            ]}
          />
          <h3>Bowling</h3>
          <StatStrip
            label="Bowling figures, all trust levels"
            stats={[
              { label: "Wickets", value: String(group.wickets) },
              { label: "Economy", value: decimal(group.economy) },
              {
                label: "Best",
                value: group.bowlingBest
                  ? `${String(group.bowlingBest.wickets)}/${String(group.bowlingBest.runs)}`
                  : "—",
              },
            ]}
          />
          {group.trusted ? (
            <details>
              <summary>
                Verified and confirmed figures · {String(group.trusted.matches)} matches
              </summary>
              <p>
                {String(group.trusted.balls)} batting balls · {String(group.trusted.bowlingBalls)}{" "}
                bowling balls
              </p>
              <ul>
                {(
                  [
                    ["Strike rate", group.trusted.strikeRate],
                    ["Batting average", group.trusted.average],
                    ["Economy", group.trusted.economy],
                    ["Bowling average", group.trusted.bowlingAverage],
                  ] as const
                ).map(([label, metric]) => (
                  <li key={label}>
                    {label}: {decimal(metric.value)} ·{" "}
                    {metric.qualified
                      ? "Qualified"
                      : `Not yet qualified · ${String(metric.remaining)} more ${label.includes("average") ? "innings" : "balls"}`}
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p>No verified or confirmed figures yet.</p>
          )}
          <h3>Last five innings</h3>
          <ul className="career-innings">
            {group.lastFive.map((row) => (
              <li key={row.fixtureId}>
                <strong>
                  {String(row.batting.runs)}
                  {row.batting.notOut ? "*" : ""}
                </strong>
                <span>{String(row.batting.balls)} balls</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Awards</h3>
      {Object.entries(career.awards).length ? (
        <ul className="career-awards">
          {Object.entries(career.awards).map(([kind, count]) => (
            <li key={kind}>
              <strong>× {String(count)}</strong>
              <span>
                {kind === "player_of_match"
                  ? "Player of the Match"
                  : kind === "fighter_of_match"
                    ? "Fighter of the Match"
                    : kind}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No match awards yet.</p>
      )}
      <h3>Recent matches</h3>
      <ul className="career-recent">
        {career.recent.map((row) => (
          <li key={row.fixtureId}>
            <Link href={row.href}>{row.opponent ? `vs ${row.opponent}` : row.label}</Link>
            <span>
              {row.batting
                ? `${String(row.batting.runs)}${row.batting.notOut ? "*" : ""} (${String(row.batting.balls)})`
                : ""}
              {row.bowling ? ` · ${String(row.bowling.wickets)}/${String(row.bowling.runs)}` : ""}
            </span>
            <small>{trustLabels[row.trust]}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
