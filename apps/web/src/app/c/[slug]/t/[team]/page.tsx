import { cache, type CSSProperties, type ReactNode } from "react";
import {
  formatAmount,
  monogramOf,
  paise,
  roleLabelIn,
  sportPackFor,
  type MoneyUnit,
} from "@desiauction/core";
import {
  IconArrowLeft,
  IconCalendar,
  IconChevronRight,
  IconPin,
  PlayerImage,
  RosterMark,
} from "@desiauction/ui";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../../../env";
import { teamShareMessage } from "../../../../../lib/share-message";
import { teamFacts } from "../../../../../lib/team-facts";
import { servedAsStored } from "../../../../../lib/stored-image";
import { publicTeam, type PublicTeamMember } from "../../../../../server/competition/public";
import { HeroBanner } from "../../../../../components/public/public-kit";
import { CrestImage } from "../../../../../components/team/crest-image";
import { formatDateRange } from "../../../format";
import { ShareSheet } from "../../../share-sheet";
import "../../../../marketing.css";
import "../../../directory.css";
import "./team-page.css";

/**
 * THE PUBLIC SQUAD — `/c/[slug]/t/[team]`.
 *
 * The page an owner forwards the morning after the auction, and the one a
 * squad sheet's QR code opens: the team's crest in its own colour, every
 * player it signed with what each cost, the spend against the season's purse,
 * and the share sheet. Each player links to their own card.
 *
 * Same gates as every public page (`publicTeam`): a published season, approved
 * players, faces only with consent and never a minor's. `noindex` like the
 * player card — this is shared by link, not farmed for search.
 */

const teamView = cache(publicTeam);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; team: string }>;
}): Promise<Metadata> {
  const { slug, team: teamSlug } = await params;
  const team = await teamView(slug, teamSlug);
  if (team === null) {
    return { title: "Team" };
  }
  const facts = teamFacts(team);
  // The team's own address, even when an older shared link opened it.
  const url = `${env.PUBLIC_BASE_URL}/c/${slug}/t/${team.team.slug}`;
  const description = teamShareMessage(
    { teamName: team.team.name, competitionName: team.competitionName, ...facts },
    "en",
  );
  // The version changes whenever the card would — a signing, a sale, a crest —
  // so a chat that cached last night's empty squad fetches today's.
  const version = [facts.playerCount, team.spentPaise, team.team.crestKey === null ? 0 : 1].join(
    ".",
  );
  const images = [
    {
      url: `${url}/opengraph-image?v=${version}`,
      width: 1200,
      height: 630,
      alt: description,
    },
  ];
  return {
    title: `${team.team.name} · ${team.competitionName}`,
    description,
    alternates: { canonical: url },
    // Shared by link always; indexed only when the organizer opted in AND
    // every approved player in the season is a known adult (SEO-1 Phase 5).
    robots: team.squadListing.indexable
      ? { index: true, follow: true }
      : { index: false, follow: true },
    openGraph: {
      title: `${team.team.name} — squad`,
      description,
      url,
      type: "website",
      siteName: "DesiAuction",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: `${team.team.name} — squad`,
      description,
      images,
    },
  };
}

