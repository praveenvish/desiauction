import { useState } from "react";
import { Button, Dialog } from "@desiauction/ui";
import type { EventPayloads, MatchState } from "@desiauction/core/scoring";
export function ReviseSheet({
  state,
  onClose,
  onSave,
}: {
  state: MatchState;
  onClose: () => void;
  onSave: (payload: EventPayloads["revise"]) => void;
}) {
  const inning = state.currentInnings === null ? undefined : state.innings[state.currentInnings];
  const perOver = state.format?.ballsPerOver ?? 6;
  const [overs, setOvers] = useState((inning?.maxBalls ?? perOver) / perOver),
    [target, setTarget] = useState(inning?.target ? String(inning.target) : ""),
    [method, setMethod] = useState<"manual" | "dls">("manual");
  return (
    <Dialog
      open
      onClose={onClose}
      title="Shorten this innings"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              !inning || !Number.isInteger(overs * perOver) || overs * perOver < inning.legalBalls
            }
            onClick={() => {
              if (inning)
                onSave({
                  inningsNo: inning.no,
                  maxBalls: overs * perOver,
                  method,
                  ...(target ? { targetRuns: Number(target) } : {}),
                });
            }}
          >
            Apply revision
          </Button>
        </>
      }
    >
      <label>
        Overs
        <input
          type="number"
          step="1"
          min={Math.ceil((inning?.legalBalls ?? 0) / perOver)}
          max={state.format?.oversPerInnings ?? undefined}
          value={overs}
          onChange={(event) => {
            setOvers(Number(event.target.value));
          }}
        />
      </label>
      <label>
        Target runs · optional
        <input
          type="number"
          min="1"
          step="1"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
          }}
        />
      </label>
      <label>
        Method
        <select
          value={method}
          onChange={(event) => {
            setMethod(event.target.value as typeof method);
          }}
        >
          <option value="manual">Manual target</option>
          <option value="dls">DLS · entered target</option>
        </select>
      </label>
    </Dialog>
  );
}
