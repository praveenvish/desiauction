import { useState } from "react";
import { Button, Dialog, PlayerPortrait } from "@desiauction/ui";
import type { NameBook } from "@desiauction/core/scoring";
export function BatterSheet({
  ids,
  suggestedId,
  names,
  onPick,
}: {
  ids: string[];
  suggestedId: string | null;
  names: NameBook;
  onPick: (id: string) => void;
}) {
  const [selected, setSelected] = useState(suggestedId);
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        Choose the next player
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Who comes in next?"
        footer={
          <Button
            disabled={!selected}
            onClick={() => {
              if (selected) onPick(selected);
            }}
          >
            Confirm {selected ? (names.players[selected]?.name ?? "Player") : "next player"}
          </Button>
        }
      >
        <div className="scoring-sheet-rows scoring-selection-rows">
          {[...ids]
            .sort((a, b) => Number(b === suggestedId) - Number(a === suggestedId))
            .map((id) => (
              <Button
                key={id}
                variant="ghost"
                aria-pressed={id === selected}
                onClick={() => {
                  setSelected(id);
                }}
              >
                <PlayerPortrait
                  name={names.players[id]?.name ?? "Player"}
                  src={names.players[id]?.photoUrl}
                  seed={id}
                  decorative
                  className="pad-portrait"
                />
                <span>
                  {names.players[id]?.name ?? "Player"}
                  {id === suggestedId && <small>Suggested</small>}
                </span>
              </Button>
            ))}
        </div>
      </Dialog>
    </>
  );
}
