import { insightHref, type InsightQuery } from "../lib/insight-navigation";
import Link from "next/link";
import { PlayerPortrait } from "@desiauction/ui";
import { styleLabel } from "@desiauction/core";
import { FieldSvg } from "./scoring/field-svg";
import type { BatterInsights } from "../server/insights/batter";
import type { BowlerInsights } from "../server/insights/bowler";
import type { InsightAggregate, InsightFilter } from "../server/insights/sample";
import "./scoring/charts.css";
import "./cricket-insights.css";

export type InsightSearch = InsightQuery;
export function insightFilters(query: InsightSearch): InsightFilter {
  const filter: InsightFilter = {};
  for (const key of ["ballType", "timeOfDay", "formatKey", "pitch", "groundType"] as const) {
    const value = query[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 40) filter[key] = value;
  }
  return filter;
}
const insightConditions = [
  {
    name: "ballType",
    title: "Ball",
    options: [
      ["leather", "Leather"],
      ["tennis", "Tennis"],
      ["tape", "Tape"],
      ["rubber", "Rubber"],
    ],
  },
  {
    name: "timeOfDay",
    title: "Light",
    options: [
      ["day", "Day"],
      ["day_night", "Day–night"],
      ["night", "Night"],
    ],
  },
  {
    name: "formatKey",
    title: "Format",
    options: [
      ["t20", "T20"],
      ["t10", "T10"],
      ["odi", "ODI"],
      ["six_over", "Six overs"],
      ["tennis_gully", "Tennis gully"],
      ["box_6", "Box"],
    ],
  },
  {
    name: "pitch",
    title: "Pitch",
    options: [
      ["turf", "Turf"],
      ["matting", "Matting"],
      ["astroturf", "Astroturf"],
      ["cement", "Cement"],
    ],
  },
  {
    name: "groundType",
    title: "Ground",
    options: [
      ["full", "Full ground"],
      ["half", "Half ground"],
      ["box", "Box"],
      ["indoor", "Indoor"],
    ],
  },
] as const;
const metric = (value: number | null) => (value === null ? "—" : value.toFixed(1));
const label = (key: string | null) => (key === null ? "Not recorded" : key.replaceAll("_", " "));
function Sample({ value }: { value: BatterInsights["sample"] }) {
  return (
    <p data-testid="insights-sample" className="insight-sample">
      {value.balls} balls in {value.matches} matches
      {value.small ? <span>Small sample · {value.remaining} more balls for 60</span> : null}
    </p>
  );
}
function Bars({
  rows,
  unit,
}: {
  rows: { key: string | null; value: number | null; note: string; small?: boolean }[];
  unit: string;
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.value ?? 0));
  return rows.length ? (
    <ul className="insight-bars">
      {rows.map((row) => (
        <li key={row.key ?? "unknown"}>
          <div>
            <strong>{label(styleLabel(row.key))}</strong>
            <span>
              {metric(row.value)} {unit}
            </span>
          </div>
          <div className="insight-track" aria-hidden>
            <i style={{ width: `${String(((row.value ?? 0) / maximum) * 100)}%` }} />
          </div>
          <small>
            {row.note}
            {row.small ? " · Small sample" : ""}
          </small>
        </li>
      ))}
    </ul>
  ) : (
    <p>No recorded data for this selection.</p>
  );
}
export function RecordedShots({ rows }: { rows: InsightAggregate[] }) {
  return (
    <>
      <FieldSvg label="Recorded scoring-shot directions">
        {rows.map((row) => {
          const [, angleText, , boundaryText] = (row.key ?? "").split("|");
          const angle = Number(angleText),
            boundary = Number(boundaryText);
          if (!Number.isFinite(angle)) return null;
          const radians = (angle * Math.PI) / 180;
          const radius = boundary ? 88 : 58;
          return (
            <line
              key={row.key}
              x1={100}
              y1={100}
              x2={100 + Math.sin(radians) * radius}
              y2={100 - Math.cos(radians) * radius}
              className={`insight-shot insight-shot-${String(boundary)}`}
            >
              <title>{`${String(row.deliveries)} recorded shots · ${String(row.runs)} runs · ${String(angle)} degrees`}</title>
            </line>
          );
        })}
      </FieldSvg>
      <p className="insight-legend">
        Other runs · <span>Fours</span> · <strong>Sixes</strong>
      </p>
      <p>{rows.reduce((sum, row) => sum + row.deliveries, 0)} recorded scoring shots</p>
    </>
  );
}
export function CricketInsights({
  name,
  batter,
  bowler,
  basePath,
  query,
  profile,
  scope = "public",
  profileHref,
}: {
  name: string;
  scope?: "self" | "public";
  profileHref?: string;
  profile?:
    { seed: string; photoUrl?: string | null; description?: string | undefined } | undefined;
  batter: BatterInsights;
  bowler: BowlerInsights;
  basePath: string;
  query: InsightSearch;
}) {
  const bowling = query.view === "bowling";
  const current = bowling ? bowler : batter;
  const link = (changes: Record<string, string>) => insightHref(basePath, query, changes);
  return (
    <div className="cricket-insights">
      {profileHref && (
        <Link className="insight-back" href={profileHref}>
          Back to my profile
        </Link>
      )}
      <p className="insight-scope">
        {scope === "self" ? "My cricket insights · private view" : "Public player insights"}
      </p>
      <header className="insight-heading">
        <p>{bowling ? "Bowling insights" : "Batting insights"}</p>
        <div className="insight-player">
          <PlayerPortrait
            name={name}
            seed={profile?.seed ?? name}
            src={profile?.photoUrl}
            decorative
          />
          <div>
            <h2>{name}</h2>
            {profile?.description && <p>{profile.description}</p>}
          </div>
        </div>
        <Sample value={current.sample} />
      </header>
      <nav className="insight-filters" aria-label="Insight view">
        <Link href={link({ view: "batting" })} aria-current={!bowling ? "page" : undefined}>
          Batting
        </Link>
        <Link href={link({ view: "bowling" })} aria-current={bowling ? "page" : undefined}>
          Bowling
        </Link>
      </nav>
      <form className="insight-filters" action={basePath}>
        <input type="hidden" name="view" value={bowling ? "bowling" : "batting"} />
        {insightConditions.map((condition) => {
          const value = query[condition.name];
          const selected = typeof value === "string" && value.length <= 40 ? value : "";
          return (
            <div className="insight-condition-control" key={condition.name}>
              <label htmlFor={`insight-${condition.name}`}>{condition.title}</label>
              <select
                id={`insight-${condition.name}`}
                name={condition.name}
                defaultValue={selected}
              >
                <option value="">All</option>
                {selected && !condition.options.some(([key]) => key === selected) && (
                  <option value={selected}>Selected: {selected.replaceAll("_", " ")}</option>
                )}
                {condition.options.map(([key, title]) => (
                  <option key={key} value={key}>
                    {title}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        <button type="submit">Apply filters</button>
        <Link
          href={link({ ballType: "", timeOfDay: "", formatKey: "", pitch: "", groundType: "" })}
        >
          Clear conditions
        </Link>
      </form>
      <dl className="insight-stats">
        {(bowling
          ? [
              ["Wickets", String(bowler.wickets)],
              ["Economy", metric(bowler.economy)],
              ["Dot balls", bowler.dotPercent === null ? "—" : `${metric(bowler.dotPercent)}%`],
            ]
          : [
              ["Runs", String(batter.runs)],
              ["Strike rate", metric(batter.strikeRate)],
              ["Average", metric(batter.average)],
            ]
        ).map(([title, value]) => (
          <div key={title}>
            <dt>{title}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="insight-footnote">
        — means a figure cannot be calculated from the available records. It does not mean zero.
      </p>
      <div className="insight-grid">
        <section data-testid="insights-wagon" className="insight-card">
          <h3>{bowling ? "Where batters score" : "Scoring directions"}</h3>
          <RecordedShots rows={current.shots} />
          <details>
            <summary>Runs by area</summary>
            <ul>
              {current.zones.map((row) => (
                <li key={row.key ?? "unknown"}>
                  {label(row.key)} · {row.runs} runs · {row.sample.balls} balls
                  {row.sample.small ? " · Small sample" : ""}
                </li>
              ))}
            </ul>
          </details>
        </section>
        <section data-testid="insights-vs-type" className="insight-card">
          <h3>{bowling ? "Recorded wickets" : "Against bowling types"}</h3>
          {bowling ? (
            <Bars
              rows={bowler.dismissals.map((row) => ({
                key: row.kind,
                value: row.count,
                note: "Recorded wickets",
              }))}
              unit="wickets"
            />
          ) : (
            <Bars
              rows={batter.bowlingTypes.map((row) => ({
                key: row.key,
                value: row.strikeRate,
                note: `${String(row.sample.balls)} balls in ${String(row.sample.matches)} matches`,
                small: row.sample.small,
              }))}
              unit="strike rate"
            />
          )}
        </section>
        <section className="insight-card">
          <h3>{bowling ? "Economy by phase" : "By phase"}</h3>
          <Bars
            rows={
              bowling
                ? bowler.phases.map((row) => ({
                    key: row.key,
                    value: row.economy,
                    note: `${String(row.sample.balls)} balls`,
                    small: row.sample.small,
                  }))
                : batter.phases.map((row) => ({
                    key: row.key,
                    value: row.strikeRate,
                    note: `${String(row.runs)} runs from ${String(row.sample.balls)} balls`,
                    small: row.sample.small,
                  }))
            }
            unit={bowling ? "an over" : "strike rate"}
          />
          {bowling ? <p>Lower economy is better.</p> : null}
        </section>
        <section data-testid="insights-conditions" className="insight-card">
          <h3>{bowling ? "Against left and right" : "By conditions"}</h3>
          {bowling ? (
            <>
              <Bars
                rows={bowler.hands.map((row) => ({
                  key: row.key,
                  value: row.economy,
                  note: `${String(row.wickets)} wickets · ${String(row.sample.balls)} balls`,
                  small: row.sample.small,
                }))}
                unit="an over"
              />
              <Bars
                rows={bowler.ballTypes.map((row) => ({
                  key: row.key,
                  value: row.economy,
                  note: `${String(row.sample.balls)} balls`,
                  small: row.sample.small,
                }))}
                unit="an over"
              />
            </>
          ) : (
            <div className="insight-conditions">
              {Object.entries(batter.conditions).map(([group, rows]) => (
                <div key={group}>
                  <h4>{label(group)}</h4>
                  {rows.length ? (
                    rows.map((row) => (
                      <p key={row.key ?? "unknown"}>
                        <strong>{label(row.key)}</strong>
                        <span>
                          {metric(row.average)} average · {metric(row.strikeRate)} strike rate
                        </span>
                        <small>
                          {row.sample.balls} balls{row.sample.small ? " · Small sample" : ""}
                        </small>
                      </p>
                    ))
                  ) : (
                    <p>No recorded data.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        {!bowling ? (
          <section className="insight-card insight-wide">
            <h3>Recorded dismissals and positions</h3>
            <Bars
              rows={batter.dismissals.map((row) => ({
                key: row.kind,
                value: row.count,
                note: "Recorded dismissals",
              }))}
              unit="dismissals"
            />
            <FieldSvg label="Recorded dismissal positions">
              {batter.dismissalPositions.map((row) => {
                const [x, y] = (row.key ?? "").split("|").map(Number);
                if (
                  x === undefined ||
                  y === undefined ||
                  !Number.isFinite(x) ||
                  !Number.isFinite(y)
                )
                  return null;
                return (
                  <circle
                    key={row.key}
                    cx={100 + x * 88}
                    cy={100 - y * 88}
                    r={5}
                    className="insight-dismissal"
                  >
                    <title>{`${String(row.deliveries)} dismissals at this recorded position`}</title>
                  </circle>
                );
              })}
            </FieldSvg>
          </section>
        ) : null}
      </div>
      <p className="insight-footnote">
        Verified and confirmed completed matches only. Ordinary innings; super overs excluded.
        Slices below 60 balls are marked small sample. An unavailable average is shown as —.
      </p>
    </div>
  );
}
