import { useState } from "react";
import { Button, Dialog } from "@desiauction/ui";
import {
  replayMatch,
  type BallPayload,
  type BallSummary,
  type MatchState,
  type NameBook,
  type WicketKind,
} from "@desiauction/core/scoring";
import { legalWickets } from "./wicket-sheet";
export function beforeDelivery(state: MatchState, ball: BallSummary) {
  const roots = new Map<string, number>();
  for (const event of state.eventHistory)
    roots.set(
      event.eventId,
      event.targetEventId ? (roots.get(event.targetEventId) ?? event.seq) : event.seq,
    );
  return replayMatch(
    state.eventHistory.filter((event) => (roots.get(event.eventId) ?? event.seq) < ball.seq),
  );
}
export function deliveryPayload(ball: BallSummary): BallPayload {
  return {
    bowlerId: ball.bowlerId,
    strikerId: ball.strikerId,
    nonStrikerId: ball.nonStrikerId,
    runsBat: ball.runsBat,
    extras: { ...ball.extras },
    ...(ball.boundary ? { boundary: ball.boundary } : {}),
    ...(ball.shot ? { shot: ball.shot } : {}),
    ...(ball.wicket ? { wicket: ball.wicket } : {}),
  };
}
export function EditBallSheet({
  ball,
  state,
  names,
  onClose,
  onSave,
  onVoid,
}: {
  ball: BallSummary;
  state: MatchState;
  names: NameBook;
  onClose: () => void;
  onSave: (payload: BallPayload) => void;
  onVoid: () => void;
}) {
  const [payload, setPayload] = useState(() => deliveryPayload(ball));
  const [modifier, setModifier] = useState<"wide" | "noBall" | "bye" | "legBye" | null>(
    ball.extras.wides
      ? "wide"
      : ball.extras.noBall
        ? "noBall"
        : ball.extras.byes
          ? "bye"
          : ball.extras.legByes
            ? "legBye"
            : null,
  );
  const [more, setMore] = useState(false),
    [runs, setRuns] = useState(7);
  const prior = beforeDelivery(state, ball);
  function choose(value: number, mode = modifier) {
    const extras: BallPayload["extras"] = {};
    if (mode === "wide") extras.wides = (state.format?.wideRuns ?? 1) + value;
    if (mode === "noBall") extras.noBall = true;
    if (mode === "bye" && value > 0) extras.byes = value;
    if (mode === "legBye" && value > 0) extras.legByes = value;
    const batRuns = mode && mode !== "noBall" ? 0 : value;
    setPayload((previous) => ({
      bowlerId: previous.bowlerId,
      strikerId: previous.strikerId,
      nonStrikerId: previous.nonStrikerId,
      runsBat: batRuns,
      extras,
      ...(batRuns === 4 || batRuns === 6 ? { boundary: batRuns } : {}),
      ...(previous.shot ? { shot: previous.shot } : {}),
      ...(previous.wicket
        ? {
            wicket: {
              ...previous.wicket,
              ...(previous.wicket.runsCompleted !== undefined ? { runsCompleted: value } : {}),
            },
          }
        : {}),
    }));
    setMore(false);
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit delivery ${ball.over}`}
      footer={
        <>
          <Button variant="danger" onClick={onVoid}>
            Void delivery
          </Button>
          <Button
            onClick={() => {
              onSave(payload);
            }}
          >
            Save correction
          </Button>
        </>
      }
    >
      <p>
        {names.players[payload.strikerId]?.name ?? "Player"} · {payload.runsBat} off bat
      </p>
      <div className="scoring-sheet-rows">
        {(["wide", "noBall", "bye", "legBye"] as const).map((value) => (
          <Button
            key={value}
            variant="ghost"
            aria-pressed={modifier === value}
            onClick={() => {
              const next = modifier === value ? null : value;
              setModifier(next);
              choose(payload.runsBat, next);
            }}
          >
            {value === "noBall"
              ? "No ball"
              : value === "legBye"
                ? "Leg bye"
                : value === "bye"
                  ? "Bye"
                  : "Wide"}
          </Button>
        ))}
      </div>
      <div className="pad-run-grid">
        {[0, 1, 2, 3, 4, 6, 5].map((value) => (
          <button
            type="button"
            key={value}
            onClick={() => {
              choose(value);
            }}
          >
            {value === 0 ? "•" : value}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setMore(true);
          }}
        >
          7+
        </button>
      </div>
      {more && (
        <label>
          Runs
          <input
            type="number"
            min="7"
            max="10"
            value={runs}
            onChange={(event) => {
              setRuns(Math.min(10, Math.max(7, Math.trunc(Number(event.target.value)))));
            }}
          />
          <Button
            onClick={() => {
              choose(runs);
            }}
          >
            Use {runs} runs
          </Button>
        </label>
      )}
      <label>
        Dismissal
        <select
          value={payload.wicket?.kind ?? ""}
          onChange={(event) => {
            const kind = event.target.value as WicketKind | "";
            setPayload((previous) => {
              const rest = { ...previous };
              delete rest.wicket;
              return {
                ...rest,
                ...(kind
                  ? {
                      wicket: {
                        kind,
                        playerOutId: previous.wicket?.playerOutId ?? previous.strikerId,
                        fielderIds:
                          kind === "caught_and_bowled"
                            ? [previous.bowlerId]
                            : (previous.wicket?.fielderIds ?? []),
                      },
                    }
                  : {}),
              };
            });
          }}
        >
          <option value="">No wicket</option>
          {legalWickets(prior, payload, payload.wicket?.playerOutId).map((kind) => (
            <option key={kind} value={kind}>
              {kind.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      {payload.wicket && (
        <label>
          Batter out
          <select
            value={payload.wicket.playerOutId}
            onChange={(event) => {
              const id = event.target.value;
              setPayload((previous) => ({
                ...previous,
                ...(previous.wicket ? { wicket: { ...previous.wicket, playerOutId: id } } : {}),
              }));
            }}
          >
            {[payload.strikerId, payload.nonStrikerId]
              .filter((id): id is string => Boolean(id))
              .map((id) => (
                <option key={id} value={id}>
                  {names.players[id]?.name ?? "Player"}
                </option>
              ))}
          </select>
        </label>
      )}
      {payload.wicket && (
        <label>
          Fielder
          <select
            value={payload.wicket.fielderIds[0] ?? ""}
            onChange={(event) => {
              const id = event.target.value;
              setPayload((previous) => ({
                ...previous,
                ...(previous.wicket
                  ? { wicket: { ...previous.wicket, fielderIds: id ? [id] : [] } }
                  : {}),
              }));
            }}
          >
            <option value="">Unknown</option>
            {prior.lineups[prior.innings.at(-1)?.bowlingTeamId ?? ""]?.battingOrder.map((id) => (
              <option key={id} value={id}>
                {names.players[id]?.name ?? "Player"}
              </option>
            ))}
          </select>
        </label>
      )}
    </Dialog>
  );
}
