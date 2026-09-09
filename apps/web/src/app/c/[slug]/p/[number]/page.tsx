import { roleLabelIn, sportPackFor, styleLabel } from "@desiauction/core";
import { Badge, ButtonLink, PlayerImage } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../../../env";
import { publicPlayer } from "../../../../../server/competition/public";
import { SharePlayer } from "./share-player";
import "../../../../marketing.css";
import "../../../directory.css";

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
    return player.teamName !== null
      ? `Icon player for ${player.teamName}`
      : "Icon player — not in the auction";
  }
  return player.teamName !== null ? `Sold to ${player.teamName}` : "Sold";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}): Promise<Metadata> {
  const { slug, number } = await params;
  const player = await publicPlayer(slug, number);
  if (player === null) {
    return { title: "Player · DesiAuction" };
  }
  const age = player.age !== null ? ` · ${String(player.age)} yrs` : "";
  const description = `${roleLabelIn(sportPackFor(player.sport), player.role)}${age} · ${statusText(player)} · ${player.competitionName}`;
  const url = `${env.PUBLIC_BASE_URL}/c/${slug}/p/${number}`;
  // The image route's own `alt` export must be a static string, so every player
  // card in the product described itself as "Player card · DesiAuction" — a
  // blind recipient in a chat thread was handed a product name where the sighted
  // people in the group could see a person. `og:image:alt` is derived per
  // player, and it is what clients actually announce.
  const imageAlt = `${player.name} — ${roleLabelIn(sportPackFor(player.sport), player.role)}, ${statusText(player)}, ${player.competitionName}`;
  const images = [{ url: `${url}/opengraph-image`, width: 1200, height: 630, alt: imageAlt }];
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
}: {
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number } = await params;
  const player = await publicPlayer(slug, number);
  if (player === null) {
    notFound();
  }
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
  return (
    <main className="public-page mk">
      <header className="public-hero" data-theme="floodlight">
        <div className="mk-container public-hero-inner">
          <Badge tone={signed ? "neutral" : "success"} data-testid="player-status">
            {status}
          </Badge>
          <h1>{player.name}</h1>
          <div className="public-hero-meta">
            <span>#{player.number}</span>
            <span>{roleAge}</span>
            <span>
              <Link href={`/c/${slug}`}>{player.competitionName}</Link>
            </span>
          </div>
        </div>
      </header>

      <div className="mk-container public-sections">
        <section className="public-section" aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="visually-hidden">
            Player profile
          </h2>
          <div className="showcase-detail">
            <PlayerImage
              name={player.name}
              seed={player.number}
              size="hero"
              {...(player.photoUrl !== null ? { src: player.photoUrl } : {})}
            />
            <dl className="showcase-detail-meta">
              <dt>Number</dt>
              <dd>{player.number}</dd>
              <dt>Role</dt>
              <dd>{roleLabelIn(sportPackFor(player.sport), player.role)}</dd>
              {player.age !== null ? (
                <>
                  <dt>Age</dt>
                  <dd>{player.age} yrs</dd>
                </>
              ) : null}
              {batting !== null ? (
                <>
                  <dt>Batting</dt>
                  <dd>{batting}</dd>
                </>
              ) : null}
              {bowling !== null ? (
                <>
                  <dt>Bowling</dt>
                  <dd>{bowling}</dd>
                </>
              ) : null}
              <dt>Status</dt>
              <dd>{status}</dd>
            </dl>
          </div>
        </section>

        {/* The page the OG route calls "the viral unit — a player posts their
            own card" had exactly one action on it: a back link. No way for the
            player to share the thing built to be shared, and no way for the
            stranger who received it to join the tournament they were just shown.
            Both, now, and the CTA only while the door is open. */}
        {/* PI-1: the same person's other published seasons IN THIS ORG — each
            card covered by its own season's publication consent; cross-org
            history never renders publicly (doc 38). */}
        {player.alsoPlayedIn.length > 0 ? (
          <section className="public-section" aria-labelledby="also-played-heading">
            <h2 id="also-played-heading">Also played in</h2>
            <ul className="player-also-played" data-testid="player-also-played">
              {player.alsoPlayedIn.map((appearance) => (
                <li key={appearance.competitionSlug}>
                  <Link href={`/c/${appearance.competitionSlug}/p/${appearance.playerNumber}`}>
                    {appearance.competitionName}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="public-section" aria-labelledby="share-heading">
          <h2 id="share-heading" className="visually-hidden">
            Share and register
          </h2>
          <SharePlayer playerName={player.name} />
          <div className="public-cta-row">
            {player.competitionOpen ? (
              <ButtonLink
                href={`/seasons/${slug}/register`}
                size="lg"
                data-testid="player-join-cta"
              >
                Register for {player.competitionName}
              </ButtonLink>
            ) : null}
            <ButtonLink href={`/c/${slug}`} variant="ghost" size="lg">
              ← Back to {player.competitionName}
            </ButtonLink>
          </div>
        </section>
      </div>
    </main>
  );
}
