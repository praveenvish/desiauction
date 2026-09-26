import { EmptyState, IconArrowRight, IconGavel, IconUsers, PlayerImage } from "@desiauction/ui";
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
  // Pre-signed first (captain, icon, retained): they are the squad's first
  // names and they count in "Players n/max" above, so they are cards too.
  const preSigned = plan.preSignedPlayers;
  const marksOf = (player: (typeof preSigned)[number]): string =>
    [player.isIcon ? "Icon" : null, player.isCaptain ? "Captain" : null]
      .concat(player.isRetained ? ["Retained"] : [])
      .filter((word): word is string => word !== null)
      .join(" · ");
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
      {bought.length === 0 && preSigned.length === 0 ? (
        <EmptyState
          size="compact"
          icon={<IconGavel />}
          title="No buys yet"
          description="The players you win in the auction line up here, dearest first."
        />
      ) : (
        <ol className="tm-own-grid">
          {preSigned.map((player) => (
            <li
              key={player.registrationId}
              className="tm-own-player tm-own-player--signed"
              data-testid="teams-own-presigned"
            >
              <PlayerImage
                name={player.playerName ?? "Player"}
                seed={player.registrationId}
                src={player.photoUrl}
                size="md"
                shape="round"
                decorative
              />
              <span className="tm-own-who">
                <span className="tm-own-player-name">{player.playerName ?? "Player"}</span>
                <span className="tm-own-role">
                  <span className="tm-own-mark">{marksOf(player)}</span>
                  {player.role !== null ? ` · ${labelOf(player.role)}` : ""}
                </span>
              </span>
              <span className="tm-own-price tm-own-price--signed">Pre-signed</span>
            </li>
          ))}
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
          {preSigned.length > 0
            ? "Signed before the auction first, then bought on the night, dearest first."
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
