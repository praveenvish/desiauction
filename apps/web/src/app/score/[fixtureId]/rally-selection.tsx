"use client";
import { Button } from "@desiauction/ui";
import type { RallyEventPayloads } from "@desiauction/core/scoring";
import type { SetupTeam } from "./setup/setup-model";
export type RubberProposal = RallyEventPayloads["rubber_started"];
export function RubberSelection({
  teams,
  value,
  onChange,
}: {
  teams: readonly SetupTeam[];
  value: RubberProposal;
  onChange: (value: RubberProposal) => void;
}) {
  return (
    <fieldset className="score-condition-group">
      <legend>Rubber {value.rubberNo} players</legend>
      {teams.map((team, index) => {
        const key = index === 0 ? "homePlayers" : "awayPlayers";
        return (
          <fieldset key={team.id}>
            <legend>{team.name}</legend>
            <div className="score-tiles">
              {team.players.map((player) => (
                <Button
                  key={player.id}
                  variant="secondary"
                  size="touch"
                  aria-pressed={value[key].includes(player.id)}
                  data-testid={`rally-player-${String(value.rubberNo)}-${player.id}`}
                  onClick={() => {
                    onChange({
                      ...value,
                      [key]: value[key].includes(player.id)
                        ? value[key].filter((id) => id !== player.id)
                        : [...value[key], player.id],
                    });
                  }}
                >
                  {player.name}
                </Button>
              ))}
            </div>
          </fieldset>
        );
      })}
      <fieldset>
        <legend>First server</legend>
        <div className="score-tiles">
          {teams.map((team, index) => (
            <Button
              key={team.id}
              variant="secondary"
              size="touch"
              aria-pressed={value.firstServer === (index === 0 ? "home" : "away")}
              onClick={() => {
                onChange({ ...value, firstServer: index === 0 ? "home" : "away" });
              }}
            >
              {team.name}
            </Button>
          ))}
        </div>
      </fieldset>
    </fieldset>
  );
}
