export type TimedAction =
  | { kind: "start_period"; period: number }
  | { kind: "end_period"; period: number }
  | { kind: "record_score"; scoreUnits: number[] }
  | { kind: "shootout_attempt"; teamId: string; eligiblePlayerIds: string[] };
