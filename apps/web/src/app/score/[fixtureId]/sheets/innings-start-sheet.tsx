import { useRef, useState } from "react";
import { Button, Dialog } from "@desiauction/ui";
import type { MatchState, NameBook } from "@desiauction/core/scoring";
import { inningsOpening, inningsStartPayload, type OpeningPlayers } from "./innings-start-model";

export function InningsStartSheet({
  state,
  names,
  onConfirm,
}: {
  state: MatchState;
  names: NameBook;
  onConfirm: (players: OpeningPlayers) => boolean;
}) {
  const opening = inningsOpening(state);
  const [open, setOpen] = useState(true);
  const [strikerId, setStriker] = useState(opening?.batters[0] ?? "");
  const [nonStrikerId, setNonStriker] = useState(opening?.batters[1] ?? "");
  const [bowlerId, setBowler] = useState(opening?.bowlers[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);
  if (!opening) return null;
  const players = { strikerId, nonStrikerId: opening.loneBatter ? null : nonStrikerId, bowlerId };
  let valid = true;
  try {
    inningsStartPayload(state, opening.identity, players);
  } catch {
    valid = false;
  }
  function confirm() {
    if (submitted.current) return;
    submitted.current = true;
    try {
      if (!onConfirm(players))
        throw new Error("The innings could not start. Check the scoring message and retry.");
    } catch (failure) {
      submitted.current = false;
      setError(
        failure instanceof Error
          ? failure.message
          : "The innings changed. Choose the players again.",
      );
    }
  }
  return (
    <>
      <Button
        size="touch"
        onClick={() => {
          setOpen(true);
        }}
        data-testid="innings-start-open"
      >
        Start next innings
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Start next innings"
        footer={
          <Button
            size="touch"
            disabled={!valid}
            onClick={confirm}
            data-testid="innings-start-confirm"
          >
            Start innings
          </Button>
        }
      >
        <p>
          {names.teams[opening.identity.battingTeamId]?.name ?? "Batting team"} · innings{" "}
          {opening.identity.inningsNo}
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="scoring-sheet-rows">
          <label>
            Striker
            <select
              value={strikerId}
              onChange={(event) => {
                setStriker(event.target.value);
              }}
            >
              {opening.batters.map((id) => (
                <option key={id} value={id}>
                  {names.players[id]?.name ?? "Player"}
                </option>
              ))}
            </select>
          </label>
          {!opening.loneBatter && (
            <label>
              Non-striker
              <select
                value={nonStrikerId}
                onChange={(event) => {
                  setNonStriker(event.target.value);
                }}
              >
                {opening.batters.map((id) => (
                  <option key={id} value={id}>
                    {names.players[id]?.name ?? "Player"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Opening bowler
            <select
              value={bowlerId}
              onChange={(event) => {
                setBowler(event.target.value);
              }}
            >
              {opening.bowlers.map((id) => (
                <option key={id} value={id}>
                  {names.players[id]?.name ?? "Player"}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Dialog>
    </>
  );
}
