import type { KitTone } from "@desiauction/ui";
import type { MoneyUnit } from "@desiauction/core";

import type { CareerSeason } from "../../server/player/career";

/**
 * Where a season stands for its player, in one phrase — shared by My profile
 * (/me) and /home so the two tell a season the same way.
 */

const ENTRY: Record<string, { label: string; tone: KitTone }> = {
  submitted: { label: "Waiting for approval", tone: "blue" },
  approved: { label: "In the pool", tone: "green" },
  waitlisted: { label: "Waitlisted", tone: "amber" },
  rejected: { label: "Not accepted", tone: "red" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  draft: { label: "Not submitted", tone: "neutral" },
};

/** The four facts a verdict is made from — a career season has them, and so
 *  does /home's `MyRegistration`, which is why this is not `CareerSeason`. */
export type VerdictFacts = Pick<CareerSeason, "auction" | "auctionUnit" | "status" | "teamName">;

/** Where a season stands for this person: the auction's word once there is
 *  one, the registration's until then. */
export function verdictOf(
  season: VerdictFacts,
  money: (paise: number, unit: MoneyUnit) => string,
): { label: string; tone: KitTone } {
  const outcome = season.auction;
  if (outcome === null) {
    return season.teamName !== null
      ? { label: "In the squad", tone: "green" }
      : (ENTRY[season.status] ?? { label: season.status, tone: "neutral" });
  }
  if (outcome.kind === "sold") {
    return { label: `Sold · ${money(outcome.soldPrice, season.auctionUnit)}`, tone: "gold" };
  }
  if (outcome.kind === "unsold") return { label: "Unsold", tone: "neutral" };
  if (outcome.kind === "icon") return { label: "Icon player", tone: "purple" };
  if (outcome.kind === "captain")
    return { label: "Captain · picked before the auction", tone: "purple" };
  return { label: "Retained", tone: "purple" };
}
