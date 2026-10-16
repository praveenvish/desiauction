import type { PublicLiveState } from "@desiauction/core/scoring";
export function state(seq = 1, updatedAt = new Date().toISOString()): PublicLiveState {
  return {
    v: 1,
    family: "delivery",
    panel: { v: 1 },
    seq,
    phase: "live",
    updatedAt,
    lastBallAt: updatedAt,
    teams: {
      home: { id: "home", name: "Home", initials: "H" },
      away: { id: "away", name: "Away", initials: "A" },
    },
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
    currentRate: "0",
    result: null,
    trust: "self_scored",
  };
}
