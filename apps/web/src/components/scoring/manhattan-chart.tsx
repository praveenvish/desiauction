"use client";
import { useState } from "react";
import { manhattanModel } from "./manhattan-model";
import type { ChartSeries } from "./worm-chart";
export function ManhattanChart({ series }: { series: ChartSeries[] }) {
  const [readout, setReadout] = useState("Hover or focus a bar for that over.");
  const maxOvers = Math.max(1, ...series.map(({ innings }) => innings.overs.length));
  const maxRuns = Math.max(
    1,
    ...series.flatMap(({ innings }) => innings.overs.map((over) => over.runs)),
  );
  const step = 308 / maxOvers;
  const width = Math.min(24, step / (series.length + 1));
  return (
    <section className="live-panel chart-panel" aria-label="Manhattan chart">
      <h2>Runs per over</h2>
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
        aria-label="Delivery runs per over"
        className="chart-plot"
      >
        <g aria-hidden="true">
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1="32"
                x2="340"
                y1={180 - 150 * fraction}
                y2={180 - 150 * fraction}
                className="chart-grid"
              />
              <text x="26" y={184 - 150 * fraction} textAnchor="end">
                {Math.round(maxRuns * fraction)}
              </text>
            </g>
          ))}
          <text x="32" y="204">
            1
          </text>
          <text x="340" y="204" textAnchor="end">
            {maxOvers} overs
          </text>
        </g>
        {series.flatMap(({ innings, name }, seriesIndex) =>
          manhattanModel(innings).bars.map((bar) => {
            const height = Math.max(2, (bar.runs / maxRuns) * 150);
            const x = 32 + (bar.number - 1) * step + seriesIndex * width;
            const label = `${name} · ${bar.label} · ${String(bar.runs)} runs · ${String(bar.wickets)} wickets`;
            return (
              <g
                key={`${String(innings.no)}-${String(bar.number)}`}
                className={`chart-series-${String(seriesIndex + 1)}`}
              >
                <rect
                  x={x}
                  y={180 - height}
                  width={Math.max(2, width - 1)}
                  height={height}
                  tabIndex={0}
                  role="img"
                  aria-label={label}
                  className="chart-bar"
                  onFocus={() => {
                    setReadout(label);
                  }}
                  onMouseEnter={() => {
                    setReadout(label);
                  }}
                >
                  <title>{label}</title>
                </rect>
                {bar.wickets ? (
                  <line
                    x1={x}
                    x2={x + Math.max(2, width - 1)}
                    y1={180 - height}
                    y2={180 - height}
                    className="chart-wicket-cap"
                    aria-hidden="true"
                  />
                ) : null}
              </g>
            );
          }),
        )}
      </svg>
      <p className="chart-note">
        A neutral cap marks an over with a delivery wicket. Penalties and retirement wickets stay
        separate.
      </p>
      {series.map(({ innings, name }) => (
        <div key={innings.no}>
          <p>
            {name} · total {manhattanModel(innings).total}
          </p>
          {innings.adjustments.length ? (
            <ul>
              {innings.adjustments.map((adjustment) => (
                <li key={adjustment.seq}>
                  {adjustment.subsequent ? "Subsequent " : ""}
                  {adjustment.kind} · {adjustment.runs} runs · {adjustment.wickets} wickets · after{" "}
                  {adjustment.legalBalls} legal balls
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      <a
        href="#manhattan-table"
        onClick={(event) => {
          const details = event.currentTarget.nextElementSibling;
          if (details instanceof HTMLDetailsElement) details.open = true;
        }}
      >
        See it as a table
      </a>
      <details id="manhattan-table">
        <summary>Overs and adjustments</summary>
        <div
          className="live-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Overs and adjustments table"
        >
          <table>
            <caption>Delivery runs and separate adjustments</caption>
            <thead>
              <tr>
                <th scope="col">Innings</th>
                <th scope="col">Over or change</th>
                <th scope="col">Runs</th>
                <th scope="col">Wickets</th>
              </tr>
            </thead>
            <tbody>
              {series.flatMap(({ innings, name }) => [
                ...manhattanModel(innings).bars.map((bar) => (
                  <tr key={`${String(innings.no)}-over-${String(bar.number)}`}>
                    <th scope="row">{name}</th>
                    <td>{bar.label}</td>
                    <td>{bar.runs}</td>
                    <td>{bar.wickets}</td>
                  </tr>
                )),
                ...innings.adjustments.map((adjustment) => (
                  <tr key={`${String(innings.no)}-adjustment-${String(adjustment.seq)}`}>
                    <th scope="row">{name}</th>
                    <td>
                      {adjustment.subsequent ? "Subsequent " : ""}
                      {adjustment.kind} after {adjustment.legalBalls} balls
                    </td>
                    <td>{adjustment.runs}</td>
                    <td>{adjustment.wickets}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
