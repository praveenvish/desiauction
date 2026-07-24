import { roleLabel, styleLabel } from "@desiauction/core";
import { Badge, ButtonLink, PlayerImage } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../../../env";
import { publicPlayer } from "../../../../../server/competition/public";
import "../../../../marketing.css";
import "../../../directory.css";

// Public single-player profile (parity §Phase 2). The routable, link-shareable
// surface behind the player OG card — the client showcase dialog is not
// addressable. Same consent + visibility gates as the showcase. Individual
// pages are `noindex` (link-shared, not SEO-farmed); the photo is consent-gated.

function statusText(player: {
  status: "available" | "sold" | "retained";
  teamName: string | null;
}): string {
  if (player.status !== "sold") {
    return "Available";
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
  const description = `${roleLabel(player.role)}${age} · ${statusText(player)} · ${player.competitionName}`;
  const url = `${env.PUBLIC_BASE_URL}/c/${slug}/p/${number}`;
  return {
    title: `${player.name} · ${player.competitionName}`,
    description,
    alternates: { canonical: url },
    // Player pages are for sharing by link, not independent search indexing.
    robots: { index: false, follow: true },
    openGraph: { title: player.name, description, url, type: "profile", siteName: "DesiAuction" },
    twitter: { card: "summary_large_image", title: player.name, description },
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
  const sold = player.status === "sold";
  const batting = styleLabel(player.battingStyle);
  const bowling = styleLabel(player.bowlingStyle);
  const roleAge =
    player.age !== null
      ? `${roleLabel(player.role)} · ${String(player.age)} yrs`
      : roleLabel(player.role);
  return (
    <main className="public-page mk">
      <header className="public-hero" data-theme="floodlight">
        <div className="mk-container public-hero-inner">
          <Badge tone={sold ? "neutral" : "success"} data-testid="player-status">
            {sold ? (player.teamName ?? "Sold") : "Available"}
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
              <dd>{roleLabel(player.role)}</dd>
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
              <dd>{sold ? (player.teamName ?? "Sold") : "Available"}</dd>
            </dl>
          </div>
        </section>

        <section className="public-section">
          <div className="public-cta-row">
            <ButtonLink href={`/c/${slug}`} variant="ghost" size="lg">
              ← Back to {player.competitionName}
            </ButtonLink>
          </div>
        </section>
      </div>
    </main>
  );
}
