import { formatAmount, paise, type MoneyUnit } from "@desiauction/core";
import { IconCrown } from "@desiauction/ui";
import Link from "next/link";

import type { PublicTopBuy } from "../../server/competition/public";
import "./top-buys.css";

/**
 * THE THREE SALES A SEASON IS REMEMBERED BY — as a podium, not a footnote.
 *
 * It was a plain ordered list in the left 640px of a 1200px column: the
 * season's biggest story, set smaller than its fine print. Three cards, the
 * price the loudest thing on each, each leading to that player's page. Shared
 * by the season page and the register page's "here's how it ended" notice.
 */
export function TopBuysPodium({
  slug,
  buys,
  unit,
  testId,
}: {
  slug: string;
  buys: readonly PublicTopBuy[];
  unit: MoneyUnit;
  testId?: string;
}) {
  return (
    <ol className="top-buys da-stagger" data-testid={testId}>
      {buys.map((buy, index) => (
        <li key={buy.registrationId} className="top-buy" data-rank={index + 1}>
          <Link className="top-buy-link da-lift" href={`/c/${slug}/p/${buy.number}`}>
            <span className="top-buy-rank" aria-hidden>
              {index === 0 ? <IconCrown size={16} weight="fill" /> : null}
              {index + 1}
            </span>
            <span className="top-buy-price">{formatAmount(paise(buy.pricePaise), unit)}</span>
            <span className="top-buy-name">{buy.name}</span>
            {buy.teamName !== null ? <span className="top-buy-team">to {buy.teamName}</span> : null}
          </Link>
        </li>
      ))}
    </ol>
  );
}
