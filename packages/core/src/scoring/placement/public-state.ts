import type { NameBook } from "../types";
import { placementTable, type PlacementState } from "./state";
export type { PlacementPanel } from "./panel-types";
import type { PublicPlacementState } from "../types";
export type { PublicPlacementState } from "../types";
export function placementPublicState(state: PlacementState, names: NameBook): PublicPlacementState {
  const table = placementTable(state),
    winners = table.filter((row) => row.placement === 1);
  const result =
    state.terminal === "void"
      ? "Match void"
      : state.terminal === "abandoned"
        ? "Match abandoned"
        : state.finished || state.phase === "result_reached"
          ? `${winners.map((row) => names.teams[row.teamId]?.name ?? "Squad").join(" and ")} ${winners.length === 1 ? "won" : "tied"} the lobby`
          : null;
  return {
    family: "placement",
    panel: { v: 1, round: state.rounds.length, rounds: state.format?.rounds ?? 0, rows: table },
    v: 1,
    seq: state.lastSeq,
    phase: state.phase,
    updatedAt: state.lastEventAt ?? "",
    lastBallAt: null,
    teams: state.teamIds.map((id) => names.teams[id] ?? { id, name: "Squad", initials: "?" }),
    tossLine: null,
    conditionsLine: "",
    innings: [],
    situation: "",
    batters: [],
    bowler: null,
    thisOver: [],
    recent: [],
    batterShots: {},
    ballsLeft: null,
    requiredRate: null,
    currentRate: "",
    result,
    trust: "self_scored",
  };
}
