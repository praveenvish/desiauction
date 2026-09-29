import {
  EmptyState,
  IconArrowRight,
  IconGavel,
  IconUsers,
  PlayerImage,
  RosterMark,
  type RosterMarkKind,
} from "@desiauction/ui";
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
  const marksOf = (player: (typeof preSigned)[number]): RosterMarkKind[] =>
    [
      player.isCaptain ? ("captain" as const) : null,
      player.isIcon ? ("icon" as const) : null,
      player.isRetained ? ("retained" as const) : null,
    ].filter((kind) => kind !== null);
  type Card =
    | { kind: "signed"; player: (typeof preSigned)[number] }
    | { kind: "bought"; lot: (typeof bought)[number] };
  const cards: { role: string | null; card: Card }[] = [
    ...preSigned.map((player) => ({
      role: player.role,
      card: { kind: "signed" as const, player },
    })),
    ...bought.map((lot) => ({ role: lot.role, card: { kind: "bought" as const, lot } })),
  ];
  const order = (role: string | null): number => {
    const at = role === null ? -1 : plan.roles.findIndex((r) => r.key === role);
    return at === -1 ? plan.roles.length : at;
  };
  const groups = [...new Set(cards.map((entry) => entry.role))]
    .sort((a, b) => order(a) - order(b))
    .map((role) => ({
      key: role ?? "none",
      label: role === null ? "No role given" : labelOf(role),
      cards: cards.filter((entry) => entry.role === role).map((entry) => entry.card),
    }));
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
        // BY ROLE (census 18): a squad is read as its balance — how many
        // batters, how many bowlers — so the cards sit under their role, the
        // pack's order, pre-signed first and then dearest first within one.
        <div className="tm-own-roles">
          {groups.map((group) => (
            <section
              key={group.key}
              className="tm-own-role-group"
              aria-label={`${group.label}, ${String(group.cards.length)}`}
              data-testid="teams-own-role"
            >
              <h3 className="tm-own-role-head">
                {group.label}
                <span>{group.cards.length}</span>
              </h3>
              <ol className="tm-own-grid">
                {group.cards.map((card) =>
                  card.kind === "signed" ? (
                    <li
                      key={card.player.registrationId}
                      className="tm-own-player tm-own-player--signed"
                      data-testid="teams-own-presigned"
                    >
                      <PlayerImage
                        name={card.player.playerName ?? "Player"}
                        seed={card.player.registrationId}
                        src={card.player.photoUrl}
                        size="md"
                        shape="round"
                        decorative
                      />
                      <span className="tm-own-who">
                        <span className="tm-own-line">
                          <span className="tm-own-player-name">
                            {card.player.playerName ?? "Player"}
                          </span>
                          {marksOf(card.player).map((kind) => (
                            <RosterMark key={kind} kind={kind} />
                          ))}
                        </span>
                      </span>
                      <span className="tm-own-price tm-own-price--signed">Pre-signed</span>
                    </li>
                  ) : (
                    <li key={card.lot.lotId} className="tm-own-player">
                      <PlayerImage
                        name={card.lot.playerName ?? "Player"}
                        seed={card.lot.registrationId}
                        src={plan.lotMedia[card.lot.lotId]?.photoUrl ?? null}
                        size="md"
                        shape="round"
                        decorative
                      />
                      <span className="tm-own-who">
                        <span className="tm-own-player-name">
                          {card.lot.playerName ?? "Player"}
                        </span>
                      </span>
                      <span className="tm-own-price">{money.ledger(card.lot.soldPrice ?? 0)}</span>
                    </li>
                  ),
                )}
              </ol>
            </section>
          ))}
        </div>
      )}
      <div className="tm-own-foot">
        <span>
          {preSigned.length > 0
            ? "By role — signed before the auction first, then bought on the night, dearest first."
            : "By role — bought on the night, dearest first."}
        </span>
        <Link href={`/seasons/${slug}/auction/plan`} className="tm-own-link">
          My plan
          <IconArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
