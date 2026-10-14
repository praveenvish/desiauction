export interface FormatSpec {
  key: string;
  label: string;
  oversPerInnings: number | null;
  ballsPerOver: number;
  playersPerSide: number;
  wicketsPerInnings: number;
  lastManStands: boolean;
  maxOversPerBowler: number | null;
  noConsecutiveOvers: boolean;
  wideRuns: number;
  noBallRuns: number;
  wideReBowl: boolean;
  noBallReBowl: boolean;
  freeHitOnNoBall: boolean;
  retireAt: number | null;
  lbw: boolean;
  superOver: boolean;
  powerplayOvers: number;
  deathFromOver: number;
  innings: 1 | 2;
}

const BASE: FormatSpec = {
  key: "t20",
  label: "T20",
  oversPerInnings: 20,
  ballsPerOver: 6,
  playersPerSide: 11,
  wicketsPerInnings: 10,
  lastManStands: false,
  maxOversPerBowler: 4,
  noConsecutiveOvers: true,
  wideRuns: 1,
  noBallRuns: 1,
  wideReBowl: true,
  noBallReBowl: true,
  freeHitOnNoBall: true,
  retireAt: null,
  lbw: true,
  superOver: true,
  powerplayOvers: 6,
  deathFromOver: 16,
  innings: 1,
};

export const FORMAT_PRESETS = {
  t20: { ...BASE },
  t10: {
    ...BASE,
    key: "t10",
    label: "T10",
    oversPerInnings: 10,
    maxOversPerBowler: 2,
    powerplayOvers: 3,
    deathFromOver: 8,
  },
  odi: {
    ...BASE,
    key: "odi",
    label: "One day",
    oversPerInnings: 50,
    maxOversPerBowler: 10,
    powerplayOvers: 10,
    deathFromOver: 41,
  },
  six_over: {
    ...BASE,
    key: "six_over",
    label: "Six overs",
    oversPerInnings: 6,
    playersPerSide: 8,
    wicketsPerInnings: 7,
    maxOversPerBowler: 1,
    powerplayOvers: 2,
    deathFromOver: 5,
  },
  box_6: {
    ...BASE,
    key: "box_6",
    label: "Box six",
    oversPerInnings: 6,
    playersPerSide: 6,
    wicketsPerInnings: 6,
    lastManStands: true,
    maxOversPerBowler: 1,
    lbw: false,
    powerplayOvers: 1,
    deathFromOver: 5,
  },
  tennis_gully: {
    ...BASE,
    key: "tennis_gully",
    label: "Tennis gully",
    oversPerInnings: 8,
    playersPerSide: 8,
    wicketsPerInnings: 7,
    maxOversPerBowler: 2,
    retireAt: 25,
    lbw: false,
    freeHitOnNoBall: false,
    powerplayOvers: 2,
    deathFromOver: 7,
  },
} satisfies Record<string, FormatSpec>;

export function formatByKey(key: string): FormatSpec | undefined {
  return Object.values(FORMAT_PRESETS).find((format) => format.key === key);
}
