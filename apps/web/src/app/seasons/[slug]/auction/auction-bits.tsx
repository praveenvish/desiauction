import { Pill, TeamChip, type KitTone } from "@desiauction/ui";

/*
 * Small shared pieces of the auction desk's card language: the lot status
 * pill and the paddle chip. One mapping each, so the overview, the Players tab
 * and the Paddles tab cannot disagree about what colour "queued" is.
 */

export const LOT_PILL_TONE: Record<string, KitTone> = {
  prepared: "purple",
  queued: "blue",
  on_block: "gold",
  closing_soon: "amber",
  sold: "green",
  unsold: "neutral",
  frozen: "amber",
  withdrawn: "red",
};

/** "on_block" → "on block": the status word itself, as every spec reads it. */
export function LotStatusPill({ status }: { status: string }) {
  return (
    <span className="auc-status-pill">
      <Pill tone={LOT_PILL_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Pill>
    </span>
  );
}

/** A paddle number on a wash of its team's colour ("P01"). */
export function PaddleChip({ number, color }: { number: string; color: string | null }) {
  return (
    <span className="auc-paddle-chip">
      <TeamChip color={color}>{number}</TeamChip>
    </span>
  );
}

/** "LotClosingSoon" → "Lot closing soon": the log reads as sentences. */
export function eventLabel(type: string): string {
  const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
