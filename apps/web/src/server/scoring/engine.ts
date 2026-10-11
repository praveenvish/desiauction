import { sportPack } from "@desiauction/core";
import { engineFor } from "@desiauction/core/scoring";

/** Unknown catalogue keys must never inherit the label-only cricket fallback. */
export function scoringEngine(sport: string) {
  const pack = sportPack(sport);
  const family = pack?.scoring?.family;
  return family === "placement"
    ? engineFor("placement")
    : family === "delivery"
      ? engineFor("delivery")
      : family === "rally"
        ? engineFor("rally")
        : family === "raid"
          ? engineFor("raid")
          : family === "timed"
            ? engineFor("timed")
            : null;
}
export function unsupportedScoringMessage(sport: string): string {
  return `Live scoring for ${sportPack(sport)?.label ?? sport} is coming soon. Enter the result after the match.`;
}
