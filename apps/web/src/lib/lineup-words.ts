/**
 * An owner's next match, in one phrase about their side's lineup (census 12):
 * whether it is picked, and whether the organizer has told the players.
 * "Lineup", never "XI" — twelve sports, and a kabaddi side is seven.
 */
export function lineupWords(lineup: { saved: number; announced: boolean }): string {
  // The organizer's lists say "Lineups not set" (both sides); an owner's is
  // one side, said the same way (census 15: "lineup not set yet").
  if (lineup.announced) return "lineup announced";
  if (lineup.saved > 0) {
    return `lineup picked · ${String(lineup.saved)} ${lineup.saved === 1 ? "player" : "players"}, not announced`;
  }
  return "lineup not set";
}
