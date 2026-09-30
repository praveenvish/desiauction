import { ButtonLink } from "@desiauction/ui";
import { sportPack, type SportPack } from "@desiauction/core";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import { SPORT_PAGES, TIEBREAKER_WORDS, sportPage } from "../../../content/sports";
import { START_CLUB_LOGIN } from "../../../lib/start-intent";
import { publicCompetitionsDirectory } from "../../../server/competition/public";
import { breadcrumbJsonLd, faqPageJsonLd } from "../../../server/seo/json-ld";
import { JsonLd } from "../../../components/seo/json-ld";
import { PageBody, PageHero, PageSection } from "../../../components/public/public-kit";
import { TournamentCard, TournamentGrid } from "../../../components/public/tournament-card";
import { formatDateRange } from "../../c/format";
import "../../content.css";
import "../../marketing.css";
import "../sports.css";

export function generateStaticParams() {
  return SPORT_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = sportPage(slug);
  if (page === undefined) return { title: "Sports" };
  const url = `${env.PUBLIC_BASE_URL}/sports/${page.slug}`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: { title: page.headline, description: page.description, url, type: "website" },
  };
}

/** "2 for a win, 1 for a tie or no result" — from the pack, never typed. */
function pointsSentence(pack: SportPack): string {
  const { win, tie, loss, noResult } = pack.standings.points;
  const fixture = pack.terms.fixture.toLowerCase();
  const parts = [`${String(win)} for a win`];
  if (tie === noResult && tie > 0) parts.push(`${String(tie)} for a tie or no result`);
  else {
    if (tie > 0) parts.push(`${String(tie)} for a tie`);
    if (noResult > 0) parts.push(`${String(noResult)} for no result`);
  }
  if (loss > 0) parts.push(`${String(loss)} for a loss`);
  return `Each ${fixture} earns ${parts.join(", ")}.`;
}

