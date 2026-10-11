import { RALLY_FORMAT_KEYS } from "./format-keys";
export interface RallyFormat {
  key: string;
  label: string;
  rubbers: 1 | 3 | 5;
  gamesToWin: number;
  pointsToWin: number;
  winBy: number;
  cap: number | null;
  decidingPointsToWin?: number;
  serve: "winner_serves" | "two_each" | "side_out";
  changeServeAtDeuce: 1 | 2;
}
export const RALLY_FORMAT_PRESETS = {
  badminton_bo3: {
    key: RALLY_FORMAT_KEYS.badminton_bo3,
    label: "Best of 3",
    rubbers: 1,
    gamesToWin: 2,
    pointsToWin: 21,
    winBy: 2,
    cap: 30,
    serve: "winner_serves",
    changeServeAtDeuce: 1,
  },
  badminton_tie_5: {
    key: RALLY_FORMAT_KEYS.badminton_tie_5,
    label: "5-rubber tie",
    rubbers: 5,
    gamesToWin: 2,
    pointsToWin: 21,
    winBy: 2,
    cap: 30,
    serve: "winner_serves",
    changeServeAtDeuce: 1,
  },
  tt_bo5: {
    key: RALLY_FORMAT_KEYS.tt_bo5,
    label: "Best of 5",
    rubbers: 1,
    gamesToWin: 3,
    pointsToWin: 11,
    winBy: 2,
    cap: null,
    serve: "two_each",
    changeServeAtDeuce: 1,
  },
  tt_tie_5: {
    key: RALLY_FORMAT_KEYS.tt_tie_5,
    label: "5-rubber tie",
    rubbers: 5,
    gamesToWin: 3,
    pointsToWin: 11,
    winBy: 2,
    cap: null,
    serve: "two_each",
    changeServeAtDeuce: 1,
  },
  pickleball_bo3: {
    key: RALLY_FORMAT_KEYS.pickleball_bo3,
    label: "Best of 3 · side-out",
    rubbers: 1,
    gamesToWin: 2,
    pointsToWin: 11,
    winBy: 2,
    cap: null,
    serve: "side_out",
    changeServeAtDeuce: 1,
  },
  pickleball_rally_bo3: {
    key: RALLY_FORMAT_KEYS.pickleball_rally_bo3,
    label: "Best of 3 · rally",
    rubbers: 1,
    gamesToWin: 2,
    pointsToWin: 11,
    winBy: 2,
    cap: null,
    serve: "winner_serves",
    changeServeAtDeuce: 1,
  },
  volleyball_bo5: {
    key: RALLY_FORMAT_KEYS.volleyball_bo5,
    label: "Best of 5 sets",
    rubbers: 1,
    gamesToWin: 3,
    pointsToWin: 25,
    winBy: 2,
    cap: null,
    decidingPointsToWin: 15,
    serve: "winner_serves",
    changeServeAtDeuce: 1,
  },
} as const satisfies Record<string, RallyFormat>;
export function rallyFormat(value: unknown): RallyFormat | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const preset = Object.values(RALLY_FORMAT_PRESETS).find((format) => format.key === raw["key"]);
  if (!preset || Object.keys(raw).length !== Object.keys(preset).length) return null;
  return Object.entries(preset).every(([key, expected]) => raw[key] === expected)
    ? { ...preset }
    : null;
}
