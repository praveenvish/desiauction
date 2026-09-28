import type { CareerSeason } from "../../server/player/career";
import { liveStage, type LiveStage } from "../me/me-model";

/**
 * THE PLAYER'S HOME, put into one decision — which season leads the page and
 * what its hero says. Pure, so every stage of a player's season is a test.
 */

export type HeroKind =
  | "waiting"
  | "waitlisted"
  | "pool"
  | "auction_live"
  /** Sold, and no match played yet — the moment. */
  | "sold"
  /** The season is being played — the next match leads. */
  | "match"
  /** In a squad with nothing scheduled or played yet (a pre-signed player before the fixtures). */
  | "squad";

export interface CurrentSeason {
  readonly season: CareerSeason;
  readonly stage: LiveStage;
}

/** The newest season still live for this player, or null. `seasons` is oldest-first (as the career reads). */
export function currentSeason(
  seasons: readonly CareerSeason[],
  today: string,
): CurrentSeason | null {
  for (const season of [...seasons].reverse()) {
    const stage = liveStage(season, today);
    if (stage !== null) return { season, stage };
  }
  return null;
}

/**
 * What the hero is. The sale is the biggest thing that happens to a player, so
 * it stays the hero until their first match is played; after that the next
 * match is what matters.
 */
export function heroKind(
  current: CurrentSeason,
  facts: { readonly played: number; readonly upcoming: number },
): HeroKind {
  const { stage, season } = current;
  if (stage.kind === "waiting" || stage.kind === "waitlisted") return stage.kind;
  if (stage.kind === "pool" || stage.kind === "auction_live") return stage.kind;
  if (season.auction?.kind === "sold" && facts.played === 0) return "sold";
  if (facts.played > 0 || facts.upcoming > 0) return "match";
  return "squad";
}