/** "a, b and c", the way a sentence lists things. */
function listed(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

function tiebreakSentence(pack: SportPack): string {
  const words = pack.standings.tiebreakers.map((tb) => TIEBREAKER_WORDS[tb.key] ?? tb.label);
  if (words.length === 0) return "";
  const list =
    words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")}, then ${words.at(-1) ?? ""}`;
  // A lobby ranks squads, not two teams (battle royale).
  const sides = pack.standings.lobby === undefined ? "Teams" : "Squads";
  return `${sides} level on points are separated by ${list ?? ""}.`;
}

/** What an organizer types after a match: the ENTRY label (cricket keeps balls, is scored in overs). */
function enteredFields(pack: SportPack): string {
  return listed(
    pack.result.scoreFields.map((field) => (field.entry?.label ?? field.label).toLowerCase()),
  );
}

/** The lobby table (battle royale): placement points plus a point per score. */
function lobbySentence(pack: SportPack): string | null {
  const lobby = pack.standings.lobby;
  if (lobby === undefined) return null;
  const scoring = lobby.placement.filter((points) => points > 0);
  const per = Object.entries(lobby.perScore ?? {})
    .map(([field, points]) => {
      const label = pack.result.scoreFields.find((spec) => spec.key === field)?.label ?? field;
      return `${String(points)} per ${label.toLowerCase().replace(/s$/, "")}`;
    })
    .join(" and ");
  return `Each lobby pays by placement — ${scoring.join(", ")} from first place down — plus ${per}.`;
}

/**
 * `/sports/[slug]` (SEO-1 Phase 4). Written words from content/sports.ts; the
 * facts — roles, player attributes, how the table scores — straight from the
 * sport pack that runs the season, so the page cannot disagree with the engine.
 */
export default async function SportPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = sportPage(slug);
  const pack = page === undefined ? null : sportPack(page.sport);
  if (page === undefined || pack === null) {
    notFound();
  }
  const base = env.PUBLIC_BASE_URL;
  const directory = await publicCompetitionsDirectory({ sport: pack.key, sort: "opportunity" });
  const seasons = directory.entries.slice(0, 6);
  const lobby = lobbySentence(pack);
  const squad = pack.terms.squad.toLowerCase();

  return (
    <main className="public-page mk sport-page">
      <JsonLd
        data={[
          faqPageJsonLd(page.faqs),
          breadcrumbJsonLd(base, [
            { name: "Sports", path: "/sports" },
            { name: pack.label, path: `/sports/${page.slug}` },
          ]),
        ]}
      />
      <PageHero
        eyebrow={
          <Link href="/sports" className="sport-crumb">
            Sports · {pack.label}
          </Link>
        }
        title={page.headline}
        lede={page.lede}
        sport={pack.key}
        actions={
          <>
            <ButtonLink href={START_CLUB_LOGIN} variant="primary" size="lg">
              Start your {pack.label.toLowerCase()} tournament
            </ButtonLink>
            <ButtonLink href="/schedule-demo" variant="secondary" size="lg">
              Book a demo
            </ButtonLink>
          </>
        }
      />
      <PageBody>
        <PageSection
          headingId="sport-angles"
          title={`What a ${pack.label.toLowerCase()} auction needs`}
        >
          <ul className="sport-angles">
            {page.angles.map((angle) => (
              <li key={angle.title} className="sport-angle">
                <h3>{angle.title}</h3>
                <p>{angle.body}</p>
              </li>
            ))}
          </ul>
        </PageSection>

        <PageSection
          headingId="sport-form"
          title="The registration form speaks your sport"
          lede={`Players choose from these when they register, and it shows on their card in the auction.`}
        >
          <dl className="sport-facts">
            <div>
              <dt>Roles</dt>
              <dd>
                <ul className="sport-chips">
                  {pack.roles.values.map((role) => (
                    <li key={role.key}>{role.label}</li>
                  ))}
                </ul>
              </dd>
            </div>
            {pack.attributes.map((attribute) => (
              <div key={attribute.key}>
                <dt>{attribute.label}</dt>
                <dd>
                  <ul className="sport-chips">
                    {attribute.options.map((option) => (
                      <li key={option.key}>{option.label}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
        </PageSection>

        <PageSection headingId="sport-table" title="The table keeps itself">
          <div className="sport-table-rules">
            <p>
              {lobby ?? pointsSentence(pack)} {tiebreakSentence(pack)}
            </p>
            <p>
              You enter {enteredFields(pack)} after each {pack.terms.fixture.toLowerCase()}; the
              standings, the public season page and every {squad}&apos;s record update from that one
              entry.
            </p>
          </div>
        </PageSection>

        <PageSection headingId="sport-night" title="Auction night, on every screen">
          <div className="sport-night">
            <figure className="sport-shot sport-shot--board">
              <Image
                src="/marketing/product/auction-board-v2.webp"
                alt="The big-screen board of a live auction: money spent, the most expensive player, and each team's remaining purse and squad"
                width={1600}
                height={900}
                sizes="(max-width: 999px) 100vw, 640px"
              />
              <figcaption>The board the room watches.</figcaption>
            </figure>
            <figure className="sport-shot sport-shot--phone">
              <Image
                src="/marketing/product/owner-phone-bidding-v2.webp"
                alt="A team owner's phone during the auction, showing the player on the block, the current bid and the bid button"
                width={560}
                height={1212}
                sizes="(max-width: 999px) 50vw, 220px"
              />
              <figcaption>Each owner bids from their own phone.</figcaption>
            </figure>
          </div>
          <p className="sport-night-note">
            Real screens from a practice auction. The same bid reaches the board and every phone at
            once, and anyone with the link can watch without signing in.
          </p>
        </PageSection>

        {seasons.length > 0 ? (
          <PageSection
            headingId="sport-seasons"
            title={`${pack.label} tournaments on DesiAuction`}
            action={
              <Link href="/c" className="prose-link">
                All tournaments
              </Link>
            }
          >
            <TournamentGrid testId="sport-seasons">
              {seasons.map((entry) => (
                <TournamentCard
                  key={entry.slug}
                  tournament={{
                    name: entry.name,
                    slug: entry.slug,
                    orgName: entry.orgName,
                    sport: entry.sport,
                    location: entry.location,
                    dates: formatDateRange(entry.startsOn, entry.endsOn),
                    open: entry.open,
                    live: entry.live,
                    teamCount: entry.teamCount,
                    playerCount: entry.playerCount,
                    logoUrl: entry.logoUrl,
                    coverUrl: entry.coverUrl,
                    entryCategory: entry.entryCategory,
                  }}
                />
              ))}
            </TournamentGrid>
          </PageSection>
        ) : null}

        <PageSection headingId="sport-faq" title="Questions organizers ask">
          <div className="content-section">
            {page.faqs.map((faq) => (
              <details key={faq.question} className="faq-item">
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
          <p className="sport-guides">
            Step-by-step guides: <Link href="/help/competition-setup">setting up a season</Link>,{" "}
            <Link href="/help/google-form-import">importing a Google Form</Link>,{" "}
            <Link href="/help/auction-setup">preparing the auction</Link> and{" "}
            <Link href="/help/conducting-the-auction">running the room</Link>.
          </p>
        </PageSection>
      </PageBody>
    </main>
  );
}
