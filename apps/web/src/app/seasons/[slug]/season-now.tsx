import { IconArrowRight, Pill } from "@desiauction/ui";
import Link from "next/link";

import { formatWallTime } from "../../../lib/format-date";
import type { ScheduleView, StandingsPageView } from "../../../server/competition/fixture-actions";
import { TeamCrest } from "./_tabs/team-crest";
import { wallDay } from "./fixtures/schedule-model";
import { nowRows, resultWords } from "./season-now-model";

/**
 * THE MATCHES AND THE TABLE, on the season's front page (2026-09-27).
 *
 * A season in the middle of its matches had an overview that said nothing
 * about them — the next step band said "Open the schedule" and that was all.
 * Now the two things anyone opening a playing season wants are here: what is
 * on (live, next, the last result) and who is top. Both read what the Schedule
 * and Table tabs read, so they cannot disagree with them.
 */
export function SeasonNow({
  slug,
  schedule,
  standings,
  now,
  mine = [],
}: {
  slug: string;
  /** The viewer's own teams here — their matches and row are marked "You". */
  mine?: readonly string[];
  schedule: ScheduleView | null;
  standings: StandingsPageView | null;
  now: string;
}) {
  // The overview reads the schedule's week (two days back, four ahead); the
  // season's next match can sit beyond it — Sunday's, on a Tuesday — and the
  // card then had no "next" at all behind three results due (census 16).
  const ahead = schedule?.upcoming ?? null;
  const pool =
    schedule === null
      ? []
      : ahead !== null && !schedule.rows.some((row) => row.id === ahead.id)
        ? [...schedule.rows, ahead]
        : schedule.rows;
  const rows =
    schedule === null ? [] : nowRows(pool, now, (id) => schedule.results[id] !== undefined);
  const table = standings?.standings.rows.slice(0, 4) ?? [];
  if (rows.length === 0 && table.length === 0) {
    return null;
  }
  const lobby = schedule?.fixtureShape === "lobby";
  const teamOf = new Map((standings?.teams ?? []).map((team) => [team.id, team]));
  const today = now.slice(0, 10);

  return (
    <div className="ov-now">
      {rows.length > 0 ? (
        <section
          className="ov-now-card"
          aria-labelledby="ov-matches-title"
          data-testid="overview-matches"
        >
          <div className="ov-now-head">
            <h2 id="ov-matches-title">Matches</h2>
            <Link className="ov-card-link" href={`/seasons/${slug}/fixtures`}>
              Full schedule
              <IconArrowRight size={16} />
            </Link>
          </div>
          <ul className="ov-now-list">
            {rows.map(({ fixture, state }) => {
              const kickoff = fixture.kickoffAt;
              const day = kickoff === null ? null : kickoff.slice(0, 10);
              const when =
                state === "live"
                  ? "Now"
                  : kickoff === null || day === null
                    ? "Time to be set"
                    : day === today
                      ? `Today ${formatWallTime(kickoff)}`
                      : // Every other day names its date: "Sun 3:00 pm" sat over
                        // "Sun 27 Sep" and read as the same Sunday (census 16).
                        `${wallDay(day).weekday} ${wallDay(day).date}`;
              // A next match's time rides with its ground on the right.
              const at =
                state === "next" && kickoff !== null && day !== today
                  ? formatWallTime(kickoff)
                  : null;
              const result = schedule?.results[fixture.id];
              const sides =
                fixture.homeTeamId === null ? `Lobby · ${String(fixture.squadCount)} squads` : null;
              return (
                <li
                  key={fixture.id}
                  className="ov-now-row"
                  data-state={state}
                  data-mine={
                    (fixture.homeTeamId !== null && mine.includes(fixture.homeTeamId)) ||
                    (fixture.awayTeamId !== null && mine.includes(fixture.awayTeamId))
                      ? "true"
                      : undefined
                  }
                >
                  <span className="ov-now-when">{when}</span>
                  <Link
                    href={`/seasons/${slug}/fixtures?match=${fixture.id}`}
                    className="ov-now-teams"
                  >
                    {sides ?? (
                      <>
                        {fixture.homeTeamName ?? "TBA"} <span className="ov-now-v">v</span>{" "}
                        {fixture.awayTeamName ?? "TBA"}
                      </>
                    )}
                  </Link>
                  {state === "live" ? (
                    <Pill tone="red" dot>
                      Live
                    </Pill>
                  ) : state === "due" ? (
                    <Pill tone="neutral">Result due</Pill>
                  ) : state === "result" && result !== undefined ? (
                    <span className="ov-now-result">
                      {resultWords(result.outcome, fixture.homeTeamName, fixture.awayTeamName)}
                    </span>
                  ) : at !== null || fixture.groundName !== null ? (
                    <span className="ov-now-ground">
                      {[at, fixture.groundName].filter((part) => part !== null).join(" · ")}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {table.length > 0 ? (
        <section
          className="ov-now-card"
          aria-labelledby="ov-table-title"
          data-testid="overview-table"
        >
          <div className="ov-now-head">
            <h2 id="ov-table-title">Table</h2>
            <Link className="ov-card-link" href={`/seasons/${slug}/standings`}>
              Full table
              <IconArrowRight size={16} />
            </Link>
          </div>
          <table className="ov-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Team</th>
                <th scope="col">
                  <abbr title="Played">P</abbr>
                </th>
                {lobby ? null : (
                  <th scope="col">
                    <abbr title="Won">W</abbr>
                  </th>
                )}
                <th scope="col">
                  <abbr title="Points">Pts</abbr>
                </th>
              </tr>
            </thead>
            <tbody>
              {table.map((row, index) => {
                const team = teamOf.get(row.teamId);
                return (
                  <tr key={row.teamId} data-mine={mine.includes(row.teamId) ? "true" : undefined}>
                    <td>{index + 1}</td>
                    <th scope="row">
                      <span className="ov-table-team">
                        <TeamCrest
                          name={row.teamName}
                          short={team?.shortName ?? null}
                          color={team?.primaryColor ?? null}
                          logoUrl={team?.logoUrl ?? null}
                        />
                        {row.teamName}
                        {mine.includes(row.teamId) ? <span className="ov-now-you">You</span> : null}
                      </span>
                    </th>
                    <td>{row.played}</td>
                    {lobby ? null : <td>{row.won}</td>}
                    <td className="ov-table-pts">{row.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
