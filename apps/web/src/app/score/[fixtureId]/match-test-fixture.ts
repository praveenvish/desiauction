import {
  FORMAT_PRESETS,
  type MatchEvent,
  type EventType,
  type PayloadOf,
} from "@desiauction/core/scoring";
export function startedHistory(): MatchEvent[] {
  function event<T extends EventType>(type: T, payload: PayloadOf<T>, seq: number): MatchEvent<T> {
    return {
      eventId: `initial-${String(seq)}`,
      type,
      payload,
      seq,
      attempt: 1,
      v: 1,
      targetEventId: null,
      actorPersonId: "scorer",
      clientSeq: seq,
      clientRecordedAt: "2026-10-09T00:00:00Z",
    };
  }
  return [
    event(
      "match_started",
      { format: FORMAT_PRESETS.t20, conditions: {}, homeTeamId: "home", awayTeamId: "away" },
      1,
    ),
    ...["home", "away"].map((teamId, i) =>
      event(
        "lineup_confirmed",
        {
          teamId,
          battingOrder: [`${teamId}-1`, `${teamId}-2`, `${teamId}-3`],
          captainId: `${teamId}-1`,
          keeperId: `${teamId}-2`,
          substitutes: [],
        },
        i + 2,
      ),
    ),
    event("toss", { winnerTeamId: "home", decision: "bat" }, 4),
    event(
      "innings_started",
      {
        inningsNo: 1,
        battingTeamId: "home",
        strikerId: "home-1",
        nonStrikerId: "home-2",
        bowlerId: "away-1",
      },
      5,
    ),
  ];
}
