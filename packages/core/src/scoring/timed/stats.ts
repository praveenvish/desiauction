export interface TimedStats {
  role: string | null;
  goals: number;
  points: number;
  assists: number;
  ownGoals: number;
  penaltiesScored: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  greenCards: number;
  shootoutAttempts: number;
  shootoutConversions: number;
  activeIntervals: { fromGameMs: number; toGameMs: number | null; period: number }[];
}
