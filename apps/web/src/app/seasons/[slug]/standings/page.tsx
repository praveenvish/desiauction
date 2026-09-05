import { Badge, Card, EmptyState, PageIntro } from "@desiauction/ui";
import { notFound } from "next/navigation";

import { standingsView } from "../../../../server/competition/fixture-actions";
import "../../seasons.css";

export const metadata = { title: "Table · DesiAuction" };

/**
 * THE LEAGUE TABLE.
 *
 * Derived on every read from the recorded results — there is no standings table
 * in the database, because a stored one drifts from the results beneath it the
 * first time somebody amends a scorecard, and then two screens disagree about
 * who qualifies.
 *
 * Visible to anybody who can see the competition. A league table only officers
 * can read is not a league table.
 */
export default async function StandingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await standingsView(slug);
  if (view === null) {
    notFound();
  }
  const { standings } = view;
  const complete = standings.recorded >= standings.playable;

  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <PageIntro />
        <Card>
          <div className="competition-title-row">
            <h2>Table</h2>
            {/* Said whenever it is not the whole story. A table built from three
                of twenty results is not wrong, but presenting it without saying
                so invites somebody to read it as the season's standing. */}
            <Badge tone={complete ? "success" : "warning"} data-testid="standings-completeness">
              {standings.recorded} of {standings.playable} results in
            </Badge>
          </div>
          {standings.rows.length === 0 ? (
            <EmptyState
              title="No teams yet"
              description="The table appears once this season has teams."
            />
          ) : (
            <div className="table-scroll">
              <table className="reg-table" data-testid="standings-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Team</th>
                    <th scope="col" className="admin-num">
                      P
                    </th>
                    <th scope="col" className="admin-num">
                      W
                    </th>
                    <th scope="col" className="admin-num">
                      L
                    </th>
                    <th scope="col" className="admin-num">
                      T
                    </th>
                    <th scope="col" className="admin-num">
                      NR
                    </th>
                    <th scope="col" className="admin-num">
                      Pts
                    </th>
                    {/* The sport's own tiebreaks, in its own order: NRR for
                        cricket, GD then GF for football. */}
                    {standings.sport.standings.tiebreakers.map((tiebreaker) => (
                      <th key={tiebreaker.key} scope="col" className="admin-num">
                        {tiebreaker.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {standings.rows.map((row, index) => (
                    <tr
                      key={row.teamId}
                      className="reg-row"
                      data-testid={`standings-${row.teamId}`}
                    >
                      <td data-label="Position" className="admin-num">
                        {index + 1}
                      </td>
                      <td data-label="Team">
                        <span className="registration-name">{row.teamName}</span>
                        {/* The numbers behind the tiebreak, so it is checkable
                            rather than trusted. The pack decides how they read —
                            "180/20.0" in cricket, "12" in football. */}
                        <span className="competitions-hint">
                          {standings.sport.standings.summariseSide(row.scored)} for ·{" "}
                          {standings.sport.standings.summariseSide(row.conceded)} against
                        </span>
                      </td>
                      <td data-label="Played" className="admin-num">
                        {row.played}
                      </td>
                      <td data-label="Won" className="admin-num">
                        {row.won}
                      </td>
                      <td data-label="Lost" className="admin-num">
                        {row.lost}
                      </td>
                      <td data-label="Tied" className="admin-num">
                        {row.tied}
                      </td>
                      <td data-label="No result" className="admin-num">
                        {row.noResult}
                      </td>
                      <td data-label="Points" className="admin-num">
                        <strong>{row.points}</strong>
                      </td>
                      {standings.sport.standings.tiebreakers.map((tiebreaker) => {
                        const value = row.tiebreakers[tiebreaker.key] ?? null;
                        return (
                          <td
                            key={tiebreaker.key}
                            data-label={tiebreaker.label}
                            className="admin-num"
                          >
                            {/* An em dash, not 0.00. Zero is a real net run rate
                                and a real goal difference — a team exactly level
                                has one — so printing it for "has not played"
                                would put a new team level with one that
                                genuinely broke even. */}
                            {value === null ? "—" : value.toFixed(tiebreaker.precision)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="competitions-hint">
            Two points for a win, one for a tie or a no result. Net run rate is runs per over scored
            minus runs per over conceded, counted in balls — an abandoned match counts as nothing at
            all, a no result counts as played.
          </p>
        </Card>
      </div>
    </main>
  );
}
