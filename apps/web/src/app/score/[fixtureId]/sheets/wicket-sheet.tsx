import { useState } from "react";
import { Button, Dialog } from "@desiauction/ui";
import {
  replayMatch,
  nextActions,
  type BallPayload,
  type MatchEvent,
  type MatchState,
  type NameBook,
  type WicketKind,
} from "@desiauction/core/scoring";
import type { LocalEntry } from "../use-match";
import { Field } from "./field";
const kinds: { kind: WicketKind; label: string; more?: boolean }[] = [
  { kind: "bowled", label: "Bowled" },
  { kind: "caught", label: "Caught" },
  { kind: "lbw", label: "LBW" },
  { kind: "stumped", label: "Stumped" },
  { kind: "run_out", label: "Run out" },
  { kind: "hit_wicket", label: "Hit wicket" },
  { kind: "caught_and_bowled", label: "Caught and bowled" },
  { kind: "hit_twice", label: "Hit twice", more: true },
  { kind: "obstructing", label: "Obstructing", more: true },
  { kind: "timed_out", label: "Timed out", more: true },
];
export function wicketEntries(
  preview: (entries: readonly LocalEntry[]) => MatchState,
  entry: LocalEntry,
  replacement: string | null,
): LocalEntry[] {
  const after = preview([entry]);
  const action = nextActions(after).find((action) => action.kind === "pick_new_batter");
  return action?.kind === "pick_new_batter" && replacement
    ? [entry, { type: "new_batter", payload: { registrationId: replacement, end: action.end } }]
    : [entry];
}
export function legalWickets(
  state: MatchState,
  payload: BallPayload,
  playerOutId = payload.strikerId,
): WicketKind[] {
  return kinds
    .filter(({ kind }) => {
      try {
        const event = {
          eventId: "wicket-preview",
          type: "ball",
          payload: {
            ...payload,
            wicket: {
              kind,
              playerOutId,
              fielderIds: kind === "caught_and_bowled" ? [payload.bowlerId] : [],
            },
          },
          seq: state.lastSeq + 1,
          v: 1,
          attempt: state.attempt,
          targetEventId: null,
          actorPersonId: "preview",
          clientSeq: 1,
          clientRecordedAt: new Date().toISOString(),
        } as MatchEvent;
        replayMatch([...state.eventHistory, event]);
        return true;
      } catch {
        return false;
      }
    })
    .map((row) => row.kind);
}
export function WicketSheet({
  state,
  payload,
  names,
  preview,
  onConfirm,
  onClose,
}: {
  state: MatchState;
  payload: BallPayload;
  names: NameBook;
  preview: (entries: readonly LocalEntry[]) => MatchState;
  onConfirm: (entries: readonly LocalEntry[]) => void;
  onClose: () => void;
}) {
  const inning = state.currentInnings === null ? undefined : state.innings[state.currentInnings];
  const fielders = inning ? (state.lineups[inning.bowlingTeamId]?.battingOrder ?? []) : [];
  const candidates = inning
    ? (state.lineups[inning.battingTeamId]?.battingOrder.filter(
        (id) =>
          id !== inning.strikerId &&
          id !== inning.nonStrikerId &&
          !inning.outIds.includes(id) &&
          !inning.retiredHurt.includes(id) &&
          !inning.absentBatterIds.includes(id),
      ) ?? [])
    : [];
  const [outId, setOutId] = useState(payload.strikerId);
  const allowed = legalWickets(state, payload, outId);
  const [kind, setKind] = useState<WicketKind>(allowed[0] ?? "run_out");
  const [fielder, setFielder] = useState<string>("");
  const [replacement, setReplacement] = useState(candidates[0] ?? "");
  const [where, setWhere] = useState<{ x: number; y: number } | null>(null);
  const [more, setMore] = useState(false);
  const [retire, setRetire] = useState<"hurt" | "out" | null>(null);
  function confirm() {
    const entry: LocalEntry = retire
      ? { type: "retire", payload: { registrationId: outId, kind: retire } }
      : {
          type: "ball",
          payload: {
            ...payload,
            wicket: {
              kind,
              playerOutId: outId,
              fielderIds:
                kind === "caught_and_bowled" ? [payload.bowlerId] : fielder ? [fielder] : [],
              ...(where ? { where } : {}),
            },
          },
        };
    try {
      onConfirm(wicketEntries(preview, entry, replacement || null));
    } catch {
      onConfirm([entry]);
    }
  }
  return (
    <Dialog
      data-testid="wicket-sheet"
      open
      onClose={onClose}
      title="Wicket"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button data-testid="wicket-confirm" onClick={confirm}>
            Confirm {retire ? "retirement" : "wicket"}
          </Button>
        </>
      }
    >
      <label>
        Who is out?
        <select
          value={outId}
          onChange={(event) => {
            const id = event.target.value;
            setOutId(id);
            const choices = legalWickets(state, payload, id);
            if (!choices.includes(kind)) setKind(choices[0] ?? "run_out");
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
      <div className="scoring-sheet-rows">
        {kinds
          .filter((row) => allowed.includes(row.kind) && (!row.more || more))
          .map((row) => (
            <Button
              key={row.kind}
              data-testid={`wicket-kind-${row.kind}`}
              variant="ghost"
              aria-pressed={!retire && kind === row.kind}
              onClick={() => {
                setKind(row.kind);
                setRetire(null);
              }}
            >
              {row.label}
            </Button>
          ))}
      </div>
      <Button
        variant="ghost"
        onClick={() => {
          setMore(!more);
        }}
      >
        More…
      </Button>
      {more && (
        <div className="scoring-sheet-rows">
          {(["hurt", "out"] as const).map((value) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={retire === value}
              onClick={() => {
                setRetire(value);
              }}
            >
              Retire {value}
            </Button>
          ))}
        </div>
      )}
      {!retire && (
        <>
          <p>Fielder · optional</p>
          <div className="scoring-sheet-rows">
            {fielders.map((id) => (
              <Button
                key={id}
                data-testid={`wicket-fielder-${id}`}
                variant="ghost"
                aria-pressed={fielder === id}
                onClick={() => {
                  setFielder(fielder === id ? "" : id);
                }}
              >
                {names.players[id]?.name ?? "Player"}
              </Button>
            ))}
          </div>
          <p>Tap the field to add a pin · optional</p>
          <Field onPin={setWhere} pin={where} />
        </>
      )}
      {candidates.length > 0 && (
        <label>
          Next player
          <select
            data-testid="wicket-next-batter"
            value={replacement}
            onChange={(event) => {
              setReplacement(event.target.value);
            }}
          >
            {candidates.map((id) => (
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