export default async function PublicTeamPage({
  params,
}: {
  params: Promise<{ slug: string; team: string }>;
}) {
  const { slug, team: teamSlug } = await params;
  const team = await teamView(slug, teamSlug);
  if (team === null) {
    notFound();
  }
  const facts = teamFacts(team);
  const colour = team.team.color ?? "var(--accent)";
  const pack = sportPackFor(team.sport);
  const cover = team.season.coverUrl;

  // The two players a squad is introduced by. Shown once, as cards, and not
  // again in the list under them.
  const isLeader = (member: PublicTeamMember) =>
    member.marks.includes("captain") || member.marks.includes("icon");
  const leaders = team.members
    .filter(isLeader)
    .sort((a, b) => Number(b.marks.includes("captain")) - Number(a.marks.includes("captain")));
  const roster = team.members.filter((member) => !isLeader(member));

  // What the list is made of, when the season records roles — counted over
  // the same players as the heading beside it. A season whose roles were
  // never collected (an imported sheet) says nothing rather than "15 · Unknown".
  const roleCounts = new Map<string, number>();
  for (const member of roster) {
    const label = roleLabelIn(pack, member.role);
    if (label !== "") {
      roleCounts.set(label, (roleCounts.get(label) ?? 0) + 1);
    }
  }

  // The squad's numbers, inside the hero rather than in a card of their own:
  // a full-width box holding one figure was most of the old page's first
  // screen. Each one only when it is real — an offline night has no spend.
  const heroFacts: { label: string; value: string }[] = [
    { label: facts.playerCount === 1 ? "Player" : "Players", value: String(facts.playerCount) },
    ...(facts.spentLabel === null ? [] : [{ label: "Spent", value: facts.spentLabel }]),
    ...(facts.remainingLabel === null
      ? []
      : [{ label: "Purse left", value: facts.remainingLabel }]),
    ...(facts.topBuy === null
      ? []
      : [{ label: `Top buy · ${facts.topBuy.name}`, value: facts.topBuy.priceLabel }]),
    ...(team.team.coachName === null ? [] : [{ label: "Coach", value: team.team.coachName }]),
  ];
  // One figure is not a strip — it was the old page's whole first screen. An
  // offline night has a head count and nothing else: it joins the meta line.
  const showFacts = heroFacts.length > 1;
  const dates =
    team.season.startsOn === null && team.season.endsOn === null
      ? null
      : formatDateRange(team.season.startsOn, team.season.endsOn);

  const messages = {
    en: teamShareMessage(
      { teamName: team.team.name, competitionName: team.competitionName, ...facts },
      "en",
    ),
    hi: teamShareMessage(
      { teamName: team.team.name, competitionName: team.competitionName, ...facts },
      "hi",
    ),
  };
  const crestFallback = (
    <span className="tp-crest-mark" aria-hidden="true">
      {facts.teamMonogram}
    </span>
  );
  const playerHref = (member: PublicTeamMember) =>
    `/c/${slug}/p/${encodeURIComponent(member.number)}`;

  return (
    <main className="public-page mk tp" style={{ "--team": colour } as CSSProperties}>
      <header
        className="tp-hero"
        data-theme="floodlight"
        data-cover={cover === null ? undefined : ""}
      >
        {/* The season's banner, blurred, as the band's light; drawn whole and
            sharp beside the team on a laptop. Without one the band takes the
            team's own colour. */}
        {cover === null ? null : (
          <div className="tp-hero-cover" aria-hidden>
            <Image
              src={cover}
              unoptimized={servedAsStored(cover)}
              alt=""
              fill
              sizes="100vw"
              priority
            />
          </div>
        )}
        <div className="tp-hero-inner">
          <div className="tp-hero-main">
            <Link href={`/c/${slug}`} className="tp-back">
              <IconArrowLeft size={16} />
              <span>
                {team.competitionName}
                <span className="tp-back-hint"> · all teams</span>
              </span>
            </Link>

            <div className="tp-identity">
              <span className="tp-crest">
                {team.team.crestUrl === null ? (
                  crestFallback
                ) : (
                  <CrestImage
                    src={team.team.crestUrl}
                    fallback={crestFallback}
                    width={160}
                    height={160}
                  />
                )}
              </span>
              <div className="tp-identity-copy">
                <p className="tp-kicker">
                  {pack.label} squad · {team.competitionName}
                </p>
                <h1 className="tp-name">{team.team.name}</h1>
                <ul className="tp-meta">
                  {showFacts ? null : (
                    <li className="tp-meta-strong">
                      {facts.playerCount} {facts.playerCount === 1 ? "player" : "players"}
                    </li>
                  )}
                  <li>By {team.season.orgName}</li>
                  {team.season.location === null ? null : (
                    <li>
                      <IconPin size={15} aria-hidden /> {team.season.location}
                    </li>
                  )}
                  {dates === null ? null : (
                    <li>
                      <IconCalendar size={15} aria-hidden /> {dates}
                    </li>
                  )}
                  {/* 0110: the night happened elsewhere — say so, so nobody
                      looks for a live room or a replay. */}
                  {team.auctionSource === "imported" ? <li>Auction held offline</li> : null}
                </ul>
              </div>
            </div>

            {showFacts ? (
              <dl className="tp-facts" aria-label={`${team.team.name} — squad totals`}>
                {heroFacts.map((fact) => (
                  <div key={fact.label} className="tp-fact">
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>

          {cover === null ? null : (
            <Link href={`/c/${slug}`} className="tp-hero-banner" aria-label={team.competitionName}>
              <HeroBanner src={cover} />
            </Link>
          )}
        </div>
      </header>

      <div className="tp-body">
        <div className="tp-main" data-testid="team-squad">
          {team.members.length === 0 ? (
            <section className="tp-section" aria-labelledby="squad-heading">
              <h2 id="squad-heading" className="tp-h2">
                Squad
              </h2>
              <p className="tp-empty">
                The squad is announced after the auction. Share this page — it fills in as players
                are signed.
              </p>
            </section>
          ) : (
            <>
              {leaders.length === 0 ? null : (
                <section className="tp-section" aria-labelledby="leaders-heading">
                  <h2 id="leaders-heading" className="tp-h2">
                    Leading the side
                  </h2>
                  <ul className="tp-leaders">
                    {leaders.map((member) => (
                      <li key={member.registrationId}>
                        <Link href={playerHref(member)} className="tp-leader">
                          <PlayerImage
                            name={member.name}
                            seed={member.registrationId}
                            size="lg"
                            shape="round"
                            src={member.photoUrl}
                            decorative
                          />
                          <span className="tp-leader-who">
                            <RosterMark
                              kind={member.marks.includes("captain") ? "captain" : "icon"}
                            />
                            <strong>{member.name}</strong>
                            <span className="tp-leader-sub">
                              {[
                                roleLabelIn(pack, member.role),
                                member.pricePaise === null
                                  ? signedLabel(member)
                                  : formatPrice(member.pricePaise, team.unit),
                              ]
                                .filter((part) => part !== "")
                                .join(" · ")}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {roster.length === 0 ? null : (
                <section className="tp-section" aria-labelledby="squad-heading">
                  <div className="tp-section-head">
                    <h2 id="squad-heading" className="tp-h2">
                      {leaders.length === 0 ? "Squad" : "The rest of the squad"}
                      <span className="tp-count">{roster.length}</span>
                    </h2>
                    {roleCounts.size === 0 ? null : (
                      <ul className="tp-roles" aria-label="Squad by role">
                        {[...roleCounts].map(([label, count]) => (
                          <li key={label}>
                            {label} <b>{count}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <ol className="tp-roster">
                    {roster.map((member) => (
                      <li key={member.registrationId}>
                        <Link href={playerHref(member)} className="tp-row">
                          <PlayerImage
                            name={member.name}
                            seed={member.registrationId}
                            size="md"
                            shape="round"
                            src={member.photoUrl}
                            decorative
                          />
                          <span className="tp-row-who">
                            <strong>
                              <NameWithBadge
                                name={member.name}
                                badge={
                                  member.marks.includes("retained") ? (
                                    <RosterMark kind="retained" className="tp-badge" />
                                  ) : null
                                }
                              />
                            </strong>
                            {member.role === null ? null : (
                              <span>{roleLabelIn(pack, member.role)}</span>
                            )}
                          </span>
                          <span className="tp-row-price">
                            {member.pricePaise !== null ? (
                              formatPrice(member.pricePaise, team.unit)
                            ) : member.marks.length === 0 ? null : (
                              <span className="tp-signed">{signedLabel(member)}</span>
                            )}
                          </span>
                          <IconChevronRight size={16} className="tp-row-go" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="tp-aside">
          <section className="tp-card" aria-labelledby="share-heading">
            <h2 id="share-heading" className="tp-h3">
              Share this squad
            </h2>
            <ShareSheet
              title={team.team.name}
              surface="team"
              outcome={
                facts.playerCount === 0 ? "empty" : facts.spentLabel === null ? "signed" : "bought"
              }
              messages={messages}
              unit={team.unit}
              status={{ kind: "team", slug, team: team.team.slug }}
            />
          </section>

          {team.otherTeams.length === 0 ? null : (
            <nav className="tp-card" aria-labelledby="teams-heading">
              <h2 id="teams-heading" className="tp-h3">
                Other teams in {team.competitionName}
              </h2>
              <ul className="tp-teams">
                {team.otherTeams.map((other) => {
                  const mark = monogramOf(other.name);
                  return (
                    <li key={other.slug}>
                      <Link
                        href={`/c/${slug}/t/${other.slug}`}
                        className="tp-team"
                        style={{ "--other": other.color ?? "var(--accent)" } as CSSProperties}
                      >
                        <span className="tp-team-crest" aria-hidden>
                          {other.crestUrl === null ? (
                            mark
                          ) : (
                            <CrestImage
                              src={other.crestUrl}
                              fallback={mark}
                              width={64}
                              height={64}
                            />
                          )}
                        </span>
                        <span className="tp-team-name">{other.name}</span>
                        <IconChevronRight size={16} aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </aside>
      </div>
    </main>
  );
}

/** "Retained" or "Pre-signed" — a player on the squad before the bidding. */
function signedLabel(member: PublicTeamMember): string {
  if (member.marks.includes("retained")) {
    return "Retained";
  }
  return member.marks.length === 0 ? "" : "Pre-signed";
}

/** A player's price in the season's own unit — "₹12,500" or "1,250 pts". */
function formatPrice(pricePaise: number, unit: MoneyUnit): string {
  return formatAmount(paise(pricePaise), unit);
}

/**
 * A name with its badge, where the badge never takes a line of its own
 * (round-5 review): the name's last word and the badge are glued together, so
 * a long name wraps before its last word and the badge rides that word.
 */
function NameWithBadge({ name, badge }: { name: string; badge: ReactNode }) {
  if (badge === null) {
    return <>{name}</>;
  }
  const cut = name.trimEnd().lastIndexOf(" ");
  const head = cut === -1 ? "" : name.slice(0, cut + 1);
  const last = cut === -1 ? name : name.slice(cut + 1);
  return (
    <>
      {head}
      <span className="tp-nowrap">
        {last}
        {badge}
      </span>
    </>
  );
}
