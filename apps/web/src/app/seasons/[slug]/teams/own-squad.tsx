import { IconArrowRight, IconUsers, PlayerImage } from "@desiauction/ui";
import Link from "next/link";
import type { CSSProperties } from "react";

import { moneyFormat } from "../../../../lib/money";
import { planView } from "../../../../server/auction/owner-plan-actions";
import { seasonUnit } from "../../../../server/competition/season-unit";

/**
 * AN OWNER'S OWN SQUAD, INLINE (wow pass, round 2).
 *
 * The Teams tab showed an owner three identical cards and 80% blank canvas —
 * their own team was one of three with no emphasis, and the players they
 * bought were a click away behind a page that hides every roster from them.
 * `planView` is the owner's own gated read (the plan page and /home use it),
 * so this shows exactly what those pages already show this person.
 */
export async function OwnSquad({
  slug,
  teamId,
  teamName,
  color,
}: {
  slug: string;
  teamId: string;
  teamName: string;
  color: string | null;
}) {
  const [plan, unit] = await Promise.all([planView(slug, teamId), seasonUnit(slug)]);
  if (plan === null) return null;
  const money = moneyFormat(unit);
  const labelOf = (role: string | null): string =>
    role === null
      ? "Player"
      : (plan.roles.find((r) => r.key === role)?.label ?? role.replace(/_/g, " "));
  const bought = plan.lots
    .filter((lot) => lot.status === "sold" && lot.soldToTeamId === teamId)
    .sort((a, b) => (b.soldPrice ?? 0) - (a.soldPrice ?? 0));
  const spent = plan.rules.pursePerTeam - plan.standing.purseRemaining;
  const preSigned = plan.preSignedRoles.length;
  return (
    <section
      className="tm-own"
      aria-labelledby="tm-own-title"
      data-testid="teams-own-squad"
      style={color === null ? undefined : ({ "--team": color } as CSSProperties)}
    >
      <div className="tm-own-head">
        <div className="tm-own-id">
          <p className="tm-own-kicker">
            <IconUsers size={16} />
            My squad
          </p>
          <h2 id="tm-own-title" className="tm-own-name">
            {teamName}
          </h2>
        </div>
        <dl className="tm-own-facts">
          <div>
            <dt>Players</dt>
            <dd>
              {String(plan.standing.squadSize)}
              <span>/{String(plan.rules.squadMax)}</span>
            </dd>
          </div>
          <div>
            <dt>Spent</dt>
            <dd>{money.ledger(spent)}</dd>
          </div>
          <div>
            <dt>Left</dt>
            <dd>{money.ledger(plan.standing.purseRemaining)}</dd>
          </div>
        </dl>
      </div>
      {bought.length === 0 ? (
        <p className="tm-own-empty">
          No buys yet. The players you win in the auction line up here, dearest first.
        </p>
      ) : (
        <ol className="tm-own-grid">
          {bought.map((lot) => (
            <li key={lot.lotId} className="tm-own-player">
              <PlayerImage
                name={lot.playerName ?? "Player"}
                seed={lot.registrationId}
                src={plan.lotMedia[lot.lotId]?.photoUrl ?? null}
                size="md"
                shape="round"
                decorative
              />
              <span className="tm-own-who">
                <span className="tm-own-player-name">{lot.playerName ?? "Player"}</span>
                <span className="tm-own-role">{labelOf(lot.role)}</span>
              </span>
              <span className="tm-own-price">{money.ledger(lot.soldPrice ?? 0)}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="tm-own-foot">
        <span>
          {preSigned > 0
            ? `Plus ${String(preSigned)} signed before the auction.`
            : "Bought on the night, dearest first."}
        </span>
        <Link href={`/seasons/${slug}/auction/plan`} className="tm-own-link">
          My plan
          <IconArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
