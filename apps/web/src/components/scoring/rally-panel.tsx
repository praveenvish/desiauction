import type { RallyPanel, PublicLiveState } from "@desiauction/core/scoring";
export function RallyLiveScore({ panel, live }: { panel: RallyPanel; live: PublicLiveState }) {
  return (
    <div data-testid="live-score" data-seq={live.seq} id="live-score" tabIndex={-1}>
      <p className="live-side">
        Rubber {panel.rubberNo ?? 1} · Game {panel.gameNo ?? 1}
      </p>
      <div className="live-score" aria-label="Current points">
        {panel.points.home}–{panel.points.away}
      </div>
      {panel.server && live.phase === "live" ? (
        <p data-testid="live-rally-server">Serving: {live.teams[panel.server].name}</p>
      ) : null}
      {panel.streak && live.phase === "live" ? (
        <p>
          {live.teams[panel.streak.side].name} · {panel.streak.count} rallies in a row
        </p>
      ) : null}
    </div>
  );
}
export function RallyGames({ panel, live }: { panel: RallyPanel; live: PublicLiveState }) {
  return (
    <section className="live-panel" data-testid="live-rally-games">
      <h2>Games</h2>
      <table>
        <caption>
          {live.teams.home.name} vs {live.teams.away.name}
        </caption>
        <thead>
          <tr>
            <th scope="col">Rubber</th>
            <th scope="col">Game</th>
            <th scope="col">{live.teams.home.name}</th>
            <th scope="col">{live.teams.away.name}</th>
          </tr>
        </thead>
        <tbody>
          {panel.rubbers.flatMap((rubber) =>
            rubber.games.map((game) => (
              <tr key={`${String(rubber.no)}-${String(game.no)}`}>
                <th scope="row">{rubber.no}</th>
                <td>{game.no}</td>
                <td>{game.home}</td>
                <td>{game.away}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </section>
  );
}
