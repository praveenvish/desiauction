import type { Conditions } from "./conditions";

export interface SeasonScoringRules {
  formatKey?: string;
  ball?: Conditions["ball"];
  allOutUsesQuota: boolean;
  excludeNoResultFromNrr: boolean;
  editWindowHours: number;
  publicDelaySeconds: number;
  shotMap: "every" | "boundaries" | "off";
  superOverTie: "another" | "boundary_count";
  replayReplacesAbandoned: boolean;
}

export const NEW_SEASON_SCORING_RULES: SeasonScoringRules = {
  allOutUsesQuota: true,
  excludeNoResultFromNrr: true,
  editWindowHours: 24,
  publicDelaySeconds: 60,
  shotMap: "every",
  superOverTie: "another",
  replayReplacesAbandoned: true,
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function parseSeasonScoringRules(raw: unknown): SeasonScoringRules {
  const value = object(raw);
  const rules: SeasonScoringRules = {
    ...NEW_SEASON_SCORING_RULES,
    allOutUsesQuota: value.allOutUsesQuota === true,
    excludeNoResultFromNrr: value.excludeNoResultFromNrr === true,
    editWindowHours: nonNegative(value.editWindowHours, 24),
    publicDelaySeconds: nonNegative(value.publicDelaySeconds, 60),
    shotMap: value.shotMap === "boundaries" || value.shotMap === "off" ? value.shotMap : "every",
    superOverTie: value.superOverTie === "boundary_count" ? "boundary_count" : "another",
    replayReplacesAbandoned:
      typeof value.replayReplacesAbandoned === "boolean" ? value.replayReplacesAbandoned : true,
  };
  if (typeof value.formatKey === "string" && value.formatKey.length > 0)
    rules.formatKey = value.formatKey;
  const ball = object(value.ball);
  if (
    ball.type === "leather" ||
    ball.type === "tennis" ||
    ball.type === "tape" ||
    ball.type === "rubber"
  ) {
    rules.ball = { type: ball.type };
    if (
      ball.type === "leather" &&
      (ball.colour === "red" || ball.colour === "white" || ball.colour === "pink")
    )
      rules.ball.colour = ball.colour;
  }
  return rules;
}
