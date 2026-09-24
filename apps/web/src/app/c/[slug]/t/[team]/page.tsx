import { cache, type CSSProperties } from "react";
import { formatAmount, paise, roleLabelIn, sportPackFor, type MoneyUnit } from "@desiauction/core";
import { ButtonLink, IconArrowLeft, PlayerImage } from "@desiauction/ui";
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
    return { title: "Team · DesiAuction" };
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
    robots: { index: false, follow: true },
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
      : [{ value: facts.topBuy.priceLabel, label: `Top buy · ${facts.topBuy.name}`, aside: true }]),
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
      <PageHero
        sport={team.sport}
        art={
          <div className="team-page-crest" style={{ "--team": colour } as CSSProperties}>
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
          </div>
        }
        eyebrow={<Link href={`/c/${slug}`}>{team.competitionName}</Link>}
        title={team.team.name}
        lede={
          team.team.coachName === null ? "Our squad" : `Our squad · Coach ${team.team.coachName}`
        }
        actions={
          <ButtonLink href={`/c/${slug}`} variant="ghost" size="lg">
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
                        src={member.photoUrl}
                        decorative
                      />
                    </span>
                    <span className="team-page-who">
                      <strong>{member.name}</strong>
                      <span>{roleLabelIn(pack, member.role)}</span>
                    </span>
                    <span className="team-page-price">
                      {member.pricePaise !== null ? (
                        member.marks.includes("captain") ? (
                          <>
                            <span className="team-page-mark">C</span>
                            {formatPrice(member.pricePaise, team.unit)}
                          </>
                        ) : (
                          formatPrice(member.pricePaise, team.unit)
                        )
                      ) : (
                        <span className="team-page-signed">
                          {member.marks.includes("captain")
                            ? "Captain"
                            : member.marks.includes("icon")
                              ? "Icon"
                              : "Retained"}
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
