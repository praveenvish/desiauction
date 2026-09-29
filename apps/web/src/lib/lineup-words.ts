/**
 * An owner's next match, in one phrase about their side's lineup (census 12):
 * whether it is picked, and whether the organizer has told the players.
 * "Lineup", never "XI" — twelve sports, and a kabaddi side is seven.
 */
export function lineupWords(lineup: { saved: number; announced: boolean }): string {
  if (lineup.announced) return "lineup announced";
  if (lineup.saved > 0) {
    return `lineup picked · ${String(lineup.saved)} ${lineup.saved === 1 ? "player" : "players"}, not announced yet`;
  }
  return "lineup not set yet";
}
