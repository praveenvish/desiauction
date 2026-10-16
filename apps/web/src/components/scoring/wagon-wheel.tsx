"use client";
import { useState } from "react";
import { FieldSvg } from "./field-svg";
import { wagonModel, type ChartInnings } from "./wagon-model";
export function WagonWheel({ innings }: { innings: ChartInnings }) {
  const [batter, setBatter] = useState<string | null>(null);
  const [readout, setReadout] = useState("Focus a recorded shot for its details.");
  const selected = batter && innings.currentBatterIds.includes(batter) ? batter : null;
  const shots = wagonModel(innings, selected);
  const name = (id: string) => innings.batters.find((player) => player.id === id)?.name ?? "Player";
  return (
    <section className="live-panel chart-panel" aria-label="Wagon wheel" data-testid="live-wagon">
      <div className="chart-batter-pills" aria-label="Filter recorded shots">
        {innings.currentBatterIds.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={selected === id}
            onClick={() => {
              setBatter(id);
            }}
          >
            {name(id)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={selected === null}
          onClick={() => {
            setBatter(null);
          }}
        >
          All
        </button>
      </div>
      <p className="chart-note">Bowler’s end ↑</p>
      <p>
        {selected ? name(selected) : "All batters"} · {shots.length} recorded scoring shots ·{" "}
        {shots.reduce((sum, shot) => sum + shot.runs, 0)} runs
      </p>
      <FieldSvg label="Recorded scoring-shot directions">
        {shots.map((shot) => {
          const label = `${name(shot.batterId)} · ${String(shot.runs)} runs · ${String(shot.angle)} degrees${shot.category === "other" ? " · Other" : ""}`;
          return (
            <line
              key={shot.seq}
              x1="100"
              y1="100"
              x2={shot.x}
              y2={shot.y}
              tabIndex={0}
              role="img"
              aria-label={label}
              className={`chart-shot chart-shot-${shot.category}`}
              onFocus={() => {
                setReadout(label);
              }}
              onMouseEnter={() => {
                setReadout(label);
              }}
            >
              <title>{label}</title>
            </line>
          );
        })}
      </FieldSvg>
      <ul className="chart-legend" aria-label="Shot legend">
        <li className="chart-shot-key-runs">1–3</li>
        <li className="chart-shot-key-four">Four</li>
        <li className="chart-shot-key-six">Six</li>
        {shots.some((shot) => shot.category === "other") ? <li>Other</li> : null}
      </ul>
      <p role="status" className="chart-readout">
        {shots.length ? readout : "No recorded scoring shots."}
      </p>
      <p className="chart-note">
        Only shots with a recorded direction appear. Length indicates run category.
      </p>
      <a
        href="#wagon-table"
        onClick={(event) => {
          const details = event.currentTarget.nextElementSibling;
          if (details instanceof HTMLDetailsElement) details.open = true;
        }}
      >
        See it as a table
      </a>
      <details id="wagon-table">
        <summary>Recorded shots</summary>
        <div
          className="live-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Recorded shots table"
        >
          <table>
            <caption>Recorded scoring shots</caption>
            <thead>
              <tr>
                <th scope="col">Batter</th>
                <th scope="col">Runs</th>
                <th scope="col">Angle</th>
                <th scope="col">Category</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((shot) => (
                <tr key={shot.seq}>
                  <th scope="row">{name(shot.batterId)}</th>
                  <td>{shot.runs}</td>
                  <td>{shot.angle}°</td>
                  <td>{shot.category === "runs" ? "1–3" : shot.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
