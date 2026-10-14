import { useState } from "react";
import { Button, Dialog, PlayerPortrait } from "@desiauction/ui";
import type { NextAction, NameBook } from "@desiauction/core/scoring";
import { bowlerRows } from "./sheet-model";
export function BowlerSheet({
  action,
  names,
  onPick,
  matchupHint,
}: {
  action: Extract<NextAction, { kind: "pick_bowler" }>;
  names: NameBook;
  onPick: (id: string) => void;
  matchupHint?: string | null;
}) {
  const [selected, setSelected] = useState(action.suggestedId);
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        Choose who bowls next
      </Button>
      <Dialog
        data-testid="bowler-sheet"
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Who bowls the next over?"
        footer={
          <Button
            data-testid="bowler-confirm"
            disabled={!selected}
            onClick={() => {
              if (selected) onPick(selected);
            }}
          >
            {selected ? (names.players[selected]?.name ?? "Player") : "Choose a player"} to bowl
          </Button>
        }
      >
        {matchupHint ? <p className="scoring-matchup-hint">{matchupHint}</p> : null}
        <div className="scoring-sheet-rows scoring-selection-rows">
          {bowlerRows(action).map((row) => (
            <Button
              key={row.id}
              data-testid={`bowler-${row.id}`}
              aria-disabled={Boolean(row.reason)}
              data-reason={action.blocked.find((entry) => entry.id === row.id)?.reason ?? ""}
              disabled={Boolean(row.reason)}
              variant="ghost"
              aria-pressed={row.id === selected}
              onClick={() => {
                setSelected(row.id);
              }}
            >
              <PlayerPortrait
                name={names.players[row.id]?.name ?? "Player"}
                src={names.players[row.id]?.photoUrl}
                seed={row.id}
                decorative
                className="pad-portrait"
              />
              <span>
                {names.players[row.id]?.name ?? "Player"}
                <small>
                  {row.reason ?? (row.id === action.suggestedId ? "Suggested" : "Available")}
                </small>
              </span>
            </Button>
          ))}
        </div>
      </Dialog>
    </>
  );
}
