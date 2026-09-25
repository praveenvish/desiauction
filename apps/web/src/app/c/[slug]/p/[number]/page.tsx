import { cache } from "react";
import {
  buildPlayerPoster,
  formatAmount,
  paise,
  roleLabelIn,
  sportPackFor,
  styleLabel,
} from "@desiauction/core";
import { Badge, ButtonLink, PlayerImage, IconArrowLeft } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../../../env";
import { preSignedWord, type PreSignedKind } from "../../../../../lib/pre-signed";
import {
  publicPlayer,
  publicPlayerPoster,
  teamSlugOf,
} from "../../../../../server/competition/public";
import { linkCardAlt } from "../../../../seasons/[slug]/posters/poster-link";
import {
  HeroFact,
  PageBody,
  PageHero,
  PageSection,
  StatStrip,
  type Stat,
} from "../../../../../components/public/public-kit";
import { playerShareMessage } from "../../../../../lib/share-message";
import { ShareSheet } from "../../../share-sheet";
import "../../../../marketing.css";
import "../../../directory.css";

/**
 * `generateMetadata` and the page both need this read, and Next runs them as
 * two calls in one request — so it was fetched twice per render. React
 * `cache` makes the second a memo hit for the rest of the request (wrapped
 * here, not in the server module, because a "use server" file may only export
 * async functions).
 */
const playerView = cache(publicPlayer);
const posterView = cache(publicPlayerPoster);

// Public single-player profile (parity §Phase 2). The routable, link-shareable
// surface behind the player OG card — the client showcase dialog is not
// addressable. Same consent + visibility gates as the showcase. Individual
// pages are `noindex` (link-shared, not SEO-farmed); the photo is consent-gated.

/**
 * The three outcomes, said in one place. "retained" is a squad place signed
 * BEFORE the auction opens (an icon pick) — the old test was `status !==
 * "sold"`, which folded retained in with available and advertised a player who
 * already has a team as up for grabs: on this page, in the page title and
 * description, and on the OG card someone forwards to a WhatsApp group. The
 * showcase dialog already told the three apart; this is that same split, used
 * by the metadata, the hero badge and the status row so they cannot drift.
 */
function statusText(player: {
  status: "available" | "sold" | "retained";
  preSignedAs: PreSignedKind | null;
  teamName: string | null;
}): string {
  if (player.status === "available") {
    return "Available";
  }
  if (player.status === "retained") {
    // No team name means an approved ICON nobody has assigned yet. They are not
    // available — `auctionReady` filters icons out of the pool, so no team can
    // bid for them — and "Retained" on its own implies a retaining team there
    // is no record of. Say the thing that is actually true of them.
    const word = preSignedWord(player.preSignedAs);
    return player.teamName !== null
      ? `${word} for ${player.teamName}`
      : `${word} — not in the auction`;
  }
  return player.teamName !== null ? `Sold to ${player.teamName}` : "Sold";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}): Promise<Metadata> {
  const { slug, number } = await params;
  const player = await playerView(slug, number);
  if (player === null) {
    return { title: "Player · DesiAuction" };
  }
  const url = `${env.PUBLIC_BASE_URL}/c/${slug}/p/${number}`;
  // The image route's own `alt` export must be a static string, so every player
  // card in the product described itself as "Player card · DesiAuction" — a
  // blind recipient in a chat thread was handed a product name where the sighted
  // people in the group could see a person. `og:image:alt` is derived per
  // player, and it is what clients actually announce.
  //
  // `?v=` is the card's version: WhatsApp keeps a preview for days, and without
  // it a player shared while in the pool went on previewing that way after the
  // hammer fell. The route ignores the parameter; the chat's cache does not.
  const poster = await posterView(slug, number);
  const model =
    poster === null
      ? null
      : buildPlayerPoster({
          ...poster.input,
          photoUrl: null,
          teamCrestUrl: null,
          competitionLogoUrl: null,
        });
  const age = player.age !== null ? ` · ${String(player.age)} yrs` : "";
  // The sale is the thing being shared, so the preview's text carries the price
  // too (founder, 2026-09-24) — not only the image.
  const verdict =
    model?.outcome === "sold" && model.priceLabel !== null
      ? `${statusText(player)} for ${model.priceLabel}`
      : statusText(player);
  const description = `${roleLabelIn(sportPackFor(player.sport), player.role)}${age} · ${verdict} · ${player.competitionName}`;
  const imageAlt =
    model !== null
      ? linkCardAlt(model)
      : `${player.name} — ${roleLabelIn(sportPackFor(player.sport), player.role)}, ${statusText(player)}, ${player.competitionName}`;
  const imageUrl =
    poster === null
      ? `${url}/opengraph-image`
      : `${url}/opengraph-image?v=${encodeURIComponent(poster.version)}`;
  const images = [{ url: imageUrl, width: 1200, height: 630, alt: imageAlt }];
  return {
    title: `${player.name} · ${player.competitionName}`,
    description,
    alternates: { canonical: url },
    // Player pages are for sharing by link, not independent search indexing.
    robots: { index: false, follow: true },
    openGraph: {
      title: player.name,
      description,
      url,
      type: "profile",
      siteName: "DesiAuction",
      images,
    },
    twitter: { card: "summary_large_image", title: player.name, description, images },
  };
}

