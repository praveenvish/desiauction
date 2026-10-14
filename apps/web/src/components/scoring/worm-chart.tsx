"use client";
import { useState } from "react";
import { wormModel } from "./worm-model";
import type { ChartInnings } from "./wagon-model";
export interface ChartSeries {
  innings: ChartInnings;
  name: string;
}
export function WormChart({
  series,
  ballsPerOver,
}: {
  series: ChartSeries[];
  ballsPerOver: number;
}) {
  const [readout, setReadout] = useState("Hover or focus an over to compare.");
  const maxBalls = Math.max(1, ...series.map(({ innings }) => innings.legalBalls));
  const maxRuns = Math.max(
    1,
    ...series.flatMap(({ innings }) => innings.points.map((point) => point.runs)),
  );
  const x = (balls: number) => 32 + (balls / maxBalls) * 308;
  const y = (runs: number) => 180 - (runs / maxRuns) * 150;
  const comparison = (balls: number) =>
    `After ${String(balls)} legal balls · ${series
      .map(({ innings, name }) => {
        const point = innings.points.findLast((value) => value.legalBalls <= balls);
        return `${name} ${String(point?.runs ?? 0)}/${String(point?.wickets ?? 0)}`;
      })
      .join(" · ")}`;
  return (
    <section className="live-panel chart-panel" aria-label="Worm chart">
      <h2>Runs by legal ball</h2>
      <ul className="chart-legend" aria-label="Innings legend">
        {series.map(({ innings, name }, index) => (
          <li key={innings.no} className={`chart-series-${String(index + 1)}`}>
            {name}
          </li>
        ))}
      </ul>
      <p className="chart-readout" role="status">
        {readout}
      </p>
      <svg
        viewBox="0 0 360 220"
        role="group"
        aria-label="Cumulative innings runs"
        className="chart-plot"
      >
        <g aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1="32"
                x2="340"
                y1={y(maxRuns * fraction)}
                y2={y(maxRuns * fraction)}
                className="chart-grid"
              />
              <text x="26" y={y(maxRuns * fraction) + 4} textAnchor="end">
                {Math.round(maxRuns * fraction)}
              </text>
            </g>
          ))}
          <text x="32" y="204">
            0
          </text>
          <text x="340" y="204" textAnchor="end">
            {maxBalls} legal balls
          </text>
        </g>
        {series.map(({ innings, name }, index) => {
          const points = wormModel(innings, ballsPerOver);
          return (
            <g key={innings.no} className={`chart-series-${String(index + 1)}`}>
              <polyline
                fill="none"
                points={points
                  .map((point) => `${String(x(point.legalBalls))},${String(y(point.runs))}`)
                  .join(" ")}
                className="chart-line"
                aria-hidden="true"
              />
              {points.map((point, pointIndex) => {
                const label = `${name} · ${point.label} · ${String(point.runs)}/${String(point.wickets)}${point.kind !== "delivery" ? ` · ${point.subsequent ? "subsequent " : ""}${point.kind}` : ""}`;
                return (
                  <circle
                    key={`${String(point.seq)}-${String(pointIndex)}`}
                    cx={x(point.legalBalls)}
                    cy={y(point.runs)}
                    r={point.kind === "delivery" ? 3 : 4}
                    tabIndex={
                      point.kind !== "delivery" ||
                      point.ballsInOver === 0 ||
                      pointIndex === points.length - 1
                        ? 0
                        : -1
                    }
                    role="img"
                    aria-label={label}
                    className="chart-point"
                    onFocus={() => {
                      setReadout(`${label} · ${comparison(point.legalBalls)}`);
                    }}
                    onMouseEnter={() => {
                      setReadout(`${label} · ${comparison(point.legalBalls)}`);
                    }}
                  >
                    <title>{label}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
      <p className="chart-note">
        Extras and non-delivery adjustments can share the same legal-ball position.
      </p>
      <a
        href="#worm-table"
        onClick={(event) => {
          const details = event.currentTarget.nextElementSibling;
          if (details instanceof HTMLDetailsElement) details.open = true;
        }}
      >
        See it as a table
      </a>
      <details id="worm-table">
        <summary>Cumulative score</summary>
        <div
          className="live-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Cumulative score table"
        >
          <table>
            <caption>Score progression</caption>
            <thead>
              <tr>
                <th scope="col">Innings</th>
                <th scope="col">Legal balls</th>
                <th scope="col">Runs</th>
                <th scope="col">Wickets</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {series.flatMap(({ innings, name }) =>
                innings.points.map((point) => (
                  <tr key={`${String(innings.no)}-${String(point.seq)}`}>
                    <th scope="row">{name}</th>
                    <td>{point.legalBalls}</td>
                    <td>{point.runs}</td>
                    <td>{point.wickets}</td>
                    <td>
                      {point.subsequent ? "Subsequent " : ""}
                      {point.kind}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
