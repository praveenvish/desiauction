import Link from "next/link";
import type { TodayBoard as Board } from "../../../../../server/scoring/today";
import type { TodayRow } from "../../../../../server/scoring/today-model";
function matchLabel(number: string) {
  return /^match\s/i.test(number) ? number : `Match ${number}`;
}
function Action({ row }: { row: TodayRow }) {
  return (
    <Link
      data-testid={`today-action-${row.number}`}
      className="today-action"
      href={row.action.href}
    >
      {row.action.label}
      <span className="today-sr"> · {matchLabel(row.number)}</span>
    </Link>
  );
}
function Progress({ row }: { row: TodayRow }) {
  if (!row.progress)
    return <small>{row.quota === "unlimited" ? "No over limit" : "Quota unavailable"}</small>;
  return (
    <>
      <progress
        value={Math.min(row.progress.value, row.progress.max)}
        max={row.progress.max}
        aria-label={`${matchLabel(row.number)} innings progress`}
      />
      <small>
        {row.progress.value} of {row.progress.max} legal balls
      </small>
    </>
  );
}
export function TodayBoard({ view }: { view: Board }) {
  return (
    <div className="dash-stack today-board">
      <header className="today-summary">
        <div>
          <small>{view.date}</small>
          <h2 className="today-counts">
            {view.matches.length} {view.matches.length === 1 ? "match" : "matches"} ·{" "}
            {view.groundCount} {view.groundCount === 1 ? "ground" : "grounds"}
          </h2>
          <small>{view.liveCount} live</small>
        </div>
        <Link className="today-action" href={`/seasons/${encodeURIComponent(view.slug)}/fixtures`}>
          Full schedule
        </Link>
      </header>
      <section aria-labelledby="today-problems">
        <h2 id="today-problems">Needs you</h2>
        {view.problems.length ? (
          <div className="today-problems">
            {view.problems.map((row) => (
              <article className="today-problem" key={row.id}>
                <small>
                  {matchLabel(row.number)}
                  {row.date !== view.date ? ` · ${row.date ?? "Date not set"}` : ""}
                </small>
                <h3>
                  {row.home} vs {row.away}
                </h3>
                <ul>
                  {row.reasons.map((reason) => (
                    <li data-testid={`today-problem-${reason.kind}`} key={reason.kind}>
                      {reason.text}
                    </li>
                  ))}
                </ul>
                <Action row={row} />
              </article>
            ))}
          </div>
        ) : (
          <p>No match-day problems need attention.</p>
        )}
      </section>
      <section aria-labelledby="today-matches">
        <h2 id="today-matches">Today’s matches</h2>
        {view.matches.length ? (
          <div
            className="today-scroll"
            role="region"
            aria-label="Today’s matches, scroll horizontally for all columns"
            tabIndex={0}
          >
            <table>
              <caption className="today-sr">Today’s match-day schedule and current scoring</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Match</th>
                  <th scope="col">Conditions and scorer</th>
                  <th scope="col">Now</th>
                  <th scope="col">Next step</th>
                </tr>
              </thead>
              <tbody>
                {view.matches.map((row) => (
                  <tr data-testid={`today-row-${row.number}`} key={row.id}>
                    <td>
                      <strong>{row.kickoffAt?.slice(11, 16) ?? "Time not set"}</strong>
                      <small>{row.ground ?? "Ground not set"}</small>
                    </td>
                    <th scope="row">
                      <small>{matchLabel(row.number)}</small>
                      {row.home}
                      <small>vs {row.away}</small>
                    </th>
                    <td>
                      {row.conditions}
                      <small>
                        {row.scorerName
                          ? `Scorer: ${row.scorerName}`
                          : row.scorerAssigned
                            ? "Scorer assigned"
                            : "No scorer assigned"}
                      </small>
                    </td>
                    <td>
                      <strong>
                        {row.score ?? (row.status === "completed" ? "Completed" : "Not started")}
                      </strong>
                      <small>{row.phase?.replaceAll("_", " ")}</small>
                      {row.score ? <Progress row={row} /> : null}
                      <small>{row.situation}</small>
                    </td>
                    <td>
                      <Action row={row} />
                      {["cricket", "box_cricket"].includes(view.sport) && (
                        <Link href={`/seasons/${encodeURIComponent(view.slug)}/brief/${row.id}`}>
                          Captain’s brief
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No published matches scheduled today.</p>
        )}
      </section>
      <section className="today-figures" aria-labelledby="today-viewers">
        <h2 id="today-viewers">Match viewer peaks</h2>
        <strong>{view.viewerPeaks.toLocaleString("en-IN")}</strong>
        <p>Sum of peak viewer counts for today’s matches; not unique or currently watching.</p>
      </section>
    </div>
  );
}
