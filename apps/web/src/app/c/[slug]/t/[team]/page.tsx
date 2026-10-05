import { cache, type CSSProperties, type ReactNode } from "react";
import { formatAmount, paise, roleLabelIn, sportPackFor, type MoneyUnit } from "@desiauction/core";
import { ButtonLink, IconArrowLeft, PlayerImage, RosterMark } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../../../env";
import { teamShareMessage } from "../../../../../lib/share-message";
import { teamFacts } from "../../../../../lib/team-facts";
import { publicTeam } from "../../../../../server/competition/public";
import {
  PageBody,
  PageHero,
  PageSection,
  StatStrip,
  type Stat,
} from "../../../../../components/public/public-kit";
import { CrestImage } from "../../../../../components/team/crest-image";
import { ShareSheet } from "../../../share-sheet";
import "../../../../marketing.css";
import "../../../directory.css";

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
  const url = `${env.PUBLIC_BASE_URL}/c/${slug}/t/${teamSlug}`;
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
  const stats: Stat[] = [
    { value: String(facts.playerCount), label: facts.playerCount === 1 ? "Player" : "Players" },
    ...(facts.spentLabel === null ? [] : [{ value: facts.spentLabel, label: "Spent" }]),
    ...(facts.remainingLabel === null
      ? []
      : [{ value: facts.remainingLabel, label: "Purse left" }]),
    ...(facts.topBuy === null
      ? []
      : // A figure like the three before it, so no divider of its own: the
        // strip drew one rule before the last tile only (review r2, r3).
        [{ value: facts.topBuy.priceLabel, label: `Top buy · ${facts.topBuy.name}` }]),
  ];
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
    <span className="team-page-crest-mark" aria-hidden="true">
      {facts.teamMonogram}
    </span>
  );

  return (
    <main className="public-page mk">
      {/* No `sport`: the crest rides the title, and the sport's stock glyph
          would take the right half back as decoration. */}
      <PageHero
        eyebrow={<Link href={`/c/${slug}`}>{team.competitionName}</Link>}
        /* THE CREST BESIDE THE NAME (round 5): a 220px disc filled the hero's
           right half with decoration and no information; at 96px beside the
           title it identifies the team the way the player page's avatar does. */
        title={
          <span className="player-title team-page-title">
            <span className="team-page-crest" style={{ "--team": colour } as CSSProperties}>
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
            <span>{team.team.name}</span>
          </span>
        }
        /* "Our squad" spoke as the team, on a page anyone can land on from a
           forwarded link; the season's name says whose squad it is. */
        lede={[
          `${team.competitionName} squad`,
          ...(team.team.coachName === null ? [] : [`Coach ${team.team.coachName}`]),
          // 0110: the night happened elsewhere — say so, so nobody looks for
          // a live room or a replay.
          ...(team.auctionSource === "imported" ? ["Auction held offline"] : []),
        ].join(" · ")}
        actions={
          <ButtonLink href={`/c/${slug}`} variant="ghost" size="lg" className="team-page-back">
            <IconArrowLeft size={18} /> Back to {team.competitionName}
          </ButtonLink>
        }
      />

      <PageBody>
        {stats.length > 0 ? (
          <StatStrip label={`${team.team.name} — squad totals`} stats={stats} />
        ) : null}

        <PageSection headingId="squad-heading" title="Squad">
          {team.members.length === 0 ? (
            <p className="team-page-empty">
              The squad is announced after the auction. Share this page — it fills in as players are
              signed.
            </p>
          ) : (
            <ul className="team-page-squad" data-testid="team-squad">
              {team.members.map((member) => (
                <li key={member.registrationId}>
                  <Link
                    href={`/c/${slug}/p/${encodeURIComponent(member.number)}`}
                    className="team-page-player"
                  >
                    <span className="team-page-face">
                      <PlayerImage
                        name={member.name}
                        seed={member.registrationId}
                        size="md"
                        shape="round"
                        src={member.photoUrl}
                        decorative
                      />
                    </span>
                    <span className="team-page-who">
                      <strong>
                        <NameWithBadge
                          name={member.name}
                          badge={
                            /* The role on the sheet, as a badge after the name
                               — not in the price slot, where gold italics
                               read as a price. */
                            member.marks.includes("captain") ? (
                              <RosterMark kind="captain" className="team-page-badge" />
                            ) : member.marks.includes("icon") ? (
                              <RosterMark kind="icon" className="team-page-badge" />
                            ) : null
                          }
                        />
                      </strong>
                      <span>{roleLabelIn(pack, member.role)}</span>
                    </span>
                    <span className="team-page-price">
                      {member.pricePaise !== null ? (
                        formatPrice(member.pricePaise, team.unit)
                      ) : member.marks.length === 0 ? null : (
                        <span className="team-page-signed">
                          {member.marks.includes("retained") ? "Retained" : "Pre-signed"}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        <PageSection headingId="share-heading" title="Share">
          <ShareSheet
            title={team.team.name}
            surface="team"
            outcome={
              facts.playerCount === 0 ? "empty" : facts.spentLabel === null ? "signed" : "bought"
            }
            messages={messages}
            unit={team.unit}
            status={{ kind: "team", slug, team: teamSlug }}
          />
        </PageSection>
      </PageBody>
    </main>
  );
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
      <span className="team-page-nowrap">
        {last}
        {badge}
      </span>
    </>
  );
}
