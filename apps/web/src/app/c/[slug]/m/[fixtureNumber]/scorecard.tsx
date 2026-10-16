import type { PublicLiveState, PublicScorecard } from "@desiauction/core/scoring";
import { useState } from "react";
import { dismissalText, scoringRate } from "./scorecard-model";
export function Scorecard({
  live,
  card,
}: {
  live: PublicLiveState | null;
  card: PublicScorecard | undefined;
}) {
  const [selected, setSelected] = useState(-1);
  if (!live || !card || card.seq !== live.seq)
    return (
      <section className="live-panel">
        <h2>Scorecard</h2>
        <p>Detailed scorecard unavailable</p>
      </section>
    );
  return (
    <>
      <div role="tablist" aria-label="Scorecard innings" className="live-innings-tabs">
        {card.innings.map((innings, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            id={`innings-tab-${String(index)}`}
            aria-controls={`innings-panel-${String(index)}`}
            aria-selected={index === (selected < 0 ? card.innings.length - 1 : selected)}
            tabIndex={index === (selected < 0 ? card.innings.length - 1 : selected) ? 0 : -1}
            onClick={() => {
              setSelected(index);
            }}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % card.innings.length;
              else if (event.key === "ArrowLeft")
                next = (index + card.innings.length - 1) % card.innings.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = card.innings.length - 1;
              else return;
              event.preventDefault();
              setSelected(next);
              document.getElementById(`innings-tab-${String(next)}`)?.focus();
            }}
          >
            {Object.values(live.teams).find((team) => team.id === innings.battingTeamId)?.name}{" "}
            {live.innings[index]?.runs}/{live.innings[index]?.wickets}
            {innings.superOver ? " · Super over" : ""}
          </button>
        ))}
      </div>
      {card.innings.map((innings, index) => {
        const total = live.innings[index];
        const team = Object.values(live.teams).find((side) => side.id === innings.battingTeamId);
        return (
          <section
            className="live-panel"
            key={index}
            role="tabpanel"
            id={`innings-panel-${String(index)}`}
            aria-labelledby={`innings-tab-${String(index)}`}
            hidden={index !== (selected < 0 ? card.innings.length - 1 : selected)}
          >
            <div className="live-innings">
              <h2>
                {team?.name}
                {innings.superOver ? " · Super over" : ""}
              </h2>
              <strong>
                {total?.runs}/{total?.wickets} ({total?.overs})
              </strong>
            </div>
            <div
              className="live-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={`${team?.name ?? "Team"} batting scorecard`}
            >
              <table>
                <caption>Batting</caption>
                <thead>
                  <tr>
                    <th scope="col">Batter</th>
                    <th scope="col">R</th>
                    <th scope="col">B</th>
                    <th scope="col">4s</th>
                    <th scope="col">6s</th>
                    <th scope="col">SR</th>
                  </tr>
                </thead>
                <tbody>
                  {innings.batting.map((line) => (
                    <tr key={line.id}>
                      <th scope="row">
                        {line.name}
                        {line.notOut ? " *" : ""}
                        <small>{dismissalText(line)}</small>
                      </th>
                      <td>{line.runs}</td>
                      <td>{line.balls}</td>
                      <td>{line.fours}</td>
                      <td>{line.sixes}</td>
                      <td>{scoringRate(line.runs, line.balls, 100, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Extras {Object.values(innings.extras).reduce((a, b) => a + b, 0)} · Wd{" "}
              {innings.extras.wides} · Nb {innings.extras.noBalls} · B {innings.extras.byes} · Lb{" "}
              {innings.extras.legByes} · Pen {innings.extras.penalty}
            </p>
            <div
              className="live-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={`${team?.name ?? "Team"} bowling scorecard`}
            >
              <table>
                <caption>Bowling</caption>
                <thead>
                  <tr>
                    <th scope="col">Bowler</th>
                    <th scope="col">O</th>
                    <th scope="col">M</th>
                    <th scope="col">R</th>
                    <th scope="col">W</th>
                    <th scope="col">Wd</th>
                    <th scope="col">Nb</th>
                    <th scope="col">ECON</th>
                  </tr>
                </thead>
                <tbody>
                  {innings.bowling.map((line) => (
                    <tr key={line.id}>
                      <th scope="row">{line.name}</th>
                      <td>{line.overs}</td>
                      <td>{line.maidens}</td>
                      <td>{line.runs}</td>
                      <td>{line.wickets}</td>
                      <td>{line.wides}</td>
                      <td>{line.noBalls}</td>
                      <td>{scoringRate(line.runs, line.legalBalls, card.ballsPerOver, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <section className="live-panel">
        <h2>Match details</h2>
        <p>{live.tossLine}</p>
        <p>{live.conditionsLine}</p>
      </section>
    </>
  );
}
