export interface RaidFormat {
  key: string;
  label: string;
  halves: 2;
  halfMinutes: number;
  playersOnMat: 7;
  superTackleAtOrBelow: 3;
  bonusLineMinDefenders: 6;
  allOutPoints: 2;
  doOrDieAfterEmpty: 2;
  raidSeconds: 30;
}
const rules = {
  halves: 2,
  playersOnMat: 7,
  superTackleAtOrBelow: 3,
  bonusLineMinDefenders: 6,
  allOutPoints: 2,
  doOrDieAfterEmpty: 2,
  raidSeconds: 30,
} as const;
export const RAID_FORMAT_PRESETS = {
  pkl_40: { ...rules, key: "pkl_40", label: "2 × 20 minutes", halfMinutes: 20 },
  kabaddi_30: { ...rules, key: "kabaddi_30", label: "2 × 15 minutes", halfMinutes: 15 },
} as const satisfies Record<string, RaidFormat>;
export function raidFormat(value: unknown): RaidFormat | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const preset = Object.values(RAID_FORMAT_PRESETS).find((entry) => entry.key === raw["key"]);
  return preset &&
    Object.keys(raw).length === Object.keys(preset).length &&
    Object.entries(preset).every(([key, expected]) => raw[key] === expected)
    ? { ...preset }
    : null;
}
