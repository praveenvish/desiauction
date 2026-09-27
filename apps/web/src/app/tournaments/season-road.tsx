import { IconCheck } from "@desiauction/ui";

import type { SeasonRow } from "../../server/competition/tournament-actions";
import { seasonJourney } from "./season-journey";

/**
 * A SEASON'S ROAD, SMALL — five dots, the done ones gold, the current one
 * ringed. The journey itself is `seasonJourney` (tested); this only draws it at
 * the size of a card or a list row, and names the whole road for a screen
 * reader in one sentence instead of five unlabelled circles.
 */
export function roadOf(season: SeasonRow) {
  return seasonJourney(
    {
      status: season.status,
      teams: season.counts.teams,
      registrations: (season.counts.approved ?? 0) + season.counts.pending,
      // The index knows only whether the auction is over, which is all the
      // road asks of it.
      auctionStatus: season.counts.auctionDone === true ? "completed" : null,
      settlement: season.settlement,
      auctionUnit: season.auctionUnit,
      fixtures: season.counts.matches,
    },
    { withTeams: true },
  );
}

export function SeasonRoad({ season, size = "md" }: { season: SeasonRow; size?: "sm" | "md" }) {
  const steps = roadOf(season);
  const current = steps.find((step) => step.state === "current");
  const done = steps.filter((step) => step.state === "done").length;
  const said =
    current === undefined
      ? `Every step done: ${steps.map((step) => step.label).join(", ")}`
      : `Step ${String(done + 1)} of ${String(steps.length)}: ${current.label}`;
  return (
    <span className="tx-road" data-size={size} role="img" aria-label={said}>
      {steps.map((step) => (
        <span key={step.key} className="tx-road-step" data-state={step.state}>
          {step.state === "done" ? <IconCheck size={size === "sm" ? 10 : 12} aria-hidden /> : null}
        </span>
      ))}
    </span>
  );
}
