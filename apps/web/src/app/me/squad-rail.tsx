import { roleLabelIn, sportPackFor } from "@desiauction/core";
import { IconArrowRight, IconUsers, PlayerImage } from "@desiauction/ui";
import Link from "next/link";

import { moneyFormat } from "../../lib/money";
import { publicTeam, teamSlugOf } from "../../server/competition/public";
import type { CareerSeason } from "../../server/player/career";
import "../home/home-duo.css";

/** Faces shown before "See all" — enough to fill the rail, not the page. */
const SHOWN = 8;

/**
 * THE SECOND OBJECT on /me and /me/[sport] (round 3C). A player's career page
 * was a hero, four tiles and one season row, with half a laptop blank beside
 * it. The rail now holds the squad of their newest team — the people they
 * play with — from the same public read the season's team page publishes (a
 * private season returns null, and the rail is simply absent). Their own row
 * is marked, and it is always among the faces shown.
 */
export async function LatestSquad({
  seasons,
  owned = null,
}: {
  seasons: CareerSeason[];
  /** A team this person owns — the rail's team when they play for none. */
  owned?: { competitionSlug: string; teamName: string } | null;
}) {
  const latest = [...seasons]
    .filter((season) => season.teamName !== null)
    .sort((a, b) => (b.startsOn ?? "").localeCompare(a.startsOn ?? ""))[0];
  const source =
    latest !== undefined && latest.teamName !== null
      ? {
          competitionSlug: latest.competitionSlug,
          teamName: latest.teamName,
          selfId: latest.registrationId,
        }
      : owned !== null
        ? { ...owned, selfId: null }
        : null;
  if (source === null) return null;
  const team = await publicTeam(source.competitionSlug, teamSlugOf(source.teamName));
  if (team === null || team.members.length === 0) return null;
  const money = moneyFormat(team.unit);
  const pack = sportPackFor(team.sport);
  const self = team.members.find((member) => member.registrationId === source.selfId);
  const first = team.members.slice(0, SHOWN);
  const shown =
    self === undefined || first.includes(self) ? first : [self, ...first.slice(0, SHOWN - 1)];
  return (
    <section className="hd-card" aria-labelledby="me-squad-title" data-testid="me-squad">
      <div className="hd-head">
        <h2 id="me-squad-title" className="hd-title">
          <IconUsers size={20} />
          {team.team.name}
          <span className="hd-title-sub">· {String(team.members.length)} players</span>
        </h2>
        <Link className="hd-link" href={`/c/${team.competitionSlug}/t/${team.team.slug}`}>
          See all
          <IconArrowRight size={16} />
        </Link>
      </div>
      <p className="me-squad-season">{team.competitionName}</p>
      <ul className="hd-rows" data-plain="true">
        {shown.map((member) => {
          const isSelf = member.registrationId === source.selfId;
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
                <span className="hd-name">
                  {member.name}
                  {isSelf ? <span className="hd-you">You</span> : null}
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
    </section>
  );
}
