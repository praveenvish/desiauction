import type { PlacementPanel, PublicScoringState } from "@desiauction/core/scoring";
export function PlacementLiveScore({
  panel,
  live,
}: {
  panel: PlacementPanel;
  live: PublicScoringState;
}) {
  const teams = Array.isArray(live.teams) ? live.teams : [];
  return (
    <div
      id="live-score"
      tabIndex={-1}
      data-testid="live-score"
      data-seq={live.seq}
      aria-label="Lobby standings"
    >
      <p>
        Round {panel.round} of {panel.rounds}
      </p>
      <table className="lobby-table">
        <caption>Lobby table</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Squad</th>
            <th scope="col">Kills</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {panel.rows.map((row) => (
            <tr key={row.teamId}>
              <td>{row.placement}</td>
              <th scope="row">{teams.find((team) => team.id === row.teamId)?.name ?? "Squad"}</th>
              <td>{row.kills}</td>
              <td>{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
