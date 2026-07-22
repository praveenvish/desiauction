import { Badge, ButtonLink } from "@desiauction/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import { publicCompetitionView, publicShowcase } from "../../../server/competition/public";
import { serializeJsonLd } from "../../../server/seo/json-ld";
import { IconCalendar, IconMapPin, IconUsers } from "../../../components/marketing/icons";
import { formatDateRange } from "../format";
import { ShowcaseGrid } from "./showcase-grid";
import "../../marketing.css";
import "../directory.css";

// PX-5 public competition landing (PX-1 P-06). Renders only what is true and
// public-safe: identity, dates, organizer, teams, the published schedule, and
// the registration door. No phones, no registration lists, no money.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const view = await publicCompetitionView(slug);
  if (view === null) {
    return { title: "Competition · DesiAuction" };
  }
  const description = `${view.orgName}${view.location !== null ? ` · ${view.location}` : ""} · ${formatDateRange(view.startsOn, view.endsOn)}. ${view.open ? "Registration is open — join as a player." : "Run on DesiAuction."}`;
  const url = `${env.PUBLIC_BASE_URL}/c/${view.slug}`;
  return {
    title: `${view.name} · DesiAuction`,
    description,
    alternates: { canonical: url },
    // Unlisted-but-open pages work by link; only published pages invite indexing.
    robots: view.listed ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: view.name, description, url, type: "website", siteName: "DesiAuction" },
    // The `opengraph-image` / `twitter-image` routes inject the card image; the
    // large card lets it render full-bleed instead of a thumbnail.
    twitter: { card: "summary_large_image", title: view.name, description },
  };
}

export default async function PublicCompetitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;
  // Carry a shared link's `?ref` through to registration for attribution.
  const refSuffix = typeof ref === "string" && ref !== "" ? `?ref=${encodeURIComponent(ref)}` : "";
  const [view, players] = await Promise.all([publicCompetitionView(slug), publicShowcase(slug)]);
  if (view === null) {
    notFound();
  }
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: view.name,
    ...(view.startsOn !== null ? { startDate: view.startsOn } : {}),
    ...(view.endsOn !== null ? { endDate: view.endsOn } : {}),
    ...(view.location !== null ? { location: { "@type": "Place", name: view.location } } : {}),
    organizer: { "@type": "Organization", name: view.orgName },
    url: `${env.PUBLIC_BASE_URL}/c/${view.slug}`,
  };
  return (
    <main className="public-page mk">
      <script
        type="application/ld+json"
        // Structured data for search engines (PX-5 SEO scope). PX-11 F2: the
        // payload carries organizer-controlled names, so it is HTML-escaped for
        // the <script> context (serializeJsonLd) — a raw JSON.stringify here is
        // a stored-XSS breakout.
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <header className="public-hero" data-theme="floodlight">
        <div className="mk-container public-hero-inner">
          <Badge tone={view.open ? "success" : "neutral"} data-testid="public-reg-status">
            {view.open ? "Registration open" : "Registration closed"}
          </Badge>
          <h1>{view.name}</h1>
          <div className="public-hero-meta">
            <span data-testid="public-org">
              <IconUsers />
              Organized by {view.orgName}
            </span>
            {view.location !== null ? (
              <span>
                <IconMapPin />
                {view.location}
              </span>
            ) : null}
            <span>
              <IconCalendar />
              {formatDateRange(view.startsOn, view.endsOn)}
            </span>
          </div>
          <div className="public-cta-row">
            {view.auctionStatus === "live" || view.auctionStatus === "paused" ? (
              <ButtonLink
                href={`/competitions/${view.slug}/auction/spectate`}
                size="lg"
                data-testid="public-watch-cta"
              >
                Watch the auction live
              </ButtonLink>
            ) : null}
            {view.open ? (
              <ButtonLink
                href={`/competitions/${view.slug}/register${refSuffix}`}
                size="lg"
                data-testid="public-register-cta"
              >
                Register as a player
              </ButtonLink>
            ) : null}
            <ButtonLink href="/c" variant="ghost" size="lg">
              All competitions
            </ButtonLink>
          </div>
        </div>
      </header>

      <div className="mk-container public-sections">
        <section className="public-section" aria-labelledby="how-it-works">
          <h2 id="how-it-works">How registration works</h2>
          <p className="public-hint">
            Sign in with your mobile number, tell us your name and playing role, and submit. The
            organizer reviews every registration — you can check your status here any time. Approved
            players enter the player pool for the auction, where team owners bid to build their
            squads.
          </p>
        </section>

        {players !== null && players.length > 0 ? (
          <section className="public-section" aria-labelledby="players-heading">
            <h2 id="players-heading">Players</h2>
            <ShowcaseGrid players={players} slug={view.slug} />
          </section>
        ) : null}

        {view.teams.length > 0 ? (
          <section className="public-section" aria-labelledby="teams-heading">
            <h2 id="teams-heading">Teams</h2>
            <ul className="public-team-list" data-testid="public-teams">
              {view.teams.map((team) => (
                <li key={team.id} className="public-team">
                  {team.logoUrl !== null ? (
                    <img
                      className="public-team-crest"
                      src={team.logoUrl}
                      alt=""
                      width={28}
                      height={28}
                      loading="lazy"
                    />
                  ) : (
                    <span
                      className="public-team-swatch"
                      style={{ background: team.primaryColor ?? "var(--accent)" }}
                      aria-hidden
                    />
                  )}
                  {team.name}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {view.fixtures.length > 0 ? (
          <section className="public-section" aria-labelledby="schedule-heading">
            <h2 id="schedule-heading">Published schedule</h2>
            <ul className="public-fixture-list" data-testid="public-schedule">
              {view.fixtures.map((fixture) => (
                <li key={fixture.number} className="public-fixture">
                  <span className="public-fixture-teams">
                    {fixture.homeTeamName} vs {fixture.awayTeamName}
                  </span>
                  <span className="public-fixture-when">
                    {fixture.kickoffAt !== null ? fixture.kickoffAt.replace("T", " ") : "TBA"}
                    {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
                    {fixture.venueName !== null ? `, ${fixture.venueName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="public-section" aria-labelledby="contact-heading">
          <h2 id="contact-heading">Questions?</h2>
          <p className="public-hint">
            This competition is run by {view.orgName} — reach them through whoever shared this page
            with you. For anything about the DesiAuction platform itself, see{" "}
            <Link href="/help">Help</Link>.
          </p>
        </section>
      </div>
    </main>
  );
}
