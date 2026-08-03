import { Badge, ButtonLink, EmptyState } from "@desiauction/ui";
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
import "./competition.css";

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
    return { title: "Season · DesiAuction" };
  }
  const description = `${view.orgName}${view.location !== null ? ` · ${view.location}` : ""} · ${formatDateRange(view.startsOn, view.endsOn)}. ${view.open ? "Registration is open — join as a player." : "Run on DesiAuction."}`;
  const url = `${env.PUBLIC_BASE_URL}/c/${view.slug}`;
  return {
    title: `${view.name} · DesiAuction`,
    description,
    alternates: { canonical: url },
    // This view only exists for a published competition, so `listed` is always
    // true here; the test stays as the statement of WHY the page is indexable.
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
  const [view, pool] = await Promise.all([publicCompetitionView(slug), publicShowcase(slug)]);
  if (view === null) {
    notFound();
  }
  // The directory (`/c`) badges a mid-auction tournament "Live now", promises
  // "No account needed" and links straight to the spectate stage. This page knew
  // only open/closed, so a guest who clicked one of those cards through to here
  // was told "REGISTRATION CLOSED" — the opposite of what they had just read,
  // one click earlier, about the same tournament. Same test the directory uses
  // (`isLive` in server/competition/public.ts): paused is mid-lot, not over, and
  // still watchable.
  const live = view.auctionStatus === "live" || view.auctionStatus === "paused";
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
          <span className="public-hero-badges">
            {live ? <Badge tone="live">Live now</Badge> : null}
            <Badge tone={view.open ? "success" : "neutral"} data-testid="public-reg-status">
              {view.open ? "Registration open" : "Registration closed"}
            </Badge>
          </span>
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
            {live ? (
              <ButtonLink
                href={`/seasons/${view.slug}/auction/spectate`}
                size="lg"
                data-testid="public-watch-cta"
              >
                Watch the auction live
              </ButtonLink>
            ) : null}
            {view.open ? (
              <ButtonLink
                href={`/seasons/${view.slug}/register${refSuffix}`}
                size="lg"
                data-testid="public-register-cta"
              >
                Register as a player
              </ButtonLink>
            ) : null}
            <ButtonLink href="/c" variant="ghost" size="lg">
              All seasons
            </ButtonLink>
          </div>
          {live ? (
            <p className="public-live-note" data-testid="public-watch-note">
              No account needed — watching is open to anyone.
            </p>
          ) : null}
        </div>
      </header>

      <div className="mk-container public-sections">
        {/* Instructions for a door that is shut are not instructions, they are a
            trap: this block was unconditional, so a guest on a closed
            tournament was walked through signing in and submitting a
            registration that the page has no way to accept. It renders only
            while registration is actually open. */}
        {view.open ? (
          <section className="public-section" aria-labelledby="how-it-works">
            <h2 id="how-it-works">How registration works</h2>
            <p className="public-hint">
              Sign in with your mobile number, tell us your name and playing role, and submit. The
              organizer reviews every registration — you can check your status here any time.
              Approved players enter the player pool for the auction, where team owners bid to build
              their squads.
            </p>
          </section>
        ) : null}

        {/* An empty pool is the DEFAULT state of every tournament on its first
            day, and the section used to vanish entirely for it — so the page
            read as though this tournament had no player pool at all, rather
            than one nobody has been approved into yet. The section stays; the
            emptiness gets explained. */}
        {pool === null ? null : (
          <section className="public-section" aria-labelledby="players-heading">
            <h2 id="players-heading">Players</h2>
            {pool.total === 0 ? (
              <EmptyState
                data-testid="public-players-empty"
                title="No players in the pool yet"
                description={
                  view.open
                    ? "Every registration is reviewed by the organizer before the player appears here. Register now and you could be the first."
                    : "Registration is closed for this tournament, and the organizer has not approved any players into the pool."
                }
                {...(view.open
                  ? {
                      action: (
                        <ButtonLink href={`/seasons/${view.slug}/register${refSuffix}`}>
                          Register as a player
                        </ButtonLink>
                      ),
                    }
                  : {})}
              />
            ) : (
              // The whole pool object, not just the rows: the grid's counts,
              // filters and CSV are all computed over what was LOADED, and
              // `total`/`truncated` are what stop those numbers being read as
              // claims about the tournament.
              <ShowcaseGrid pool={pool} slug={view.slug} />
            )}
          </section>
        )}

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
