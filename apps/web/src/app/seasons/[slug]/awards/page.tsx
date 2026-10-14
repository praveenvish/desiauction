import Link from "next/link";
import { PlayerPortrait } from "@desiauction/ui";
import { notFound } from "next/navigation";
import {
  seasonAwardsView,
  raidSeasonAwardsView,
  computeSeasonAwardsAction,
} from "../../../../server/competition/fixture-actions";
import { leaderboardOrder } from "../../../../server/insights/leaderboard";
import "./awards.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Season awards", robots: { index: false, follow: false } };
const tabs = ["MVP", "Runs", "Wickets", "SR", "Economy", "Sixes"] as const;
const kinds = [
  ["season_mvp", "Season MVP"],
  ["best_batter", "Best batter"],
  ["best_bowler", "Best bowler"],
  ["best_fielder", "Best fielder"],
  ["best_keeper", "Best keeper"],
  ["emerging", "Emerging player"],
  ["scorer_of_season", "Scorer of the season"],
] as const;
const pointRows = [
  ["Run off bat", "1", "1", "1"],
  ["Four / six bonus", "+1 / +2", "+1 / +2", "+1 / +2"],
  ["Highest batting milestone", "30: +4, 50: +8, 100: +16", "25: +4, 50: +10", "20: +4, 30: +8"],
  ["Pace bonus cap / minimum balls", "±10 / 10", "±8 / 6", "±6 / 5"],
  ["Bowler-credited wicket", "20", "20", "15"],
  ["Bowled, LBW or hit wicket bonus", "+4", "+4", "+4"],
  ["Top three or dismissed at 20+ runs", "+4", "+4", "+3"],
  ["Highest wicket haul", "3: +6, 4: +10, 5: +16", "2: +4, 3: +8", "2: +4, 3: +8"],
  ["Dot ball / maiden", "+0.5 / +8", "+1 / +12", "+1 / +12"],
  ["Economy bonus cap / minimum balls", "±10 / 12", "±8 / 6", "±6 / 6"],
  ["Catch / stumping / direct run-out", "+8 / +10 / +10", "+8 / +10 / +10", "+8 / +10 / +10"],
  ["Assisted run-out, up to two fielders", "+5 each", "+5 each", "+5 each"],
  ["Duck, positions 1–7, at least one ball", "−2", "−2", "0"],
] as const;
export default async function AwardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; ball?: string; light?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const raidView = await raidSeasonAwardsView(slug);
  if (raidView) return <RaidAwards view={raidView} slug={slug} />;
  const ballType = ["leather", "tennis", "tape", "rubber"].includes(query.ball ?? "")
    ? query.ball
    : undefined;
  const timeOfDay = ["day", "day_night", "night"].includes(query.light ?? "")
    ? query.light
    : undefined;
  const filter = { ...(ballType ? { ballType } : {}), ...(timeOfDay ? { timeOfDay } : {}) };
  const view = await seasonAwardsView(slug, filter);
  if (!view) notFound();
  const tab = tabs.find((value) => value === query.tab) ?? "MVP";
  const number = (value: number | null) => (value === null ? "Unavailable" : value.toFixed(1));
  const rows = view.players
    .map((player) => {
      const metric = tab === "SR" ? player.strikeRate : tab === "Economy" ? player.economy : null;
      const value =
        tab === "MVP"
          ? player.points
          : tab === "Runs"
            ? player.runs
            : tab === "Wickets"
              ? player.wickets
              : tab === "Sixes"
                ? (view.sixes[player.registrationId] ?? 0)
                : (metric?.value ?? null);
      return {
        player,
        metric,
        value,
        qualified: metric?.qualified ?? (tab !== "MVP" || player.mvpEligible),
      };
    })
    .sort((a, b) => leaderboardOrder(a.player, b.player, tab, view.sixes));
  async function compute() {
    "use server";
    const result = await computeSeasonAwardsAction(slug);
    if (!result.ok) throw new Error(result.error);
  }
  return (
    <main className="season-awards">
      <p>Completed verified and confirmed matches. Super overs are excluded.</p>
      <p>Whole-season award picks</p>
      <section className="season-awards-cards" aria-label="Season award picks">
        {kinds.map(([kind, label]) => {
          const selected = view.selected.find(
            (row) => row.kind === kind && row.source === "organizer",
          );
          const pick = view.picks[kind];
          const registrationId = selected
            ? selected.winnerRegistrationId
            : pick && "registrationId" in pick
              ? pick.registrationId
              : null;
          const personId = selected
            ? selected.winnerPersonId
            : pick && "personId" in pick
              ? pick.personId
              : null;
          const winner = registrationId
            ? (view.names[registrationId] ?? "Player")
            : personId
              ? (view.scorerNames[personId] ?? "Scorer")
              : "No pick yet";
          const player = view.awardPlayers.find((row) => row.registrationId === registrationId);
          const scorer = view.scorers.find((row) => row.personId === personId);
          return (
            <article
              className={`season-award-card${kind === "season_mvp" ? " season-award-featured" : ""}`}
              key={kind}
            >
              <h2>{label}</h2>
              <div className="season-award-person">
                <PlayerPortrait
                  name={winner}
                  seed={registrationId ?? personId ?? kind}
                  decorative
                />
                <div>
                  <strong>{winner}</strong>
                  {registrationId && view.teamNames[registrationId] && (
                    <p>{view.teamNames[registrationId]}</p>
                  )}
                </div>
              </div>
              {player && (
                <p className="season-award-stats">
                  {kind === "season_mvp"
                    ? `${player.points.toFixed(1)} points in ${String(player.matches)} matches · ${String(player.runs)} runs · ${String(player.wickets)} wickets`
                    : kind === "best_batter"
                      ? `${String(player.runs)} runs · Strike rate ${number(player.strikeRate.value)}`
                      : kind === "best_bowler"
                        ? `${String(player.wickets)} wickets · Economy ${number(player.economy.value)}`
                        : kind === "best_fielder"
                          ? `${String(player.fieldingPoints)} fielding points · ${String(player.directRunOuts)} direct run-outs`
                          : kind === "best_keeper"
                            ? `${String(player.keeperDismissals)} dismissals · ${String(player.keeperByes)} byes`
                            : `${player.points.toFixed(1)} points in ${String(player.matches)} matches`}
                </p>
              )}
              {scorer && (
                <p>{scorer.completedVerifiedMatches} verified or confirmed matches scored</p>
              )}
              {kind === "emerging" && !pick && !selected && (
                <p>Emerging eligibility has not been configured.</p>
              )}
              <p>
                {selected?.source === "organizer"
                  ? "Organizer pick"
                  : "Computed from eligible matches"}
              </p>
              {selected?.source === "organizer" && selected.reason && <p>{selected.reason}</p>}
              {selected && (
                <p>
                  System pick:{" "}
                  {selected.computedRegistrationId
                    ? (view.names[selected.computedRegistrationId] ?? "Player")
                    : selected.computedPersonId
                      ? (view.scorerNames[selected.computedPersonId] ?? "Scorer")
                      : "No pick yet"}
                </p>
              )}
            </article>
          );
        })}
      </section>
      {view.canManage && (
        <form action={compute}>
          <button type="submit">Update computed awards</button>
        </form>
      )}
      <section aria-label="Season leaderboards">
        <form method="get" className="season-awards-filters">
          <fieldset>
            <legend>Whole-match conditions</legend>
            <input type="hidden" name="tab" value={tab} />
            <label htmlFor="awards-ball">Ball type</label>
            <select id="awards-ball" name="ball" defaultValue={ballType ?? ""}>
              <option value="">All ball types</option>
              {["leather", "tennis", "tape", "rubber"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <label htmlFor="awards-light">Light</label>
            <select id="awards-light" name="light" defaultValue={timeOfDay ?? ""}>
              <option value="">All light conditions</option>
              <option value="day">Day</option>
              <option value="day_night">Day–night</option>
              <option value="night">Night</option>
            </select>
            <button type="submit">Apply conditions</button>
          </fieldset>
        </form>
        <p>
          Includes matches played entirely under the selected conditions; mixed or unknown matches
          are excluded.
        </p>
        <p>
          {view.matchCount} selected matches. Qualifications below apply to this filtered
          leaderboard.
        </p>
        <nav className="season-awards-tabs" aria-label="Leaderboard">
          {tabs.map((value) => (
            <Link
              key={value}
              href={`?${new URLSearchParams({ tab: value, ...(ballType ? { ball: ballType } : {}), ...(timeOfDay ? { light: timeOfDay } : {}) }).toString()}`}
              aria-current={tab === value ? "page" : undefined}
            >
              {value}
            </Link>
          ))}
        </nav>
        <div
          className="season-awards-table"
          tabIndex={0}
          role="region"
          aria-label="Leaderboard table"
        >
          <table>
            <caption>{tab} leaderboard</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Matches</th>
                <th scope="col">{tab}</th>
                <th scope="col">Per match</th>
                {tab === "Runs" && (
                  <>
                    <th scope="col">Innings</th>
                    <th scope="col">Average</th>
                    <th scope="col">Strike rate</th>
                  </>
                )}
                {tab === "Wickets" && (
                  <>
                    <th scope="col">Balls</th>
                    <th scope="col">Average</th>
                    <th scope="col">Economy</th>
                  </>
                )}
                <th scope="col">Qualification</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ player, metric, value, qualified }) => (
                <tr
                  key={player.registrationId}
                  className={qualified ? undefined : "season-award-unqualified"}
                >
                  <th scope="row">
                    <span>{view.names[player.registrationId] ?? "Player"}</span>
                    <small>{view.teamNames[player.registrationId]}</small>
                  </th>
                  <td>{player.matches}</td>
                  <td>{number(value)}</td>
                  <td>{number(player.perMatch)}</td>
                  {tab === "Runs" && (
                    <>
                      <td>{player.battingInnings}</td>
                      <td>{number(player.battingAverage.value)}</td>
                      <td>{number(player.strikeRate.value)}</td>
                    </>
                  )}
                  {tab === "Wickets" && (
                    <>
                      <td>{player.bowlingBalls}</td>
                      <td>{number(player.bowlingAverage.value)}</td>
                      <td>{number(player.economy.value)}</td>
                    </>
                  )}
                  <td>
                    {qualified
                      ? "Qualified"
                      : metric
                        ? `${String(metric.remaining)} more balls needed`
                        : "Needs half of the team’s completed matches"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p>No eligible scored matches yet.</p>}
      </section>
      <details>
        <summary>How MVP points work</summary>
        <div
          className="season-awards-table"
          tabIndex={0}
          role="region"
          aria-label="MVP points table"
        >
          <table>
            <caption>Cricket MVP points</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">T20 / ODI</th>
                <th scope="col">T10 / six-over / tennis</th>
                <th scope="col">Box</th>
              </tr>
            </thead>
            <tbody>
              {pointRows.map(([label, ...values]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {values.map((value, index) => (
                    <td key={index}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Pace: half of (runs minus balls faced × match runs per ball). Economy: half of (legal
          balls bowled × match runs per ball minus runs conceded). The match rate uses both ordinary
          innings; super overs are excluded.
        </p>
        <p>
          Runs earn one point each, with extra points for boundaries, wickets and fielding. Only the
          highest batting milestone counts. Pace and economy bonuses compare with the match rate,
          require minimum balls and are capped by format.
        </p>
        <p>
          Season MVP requires playing in at least half of the team’s completed eligible matches. All
          eligible matches count. Equal points use registration order as the final tiebreak.
        </p>
      </details>
    </main>
  );
}

function RaidAwards({
  view,
  slug,
}: {
  view: NonNullable<Awaited<ReturnType<typeof raidSeasonAwardsView>>>;
  slug: string;
}) {
  async function compute() {
    "use server";
    const result = await computeSeasonAwardsAction(slug);
    if (!result.ok) throw new Error(result.error);
  }
  return (
    <main className="season-awards">
      <h1>Kabaddi season awards</h1>
      <p>{view.matchCount} completed verified and confirmed matches.</p>
      <section className="season-awards-cards" aria-label="Season award picks">
        {(
          [
            ["season_mvp", "Season MVP"],
            ["best_raider", "Best raider"],
            ["best_defender", "Best defender"],
          ] as const
        ).map(([kind, label]) => {
          const override = view.selected.find(
            (row) => row.kind === kind && row.source === "organizer",
          );
          const pick = view.picks[kind];
          const winner = override ? override.winnerRegistrationId : pick?.registrationId;
          return (
            <article className="season-award-card" key={kind}>
              <h2>{label}</h2>
              <strong>{winner ? (view.names[winner] ?? "Player") : "No pick yet"}</strong>
              {winner && <p>{view.teamNames[winner]}</p>}
              <p>{override ? "Organizer pick" : "Computed from eligible matches"}</p>
              {override && (
                <>
                  <p>{override.reason}</p>
                  <p>
                    System pick:{" "}
                    {override.computedRegistrationId
                      ? (view.names[override.computedRegistrationId] ?? "Player")
                      : "No pick yet"}
                  </p>
                </>
              )}
            </article>
          );
        })}
      </section>
      {view.canManage && (
        <form action={compute}>
          <button type="submit">Update computed awards</button>
        </form>
      )}
      <div
        className="season-awards-table"
        tabIndex={0}
        role="region"
        aria-label="Kabaddi leaderboard"
      >
        <table>
          <caption>Kabaddi season leaderboard</caption>
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Matches</th>
              <th scope="col">MVP points</th>
              <th scope="col">Raid points</th>
              <th scope="col">Tackle points</th>
              <th scope="col">MVP qualification</th>
            </tr>
          </thead>
          <tbody>
            {[...view.players]
              .sort(
                (a, b) => b.points - a.points || a.registrationId.localeCompare(b.registrationId),
              )
              .map((row) => (
                <tr key={row.registrationId}>
                  <th scope="row">
                    {view.names[row.registrationId] ?? "Player"}
                    <small>{view.teamNames[row.registrationId]}</small>
                  </th>
                  <td>{row.matches}</td>
                  <td>{row.points.toFixed(1)}</td>
                  <td>{row.raidPoints}</td>
                  <td>{row.tacklePoints}</td>
                  <td>
                    {row.mvpEligible ? "Qualified" : "Needs half of the team’s eligible matches"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!view.players.length && <p>No eligible scored matches yet.</p>}
      <details>
        <summary>How MVP points work</summary>
        <p>
          Each raid or tackle point earns one point. Super tackle +1, super raid +3, Super 10 +5,
          High 5 +3, do-or-die success +1, tackled −0.5. Technical and all-out points belong to the
          team.
        </p>
        <p>
          Season MVP requires participation in at least half of the team’s eligible completed
          matches. Best raider and defender require positive raid and tackle points respectively.
          Equal totals use registration order. All matches count unless the season has a durable
          best-N MVP setting.
        </p>
      </details>
    </main>
  );
}
