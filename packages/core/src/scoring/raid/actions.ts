export type RaidAction =
  | { kind: "start_half"; half: 1 | 2 }
  | { kind: "end_half" }
  | { kind: "record_raid"; side: "home" | "away"; doOrDie: boolean }
  | { kind: "start_clock" };
