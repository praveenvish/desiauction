export interface TimedFormat {
  key: string;
  label: string;
  periods: number;
  periodMinutes: number;
  clock: "running" | "stopped";
  shootout: boolean;
  scoreUnits: number[];
}
export const TIMED_FORMAT_PRESETS = {
  football_90: {
    key: "football_90",
    label: "2 × 45 minutes",
    periods: 2,
    periodMinutes: 45,
    clock: "running",
    shootout: false,
    scoreUnits: [1],
  },
  football_90_shootout: {
    key: "football_90_shootout",
    label: "2 × 45 minutes · shootout",
    periods: 2,
    periodMinutes: 45,
    clock: "running",
    shootout: true,
    scoreUnits: [1],
  },
  hockey_60: {
    key: "hockey_60",
    label: "4 × 15 minutes",
    periods: 4,
    periodMinutes: 15,
    clock: "stopped",
    shootout: false,
    scoreUnits: [1],
  },
  hockey_60_shootout: {
    key: "hockey_60_shootout",
    label: "4 × 15 minutes · shootout",
    periods: 4,
    periodMinutes: 15,
    clock: "stopped",
    shootout: true,
    scoreUnits: [1],
  },
  basketball_40: {
    key: "basketball_40",
    label: "4 × 10 minutes · regulation only",
    periods: 4,
    periodMinutes: 10,
    clock: "stopped",
    shootout: false,
    scoreUnits: [1, 2, 3],
  },
} satisfies Record<string, TimedFormat>;
export function timedFormat(value: unknown): TimedFormat | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const preset = Object.values(TIMED_FORMAT_PRESETS).find((entry) => entry.key === raw["key"]);
  return preset &&
    Object.keys(raw).length === Object.keys(preset).length &&
    Object.entries(preset).every(([key, expected]) =>
      key === "scoreUnits"
        ? Array.isArray(raw[key]) &&
          raw[key].length === preset.scoreUnits.length &&
          raw[key].every((unit, index) => unit === preset.scoreUnits[index])
        : raw[key] === expected,
    )
    ? { ...preset, scoreUnits: [...preset.scoreUnits] }
    : null;
}
export function timedSport(format: TimedFormat): "football" | "hockey" | "basketball" {
  return format.key.startsWith("football_")
    ? "football"
    : format.key.startsWith("hockey_")
      ? "hockey"
      : "basketball";
}
