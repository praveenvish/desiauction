import { IconTrophy, IconUsers, Pill, SectionCard } from "@desiauction/ui";

import { ScheduleViews } from "../sibling-link";
import { notFound } from "next/navigation";

import { standingsView } from "../../../../server/competition/fixture-actions";
import { TeamCrest } from "../_tabs/team-crest";
import { standingsFootnote } from "./footnote";
import "../../seasons.css";
import "../_tabs/tabs.css";
import "./standings.css";

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
  const teamOf = new Map(view.teams.map((team) => [team.id, team]));
  const lobby = standings.sport.fixtureShape === "lobby";
  /*
   * Before a ball is bowled every team is level, so ranking them 1, 2, 3 (by
   * the alphabet, in effect) and printing "0/0.0 for · 0/0.0 against" under
   * each one reported a standing nobody holds. Both wait for the first result.
   */
  const anyPlayed = standings.recorded > 0;

  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        {/* The table shares the Schedule tab with the fixtures it is derived
            from (RN-1), so this is how an organizer reaches them. */}
        <div className="st-head">
          <ScheduleViews slug={slug} active="table" />
        </div>
        <SectionCard
          icon={<IconTrophy />}
          concept="results"
          title={lobby ? "Points table" : "League table"}
          description={
            standings.playable === 0
              ? "No match has been played yet — the table fills as results come in."
              : `Built from ${String(standings.recorded)} recorded result${standings.recorded === 1 ? "" : "s"}, on every read.`
          }
          action={
            /* Said whenever it is not the whole story. A table built from three
               of twenty results is not wrong, but presenting it without saying
               so invites somebody to read it as the season's standing. */
            <Pill
              tone={standings.playable === 0 ? "neutral" : complete ? "green" : "amber"}
              dot
              testId="standings-completeness"
            >
              {standings.recorded} of {standings.playable} results in
            </Pill>
          }
          flush={standings.rows.length > 0}
        >
          {standings.rows.length === 0 ? (
            <div className="st-empty">
              <span className="st-empty-glyph" aria-hidden>
                <IconUsers size={26} />
              </span>
              <h3>No teams yet</h3>
              <p>The table appears once this season has teams.</p>
            </div>
          ) : (
            <>
              <div className="st-table-wrap">
                <table className="st-table sd-table" data-testid="standings-table">
                  <caption>
                    The table, best first: played, won, lost, tied, no result, points
                    {standings.sport.standings.tiebreakers.length > 0 ? ", then the tiebreaks" : ""}
                    .
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="st-num sd-pos">
                        #
                      </th>
                      <th scope="col">Team</th>
                      <th scope="col" className="st-num">
                        <abbr title="Played">P</abbr>
                      </th>
                      <th scope="col" className="st-num">
                        <abbr title="Won">W</abbr>
                      </th>
                      <th scope="col" className="st-num">
                        <abbr title="Lost">L</abbr>
                      </th>
                      <th scope="col" className="st-num sd-minor">
                        <abbr title="Tied">T</abbr>
                      </th>
                      <th scope="col" className="st-num sd-minor">
                        <abbr title="No result">NR</abbr>
                      </th>
                      <th scope="col" className="st-num sd-pts">
                        Pts
                      </th>
                      {/* The sport's own tiebreaks, in its own order: NRR for
                        cricket, GD then GF for football. */}
                      {standings.sport.standings.tiebreakers.map((tiebreaker, tieIndex) => (
                        <th
                          key={tiebreaker.key}
                          scope="col"
                          className={tieIndex === 0 ? "st-num" : "st-num sd-minor"}
                        >
                          {tiebreaker.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {standings.rows.map((row, index) => (
                      <tr
                        key={row.teamId}
                        data-testid={`standings-${row.teamId}`}
                        data-rank={index < 3 && row.played > 0 ? String(index + 1) : undefined}
                      >
                        <td className="st-num sd-pos">
                          <span className="sd-rank">{anyPlayed ? index + 1 : "—"}</span>
                        </td>
                        <td>
                          <span className="st-team">
                            <TeamCrest
                              name={row.teamName}
                              short={teamOf.get(row.teamId)?.shortName ?? null}
                              color={teamOf.get(row.teamId)?.primaryColor ?? null}
                              logoUrl={teamOf.get(row.teamId)?.logoUrl ?? null}
                            />
                            <span className="st-team-text">
                              <span className="st-team-name">{row.teamName}</span>
                              {/* The numbers behind the tiebreak, so it is checkable
                                rather than trusted. The pack decides how they read
                                — "180/20.0" in cricket, "12" in football. */}
                              {row.played > 0 ? (
                                <span className="st-sub">
                                  {standings.sport.standings.summariseSide(row.scored)} for ·{" "}
                                  {standings.sport.standings.summariseSide(row.conceded)} against
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </td>
                        <td data-label="Played" className="st-num">
                          {row.played}
                        </td>
                        <td data-label="Won" className="st-num">
                          {row.won}
                        </td>
                        <td data-label="Lost" className="st-num">
                          {row.lost}
                        </td>
                        <td data-label="Tied" className="st-num sd-minor">
                          {row.tied}
                        </td>
                        <td data-label="No result" className="st-num sd-minor">
                          {row.noResult}
                        </td>
                        <td data-label="Points" className="st-num sd-pts">
                          <strong>{row.points}</strong>
                        </td>
                        {standings.sport.standings.tiebreakers.map((tiebreaker, tieIndex) => {
                          const value = row.tiebreakers[tiebreaker.key] ?? null;
                          return (
                            <td
                              key={tiebreaker.key}
                              data-label={tiebreaker.label}
                              className={tieIndex === 0 ? "st-num" : "st-num sd-minor"}
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
              <p className="st-foot-note">{standingsFootnote(standings.sport)}</p>
            </>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
