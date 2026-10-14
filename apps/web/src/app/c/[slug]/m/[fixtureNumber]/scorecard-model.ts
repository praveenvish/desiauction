import type { PublicScorecard } from "@desiauction/core/scoring";
type Batter = PublicScorecard["innings"][number]["batting"][number];
export function scoringRate(
  runs: number,
  balls: number,
  multiplier: number,
  digits: number,
): string {
  return balls > 0 && Number.isFinite(multiplier) && multiplier > 0
    ? ((runs * multiplier) / balls).toFixed(digits)
    : "—";
}
export function dismissalText(line: Batter): string {
  if (line.retiredHurt) return "Retired hurt";
  if (line.notOut) return "Not out";
  const kind = line.dismissal;
  const attribution = line.attribution;
  if (!attribution) return kind?.replaceAll("_", " ") ?? "Out";
  const bowler = attribution.bowler?.name;
  const fielders = [
    ...attribution.fielders.map(
      (fielder) => `${fielder.name}${fielder.substitute ? " (sub)" : ""}`,
    ),
    ...Array.from({ length: attribution.unknownFielders }, () => "Unknown fielder"),
  ].join(" / ");
  const by = bowler ? ` b ${bowler}` : "";
  if (kind === "caught_and_bowled") return bowler ? `c & b ${bowler}` : "Caught and bowled";
  if (kind === "caught") return `c ${fielders || "Unknown fielder"}${by}`;
  if (kind === "stumped") return `st ${fielders || "Unknown fielder"}${by}`;
  if (kind === "run_out") return `Run out (${fielders || "Unknown fielder"})`;
  if (kind === "bowled") return bowler ? `b ${bowler}` : "Bowled";
  return `${kind?.replaceAll("_", " ") ?? "Out"}${by}`;
}
