import { formatAmount, monogramOf, paise } from "@desiauction/core";

import type { PublicTeam } from "../server/competition/public";

/**
 * The squad's headline facts, said the same way on the page, in its link card
 * and in the message that travels with the link: how many players, what was
 * spent, and who cost the most. A squad with nothing bought (only pre-signed
 * players, or the night not run yet) has no spend and no top buy — neither is
 * printed as ₹0.
 */
export interface TeamFacts {
  readonly playerCount: number;
  readonly spentLabel: string | null;
  readonly remainingLabel: string | null;
  readonly topBuy: { readonly name: string; readonly priceLabel: string } | null;
  readonly teamMonogram: string;
}

export function teamFacts(team: PublicTeam): TeamFacts {
  const bought = team.members.filter(
    (member): member is typeof member & { pricePaise: number } => member.pricePaise !== null,
  );
  const top = bought.reduce<(typeof bought)[number] | null>(
    (best, member) => (best === null || member.pricePaise > best.pricePaise ? member : best),
    null,
  );
  const spent = bought.length === 0 ? null : team.spentPaise;
  return {
    playerCount: team.members.length,
    // In the season's own unit: a points league prints "1,250 pts" (0091).
    spentLabel: spent === null ? null : formatAmount(paise(spent), team.unit),
    remainingLabel:
      team.pursePaise === null || spent === null
        ? null
        : formatAmount(paise(Math.max(0, team.pursePaise - spent)), team.unit),
    topBuy:
      top === null
        ? null
        : { name: top.name, priceLabel: formatAmount(paise(top.pricePaise), team.unit) },
    teamMonogram:
      team.team.shortName !== null &&
      team.team.shortName.trim() !== "" &&
      team.team.shortName.length <= 4
        ? team.team.shortName.trim().toUpperCase()
        : monogramOf(team.team.name),
  };
}
