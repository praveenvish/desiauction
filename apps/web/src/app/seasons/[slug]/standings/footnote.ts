import type { SportPack } from "@desiauction/core";

/**
 * THE TABLE'S RULES, SAID IN THE SEASON'S OWN SPORT.
 *
 * The footnote under every duel table read "Two points for a win… Net run
 * rate is…" — cricket's rules, printed under a football table that the pack
 * itself scores three for a win and ranks on goal difference. The numbers in
 * the table were right; the sentence explaining them was a different sport's.
 * It is now built from the same pack values `buildStandings` folds with, so the
 * explanation cannot disagree with the arithmetic above it.
 *
 * Pure, so the sentence for every pack is unit-tested.
 */
const WORDS = ["no", "one", "two", "three", "four", "five"] as const;

function count(n: number): string {
  return WORDS[n] ?? String(n);
}

function points(n: number): string {
  return `${count(n)} point${n === 1 ? "" : "s"}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function standingsFootnote(pack: SportPack): string {
  if (pack.fixtureShape === "lobby") {
    return "Points come from where each squad finished in each lobby, plus the sport's own extras. A lobby counts once every squad in it is placed.";
  }
  const { win, tie, loss, noResult } = pack.standings.points;
  const parts = [`${capitalise(points(win))} for a win`];
  if (tie === noResult) {
    parts.push(`${count(tie)} for a tie or a no result`);
  } else {
    parts.push(`${count(tie)} for a tie`, `${count(noResult)} for a no result`);
  }
  if (loss !== 0) {
    parts.push(`${count(loss)} for a loss`);
  }
  const scoring = `${parts.join(", ")}.`;

  const { tiebreakers } = pack.standings;
  if (tiebreakers.some((tiebreaker) => tiebreaker.key === "net_run_rate")) {
    return `${scoring} Net run rate is runs per over scored minus runs per over conceded, counted in balls — an abandoned match counts as nothing at all, a no result counts as played.`;
  }
  if (tiebreakers.length === 0) {
    return scoring;
  }
  // The labels are the column headings the table prints, in the pack's order.
  const order = tiebreakers.map((tiebreaker) => tiebreaker.label).join(", then ");
  return `${scoring} Teams level on points are separated by ${order}.`;
}