export default async function PlayerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; number: string }>;
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { slug, number } = await params;
  const { ref } = await searchParams;
  const player = await playerView(slug, number);
  if (player === null) {
    notFound();
  }
  // A shared card's `?ref` rides on to registration, as it does from /c/[slug]:
  // a stranger who came in from a Status and signs up is the number that shows
  // whether the card works.
  const refSuffix = typeof ref === "string" && ref !== "" ? `?ref=${encodeURIComponent(ref)}` : "";
  // The words that travel with the link — the same sentence the card draws.
  const poster = await posterView(slug, number);
  const shareModel =
    poster === null
      ? null
      : buildPlayerPoster({
          ...poster.input,
          photoUrl: null,
          teamCrestUrl: null,
          competitionLogoUrl: null,
        });
  const messages =
    shareModel === null
      ? {
          en: `${player.name} — ${player.competitionName}`,
          hi: `${player.name} — ${player.competitionName}`,
        }
      : { en: playerShareMessage(shareModel, "en"), hi: playerShareMessage(shareModel, "hi") };
  // Signed, not sold: a retained player is on a team sheet too, so the neutral
  // "already has a squad" treatment has to cover both.
  const signed = player.status !== "available";
  const status = statusText(player);
  const batting = styleLabel(player.battingStyle);
  const bowling = styleLabel(player.bowlingStyle);
  const roleAge =
    player.age !== null
      ? `${roleLabelIn(sportPackFor(player.sport), player.role)} · ${String(player.age)} yrs`
      : roleLabelIn(sportPackFor(player.sport), player.role);
  /**
   * The detail rows, as a strip of figures rather than a two-column table.
   *
   * The strip used to open with Number and close with Status — both already
   * in the hero, a few centimetres above — while the one figure a shared card
   * is shared FOR, the sale price, appeared nowhere on the page. Team and price
   * lead now; the number and the status stay in the hero where they were.
   */
  const pricePaise = poster?.input.outcome === "sold" ? poster.input.pricePaise : null;
  const facts: Stat[] = [
    ...(player.teamName !== null ? [{ value: player.teamName, label: "Team" }] : []),
    ...(pricePaise !== null && poster !== null
      ? [
          {
            // In the season's own unit (0091): a points league reads "pts".
            value: formatAmount(paise(pricePaise), poster.input.unit),
            label: "Sold for",
          },
        ]
      : []),
    { value: roleLabelIn(sportPackFor(player.sport), player.role), label: "Role" },
    ...(player.age !== null ? [{ value: `${String(player.age)} yrs`, label: "Age" }] : []),
    ...(batting !== null ? [{ value: batting, label: "Batting" }] : []),
    ...(bowling !== null ? [{ value: bowling, label: "Bowling" }] : []),
    // Whatever else this season's sport asks about, already labelled by its
    // pack — see `describeAttributes`. Empty for cricket.
    ...player.attributes.map((attribute) => ({ value: attribute.value, label: attribute.label })),
  ];

  return (
    <main className="public-page mk">
      <PageHero
        sport={player.sport}
        /* The photograph IS the page — it is why the card gets forwarded — so
           it sits in the hero rather than floating alone in a card below it,
           which is where a 1440px-wide title band left it. The consent and
           under-18 gates are upstream, in `publicPlayer`: a `photoUrl` of null
           arrives here already decided and draws the initials portrait. */
        art={
          <div className="player-portrait">
            <PlayerImage
              name={player.name}
              seed={player.registrationId}
              size="hero"
              src={player.photoUrl}
              // The caller sizes the box (see `fluid` in player-image.tsx): at
              // 160px fixed, the portrait sat like a thumbnail in a half-width
              // hero column.
              fluid
              decorative
            />
          </div>
        }
        status={
          <Badge tone={signed ? "neutral" : "success"} data-testid="player-status">
            {status}
          </Badge>
        }
        eyebrow={<Link href={`/c/${slug}`}>{player.competitionName}</Link>}
        title={player.name}
        lede={roleAge}
        meta={<HeroFact>#{player.number}</HeroFact>}
        actions={
          <>
            {player.competitionOpen ? (
              <ButtonLink
                href={`/seasons/${slug}/register${refSuffix}`}
                size="lg"
                data-testid="player-join-cta"
              >
                Register for {player.competitionName}
              </ButtonLink>
            ) : null}
            {/* A signed player's card leads to the squad they are part of. */}
            {player.teamName !== null ? (
              <ButtonLink
                href={`/c/${slug}/t/${teamSlugOf(player.teamName)}`}
                variant="secondary"
                size="lg"
                data-testid="player-team-link"
              >
                See the {player.teamName} squad
              </ButtonLink>
            ) : null}
            <ButtonLink href={`/c/${slug}`} variant="ghost" size="lg">
              <IconArrowLeft size={18} /> Back to {player.competitionName}
            </ButtonLink>
          </>
        }
      />

      <PageBody>
        <StatStrip label={`${player.name} — player details`} stats={facts} />

        {/* The page the OG route calls "the viral unit — a player posts their
            own card" had exactly one action on it: a back link. No way for the
            player to share the thing built to be shared, and no way for the
            stranger who received it to join the tournament they were just shown.
            Both, now, and the CTA only while the door is open. */}
        {/* PI-1: the same person's other published seasons IN THIS ORG — each
            card covered by its own season's publication consent; cross-org
            history never renders publicly (doc 38). */}
        {player.alsoPlayedIn.length > 0 ? (
          <PageSection headingId="also-played-heading" title="Also played in">
            <ul className="player-also-played" data-testid="player-also-played">
              {player.alsoPlayedIn.map((appearance) => (
                <li key={appearance.competitionSlug}>
                  <Link href={`/c/${appearance.competitionSlug}/p/${appearance.playerNumber}`}>
                    {appearance.competitionName}
                  </Link>
                </li>
              ))}
            </ul>
          </PageSection>
        ) : null}

        {/* The actions moved up into the hero, where a visitor who has just
            been handed this card is looking. What stays here is the share
            control itself — the thing the player came back for. */}
        <PageSection headingId="share-heading" title="Share">
          <ShareSheet
            title={player.name}
            surface="player"
            outcome={shareModel?.outcome ?? "none"}
            messages={messages}
            unit={poster?.input.unit ?? "inr"}
            status={{ kind: "player", slug, number }}
          />
        </PageSection>
      </PageBody>
    </main>
  );
}
