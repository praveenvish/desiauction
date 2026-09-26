import { roleLabelIn, sportPackFor } from "@desiauction/core";
import { IconArrowRight, IconUsers, PlayerImage, RosterMark } from "@desiauction/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { moneyFormat } from "../../lib/money";
import type { PublicTeam } from "../../server/competition/public";
import "../../app/home/home-duo.css";
import "./squad-list.css";

/**
 * ONE SQUAD LIST (round 4). The same squad was drawn by two copies of one
 * block — player home and the /me rail — and each dropped the Captain and
 * Icon badges /teams shows, and wrapped its header on a phone ("Mumbai /
 * Mavericks · 12 play… See all"). Now there is one: badges on every row, the
 * viewer's own row marked and always among those shown, and a header that
 * truncates the team name instead of wrapping it.
 *
 * It renders only what `publicTeam` publishes — the season's own public team
 * page shows the same rows to a visitor.
 */
export function SquadList({
  team,
  selfId = null,
  title,
  limit = 8,
  headingId,
  testId,
  caption,
}: {
  team: PublicTeam;
  /** The viewer's own registration, marked "You" and never cut. */
  selfId?: string | null;
  /** Defaults to the team's name. */
  title?: ReactNode;
  limit?: number;
  headingId: string;
  testId?: string;
  /** A quiet line under the head — the season, when the title is the team. */
  caption?: ReactNode;
}) {
  const money = moneyFormat(team.unit);
  const pack = sportPackFor(team.sport);
  const self = team.members.find((member) => member.registrationId === selfId);
  const first = team.members.slice(0, limit);
  const shown =
    self === undefined || first.includes(self) ? first : [self, ...first.slice(0, limit - 1)];
  const count = team.members.length;
  return (
    <section className="hd-card sq-list" aria-labelledby={headingId} data-testid={testId}>
      <div className="hd-head">
        <h2 id={headingId} className="hd-title sq-title">
          <IconUsers size={20} />
          <span className="sq-name">{title ?? team.team.name}</span>
          <span className="sq-count">
            {count}
            <span className="sq-sr"> {count === 1 ? "player" : "players"}</span>
          </span>
        </h2>
        <Link className="hd-link" href={`/c/${team.competitionSlug}/t/${team.team.slug}`}>
          See all
          <IconArrowRight size={16} />
        </Link>
      </div>
      {caption === undefined ? null : <p className="sq-caption">{caption}</p>}
      <ul className="hd-rows" data-plain="true">
        {shown.map((member) => {
          const isSelf = member.registrationId === selfId;
          return (
            <li key={member.registrationId} className="hd-row" data-self={isSelf}>
              <PlayerImage
                name={member.name}
                seed={member.registrationId}
                src={member.photoUrl}
                size="sm"
                shape="round"
                decorative
              />
              <span className="hd-who">
                <span className="sq-line">
                  <span className="hd-name">{member.name}</span>
                  {member.marks.map((mark) => (
                    <RosterMark key={mark} kind={mark} />
                  ))}
                  {isSelf ? <RosterMark kind="you" /> : null}
                </span>
                <span className="hd-meta">{roleLabelIn(pack, member.role) || "Player"}</span>
              </span>
              <span
                className="hd-figure"
                data-muted={member.pricePaise === null ? "true" : undefined}
              >
                {member.pricePaise === null ? "Pre-signed" : money.ledger(member.pricePaise)}
              </span>
            </li>
          );
        })}
      </ul>
      {count > shown.length ? (
        <p className="sq-more">
          +{count - shown.length} more {count - shown.length === 1 ? "player" : "players"}
        </p>
      ) : null}
    </section>
  );
}
