import { cache, type CSSProperties } from "react";
import {
  Badge,
  ButtonLink,
  EmptyState,
  IconArrowRight,
  IconCheckCircle,
  IconGavel,
  IconTrophy,
  IconUsers as IconUsersUi,
  VisuallyHidden,
} from "@desiauction/ui";
import { entryCategoryLabel, formatAmount, paise, sportPackFor } from "@desiauction/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import {
  publicCompetitionView,
  publicShowcase,
  myAuctionOutcome,
  publicTopBuys,
  teamSlugOf,
} from "../../../server/competition/public";
import { currentSession } from "../../../server/auth/actions";
import { TopBuysPodium } from "../top-buys";
import { serializeJsonLd } from "../../../server/seo/json-ld";
import { IconCalendar, IconMapPin, IconUsers } from "../../../components/marketing/icons";
import {
  HeroFact,
  PageBody,
  PageHero,
  PageSection,
  StatStrip,
  type Stat,
} from "../../../components/public/public-kit";
import { formatDateRange } from "../format";
import { dateTile, formatDayDate, formatWallTime, istCalendarDate } from "../../../lib/format-date";
import { resultSentence } from "../../reports/reports-model";
import { PublicSeasonReviews } from "../../../components/reviews/season-reviews";
import { ShowcaseGrid } from "./showcase-grid";
import "../../marketing.css";
import "../directory.css";
import "./competition.css";

/**
 * `generateMetadata` and the page both need this read, and Next runs them as
 * two calls in one request — so it was fetched twice per render. React
 * `cache` makes the second a memo hit for the rest of the request (wrapped
 * here, not in the server module, because a "use server" file may only export
 * async functions).
 */
const competitionView = cache(publicCompetitionView);

// PX-5 public competition landing (PX-1 P-06). Renders only what is true and
// public-safe: identity, dates, organizer, teams, the published schedule, and
// the registration door. No phones, no registration lists, no money.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const view = await competitionView(slug);
  if (view === null) {
    return { title: "Season" };
  }
  const description = `${view.orgName}${view.location !== null ? ` · ${view.location}` : ""} · ${formatDateRange(view.startsOn, view.endsOn)}. ${view.open ? "Registration is open — join as a player." : "Run on DesiAuction."}`;
  const url = `${env.PUBLIC_BASE_URL}/c/${view.slug}`;
  return {
    title: view.name,
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

/**
 * The season's name with everything after its first word in gold — the way the
 * mockups set a title, without the page having to guess where to break a name
 * it has never seen. A one-word name stays plain rather than being coloured
 * whole, which would read as a link.
 */
function goldenName(name: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  if (rest.length === 0) {
    return name;
  }
  return (
    <>
      {first} <em>{rest.join(" ")}</em>
    </>
  );
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
  const [view, pool] = await Promise.all([competitionView(slug), publicShowcase(slug)]);
  if (view === null) {
    notFound();
  }
  // THE NIGHT IS OVER. The badge said "Registration closed" the morning after
  // the auction — true, and the least interesting thing about the season —
  // while its own share card already said "Auction complete", and nothing on
  // the page led to the results. Same finished set the share card uses.
  const auctionDone = view.auctionStatus === "completed" || view.auctionStatus === "reconciled";
  const [topBuys, session] = await Promise.all([
    auctionDone ? publicTopBuys(view.slug) : Promise.resolve([]),
    currentSession(),
  ]);
  // A signed-in player who was in the room sees their own result first.
  const mine =
    session === null || view.auctionStatus === null
      ? null
      : await myAuctionOutcome(view.slug, session.personId);
  const myTeam = mine !== null && mine.teamName !== null && mine.outcome !== "pool" ? mine : null;
  const today = istCalendarDate();
  const myNext =
    myTeam === null
      ? undefined
      : view.play.upcoming.find(
          (match) => match.homeName === myTeam.teamName || match.awayName === myTeam.teamName,
        );
  // The directory (`/c`) badges a mid-auction tournament "Live now", promises
  // "No account needed" and links straight to the spectate stage. This page knew
  // only open/closed, so a guest who clicked one of those cards through to here
  // was told "REGISTRATION CLOSED" — the opposite of what they had just read,
  // one click earlier, about the same tournament. Same test the directory uses
  // (`isLive` in server/competition/public.ts): paused is mid-lot, not over, and
  // still watchable.
  const live = view.auctionStatus === "live" || view.auctionStatus === "paused";
  /*
   * THE SEASON'S PHASE (2026-09-28). The page stopped at auction night: a
   * season three matches in, with one being played, still said "Auction
   * complete" and showed only the matches to come. Once a match has been
   * played the page is about the season — the table and the matches lead.
   */
  const play = view.play;
  const matchesAll = play.played + play.live + play.toCome + play.awaiting;
  const finished = play.played > 0 && play.live === 0 && play.toCome === 0 && play.awaiting === 0;
  const seasonOn = !finished && play.played + play.live + play.awaiting > 0;
  const seasonPhase = seasonOn || finished;
  // Once the season card lists the next matches, the full schedule below is
  // only worth its section when it holds more than the card already shows.
  // Under "Matches to come", only matches still to come: a published match
  // whose day has passed unplayed is not one (census 8 — Mon 28 Sep was
  // listed on the 29th).
  const scheduleRows = seasonPhase
    ? view.fixtures.filter(
        (fixture) => fixture.kickoffAt === null || fixture.kickoffAt.slice(0, 10) >= today,
      )
    : view.fixtures;
  const scheduleShown = seasonPhase
    ? scheduleRows.length > play.upcoming.length
    : scheduleRows.length > 0;
  /**
   * THE COUNTS, SAID ONCE.
   *
   * The hero above says who, where and when; this strip says how big. The two
   * do not overlap — the mockup had the team and player counts in both, and a
   * page that states the same number twice invites the reader to check whether
   * they agree.
   *
   * Purse and squad size are the season's published RULES (founder,
   * 2026-09-19). No live amount appears in this strip: not a bid, not what an
   * owner has left. Sold PRICES are public (founder, 2026-09-24 — the team
   * page, the player card and the spectate summary all print them), and after
   * the auction they get a row of their own below: "Top buys".
   */
  const stats: Stat[] = [
    ...(view.teams.length > 0
      ? [
          {
            value: String(view.teams.length),
            label: view.teams.length === 1 ? "Team" : "Teams",
            icon: <IconUsersUi width={18} height={18} />,
          },
        ]
      : []),
    ...(pool !== null && pool.total > 0
      ? [
          {
            value: String(pool.total),
            label: "Approved players",
            icon: <IconUsers />,
          },
        ]
      : []),
    ...(view.pursePerTeam !== null
      ? [
          {
            // In the season's own unit (0091) — a points league shows "pts", never ₹.
            value: formatAmount(view.pursePerTeam, view.auctionUnit),
            label: "Purse per team",
            icon: <IconTrophy width={18} height={18} />,
          },
        ]
      : []),
    ...(view.squadSize !== null
      ? [
          {
            value: String(view.squadSize),
            label: "Squad size",
            icon: <IconGavel width={18} height={18} />,
          },
        ]
      : []),
  ];

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
      <PageHero
        size="compact"
        cover={view.coverUrl === null ? null : { src: view.coverUrl }}
        /* No stock art without a cover: the same bat twelve times across the
           site read as "no content yet". The copy takes the width instead. */
        {...(view.coverUrl === null ? {} : { sport: view.sport })}
        status={
          <>
            {live ? <Badge tone="live">Live now</Badge> : null}
            <Badge
              tone={view.open || seasonOn ? "success" : "neutral"}
              data-testid="public-reg-status"
            >
              {view.open
                ? "Registration open"
                : finished
                  ? "Season complete"
                  : seasonOn
                    ? "Season on"
                    : auctionDone
                      ? "Auction complete"
                      : "Registration closed"}
            </Badge>
            {play.live > 0 ? (
              <Badge tone="live" data-testid="public-match-live">
                Match day · {play.live} live
              </Badge>
            ) : null}
          </>
        }
        title={goldenName(view.name)}
        /* The organizer is SAID here and counted nowhere else. It used to be a
           chip in the hero and a cell in no stat strip; now the hero is where
           a visitor learns whose event this is, in a sentence. */
        lede={<span data-testid="public-org">A community event by {view.orgName}</span>}
        meta={
          <>
            {view.location !== null ? (
              <HeroFact icon={<IconMapPin />}>{view.location}</HeroFact>
            ) : null}
            <HeroFact icon={<IconCalendar />}>
              {formatDateRange(view.startsOn, view.endsOn)}
            </HeroFact>
            {/* PI-1: the category, in words ("Women's tournament"); an Open
                season says nothing rather than announcing the default. */}
            {view.entryCategory !== "open" ? (
              <HeroFact icon={<IconUsers />}>
                <span data-testid="public-category">
                  {entryCategoryLabel(view.entryCategory)} tournament
                </span>
              </HeroFact>
            ) : null}
          </>
        }
        actions={
          <>
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
            {/* THE COMMON STATE HAD NOWHERE TO GO.
                Live gets "Watch"; open gets "Register". Neither is true for a
                closed tournament or a finished one — which is most of the
                lifecycle, and includes every link people keep forwarding after
                the night is over. */}
            {/* After the night, the results lead: the spectate page is the
                summary, the squads and every price, for anyone. */}
            {seasonPhase ? (
              <ButtonLink href="#season-heading" size="lg" data-testid="public-season-cta">
                {play.table !== null ? "See the table" : "See the season"}
              </ButtonLink>
            ) : auctionDone ? (
              <ButtonLink
                href={`/seasons/${view.slug}/auction/spectate`}
                size="lg"
                data-testid="public-results-cta"
              >
                See the auction results
              </ButtonLink>
            ) : null}
            {!live && !view.open && pool !== null && pool.total > 0 ? (
              <ButtonLink
                href="#players-heading"
                size="lg"
                variant={auctionDone ? "secondary" : "primary"}
                data-testid="public-squads-cta"
              >
                See the squads
              </ButtonLink>
            ) : null}
            {/* "All tournaments" left the hero's button row (round 5): the
                header's "Browse tournaments" is the way back, and a third
                action beside the page's two diluted them. */}
            {live ? (
              <p className="public-live-note" data-testid="public-watch-note">
                No account needed — watching is open to anyone.
              </p>
            ) : null}
          </>
        }
      />

      <PageBody>
        {myTeam !== null ? (
          <p className="public-mine" data-testid="public-mine">
            <IconCheckCircle size={20} weight="fill" className="public-mine-icon" />
            <span>
              You&apos;re in <strong>{myTeam.teamName}</strong>
              {myTeam.outcome === "sold" && myTeam.pricePaise !== null ? (
                <>
                  {" "}
                  · sold for{" "}
                  <strong className="public-mine-price">
                    {formatAmount(paise(myTeam.pricePaise), myTeam.unit)}
                  </strong>
                </>
              ) : null}
              {myNext !== undefined ? (
                <>
                  {" "}
                  — next: {whenLabel(myNext.kickoffAt, today)} vs{" "}
                  {myNext.homeName === myTeam.teamName ? myNext.awayName : myNext.homeName}
                </>
              ) : null}
            </span>
            {myTeam.teamSlug !== null ? (
              <Link className="public-mine-link" href={`/c/${view.slug}/t/${myTeam.teamSlug}`}>
                Your squad
                <IconArrowRight size={16} />
              </Link>
            ) : null}
          </p>
        ) : null}
        {seasonPhase ? (
          <PageSection
            headingId="season-heading"
            title="The season"
            lede={
              finished
                ? `All ${String(play.played)} matches played.`
                : `${play.live > 0 ? "Match day — " : ""}${String(play.played)} of ${String(matchesAll)} played.`
            }
          >
            <div className="public-season" data-testid="public-season">
              {play.table !== null ? (
                <section className="public-season-card" aria-labelledby="table-title">
                  <h3 id="table-title" className="public-season-title">
                    The table
                    <span>
                      {finished
                        ? "final"
                        : `after ${String(play.played)} of ${String(matchesAll)} matches`}
                    </span>
                  </h3>
                  <table className="public-table" data-testid="public-table">
                    <thead>
                      <tr>
                        <th scope="col">
                          <VisuallyHidden>Position</VisuallyHidden>
                        </th>
                        <th scope="col">
                          <VisuallyHidden>Team</VisuallyHidden>
                        </th>
                        <th scope="col">
                          <abbr title="Played">P</abbr>
                        </th>
                        <th scope="col">
                          <abbr title="Won">W</abbr>
                        </th>
                        <th scope="col">
                          <abbr title="Lost">L</abbr>
                        </th>
                        <th scope="col">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {play.table.map((row, index) => (
                        <tr key={row.teamId}>
                          <td className="public-table-pos">{index + 1}</td>
                          <th scope="row">
                            <span
                              className="public-table-dot"
                              style={
                                row.color === null
                                  ? undefined
                                  : ({ "--team-color": row.color } as CSSProperties)
                              }
                              aria-hidden
                            />
                            {row.name}
                          </th>
                          <td>{row.played}</td>
                          <td>{row.won}</td>
                          <td>{row.lost}</td>
                          <td className="public-table-pts">{row.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}
              <section className="public-season-card" aria-labelledby="matches-title">
                <h3 id="matches-title" className="public-season-title">
                  Matches
                  <span>
                    {play.played} played
                    {play.live > 0 ? ` · ${String(play.live)} live` : ""}
                    {play.awaiting > 0 ? ` · ${String(play.awaiting)} awaiting a result` : ""}
                    {play.toCome > 0 ? ` · ${String(play.toCome)} to come` : ""}
                  </span>
                </h3>
                <ul className="public-matches" data-testid="public-matches">
                  {play.liveMatches.map((match) => (
                    <li key={match.fixtureId} data-state="live">
                      <span className="public-match-when">Live</span>
                      <span className="public-match-body">
                        <span>
                          <strong>{match.homeName ?? "Lobby"}</strong>
                          {match.awayName !== null ? (
                            <>
                              {" "}
                              vs <strong>{match.awayName}</strong>
                            </>
                          ) : null}
                        </span>
                        <span className="public-match-meta">
                          {match.groundName ?? "Being played now"}
                        </span>
                      </span>
                    </li>
                  ))}
                  {/* Played days with no result yet: said, not dropped (census 9). */}
                  {play.awaitingMatches.map((match) => (
                    <li key={match.fixtureId} data-state="due">
                      <span className="public-match-when">{dayWord(match.kickoffAt, today)}</span>
                      <span className="public-match-body">
                        <span>
                          <strong>{match.homeName ?? "Lobby"}</strong>
                          {match.awayName !== null ? (
                            <>
                              {" "}
                              vs <strong>{match.awayName}</strong>
                            </>
                          ) : null}
                        </span>
                        <span className="public-match-meta">Result to come</span>
                      </span>
                    </li>
                  ))}
                  {play.upcoming.map((match) => (
                    <li key={match.fixtureId} data-state="next">
                      <span className="public-match-when">{dayWord(match.kickoffAt, today)}</span>
                      <span className="public-match-body">
                        <span>
                          <strong>{match.homeName ?? "Lobby"}</strong>
                          {match.awayName !== null ? (
                            <>
                              {" "}
                              vs <strong>{match.awayName}</strong>
                            </>
                          ) : null}
                        </span>
                        <span className="public-match-meta">
                          {[timeOf(match.kickoffAt), match.groundName]
                            .filter((part): part is string => part !== null && part !== "")
                            .join(" · ") || "Time to be announced"}
                        </span>
                      </span>
                    </li>
                  ))}
                  {play.recent.map((match) => {
                    const said = resultSentence(match);
                    return (
                      <li key={match.fixtureId} data-state="done">
                        <span className="public-match-when">{dayWord(match.kickoffAt, today)}</span>
                        <span className="public-match-body">
                          <span>
                            {said.lead !== null ? <strong>{said.lead}</strong> : null}
                            {said.rest}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {scheduleShown ? (
                  <a className="public-season-more" href="#schedule-heading">
                    Every match to come <IconArrowRight size={14} aria-hidden />
                  </a>
                ) : null}
              </section>
            </div>
          </PageSection>
        ) : null}

        {stats.length > 0 ? <StatStrip label={`${view.name} at a glance`} stats={stats} /> : null}

        {/* TOP BUYS — the three sales the season will be remembered by, each
            leading to that player's page. Only once the auction is done, and
            in the season's own unit (a points league never reads "₹"). */}
        {topBuys.length > 0 ? (
          <PageSection headingId="top-buys-heading" title="Top buys">
            <TopBuysPodium
              slug={view.slug}
              buys={topBuys}
              unit={view.auctionUnit}
              testId="public-top-buys"
            />
            {seasonPhase ? (
              <p className="public-hint">
                <Link
                  href={`/seasons/${view.slug}/auction/spectate`}
                  data-testid="public-results-cta"
                >
                  The whole auction, lot by lot
                </Link>
              </p>
            ) : null}
          </PageSection>
        ) : null}

        {/* Instructions for a door that is shut are not instructions, they are a
            trap: this block was unconditional, so a guest on a closed
            tournament was walked through signing in and submitting a
            registration that the page has no way to accept. It renders only
            while registration is actually open. */}
        {view.open ? (
          <PageSection headingId="how-it-works" title="How registration works">
            <p className="public-hint">
              Sign in with your email or mobile number, tell us your name and playing role, and
              submit. The organizer reviews every registration — you can check your status here any
              time. Approved players enter the player pool for the auction, where team owners bid to
              build their squads.
            </p>
          </PageSection>
        ) : null}

        {/* An empty pool is the DEFAULT state of every tournament on its first
            day, and the section used to vanish entirely for it — so the page
            read as though this tournament had no player pool at all, rather
            than one nobody has been approved into yet. The section stays; the
            emptiness gets explained. */}
        {pool === null ? null : (
          <PageSection
            headingId="players-heading"
            title="Teams &amp; players"
            lede={
              view.teams.length > 0
                ? "Every approved player, and the squad each one ended up in."
                : "Every player the organizer has approved into the pool."
            }
            flush
          >
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
              <ShowcaseGrid
                pool={pool}
                slug={view.slug}
                roles={sportPackFor(view.sport).roles.values.map((value) => ({
                  key: value.key,
                  label: value.label,
                }))}
                /* THE SEPARATE "TEAMS" SECTION IS GONE, and this is where it
                   went. It listed each team's colour and crest three sections
                   below the players in it, so the page answered "which teams
                   are in this?" and "who is in this team?" in two places that
                   never referred to each other. The squad cards answer both. */
                teams={view.teams.map((team) => ({
                  id: team.id,
                  name: team.name,
                  primaryColor: team.primaryColor,
                  logoUrl: team.logoUrl,
                  coachName: team.coachName,
                  href: `/c/${view.slug}/t/${teamSlugOf(team.name)}`,
                }))}
              />
            )}
          </PageSection>
        )}

        {scheduleShown ? (
          <PageSection
            headingId="schedule-heading"
            title={seasonPhase ? "Matches to come" : "Published schedule"}
          >
            <ul className="public-fixture-list" data-testid="public-schedule">
              {scheduleRows.map((fixture) => (
                <li key={fixture.number} className="public-fixture">
                  <span className="public-fixture-teams">
                    {/* A lobby has no home and no away, so "vs" is not a
                        sentence about it — it is named by how many squads
                        dropped in. */}
                    {fixture.homeTeamName === null
                      ? `${String(fixture.squadCount)} squads`
                      : `${fixture.homeTeamName} vs ${fixture.awayTeamName ?? "TBA"}`}
                  </span>
                  <span className="public-fixture-when">
                    {fixture.kickoffAt !== null ? whenLabel(fixture.kickoffAt, today) : "TBA"}
                    {fixture.groundName !== null ? ` · ${fixture.groundName}` : ""}
                    {fixture.venueName !== null ? `, ${fixture.venueName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {/* Said only when it is true, and said plainly. A list that stops
                short under a heading reading "Published schedule" tells a
                spectator their match is not scheduled, which is worse than
                telling them the page is showing part of a long one. */}
            {view.fixtureTotal > view.fixtures.length ? (
              <p className="public-hint" data-testid="public-schedule-truncated">
                Showing the first {view.fixtures.length} of {view.fixtureTotal} fixtures. Ask{" "}
                {view.orgName} for the full schedule.
              </p>
            ) : null}
          </PageSection>
        ) : null}

        {/* FR-1: absent until a public season has three published reviews. */}
        <PublicSeasonReviews slug={view.slug} orgName={view.orgName} />

        <p className="public-foot-note" data-testid="public-contact">
          Run by {view.orgName} — reach them through whoever shared this page. About DesiAuction
          itself? <Link href="/help">Help</Link>.
        </p>
      </PageBody>
    </main>
  );
}

/** "Today", "Tomorrow", else "Mon 29" — a match's day in words. */
function dayWord(kickoffAt: string | null, today: string): string {
  if (kickoffAt === null) return "TBA";
  const day = kickoffAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "TBA";
  if (day === today) return "Today";
  if (day === tomorrowOf(today)) return "Tomorrow";
  const tile = dateTile(day);
  return `${tile.day} ${tile.month}`;
}

/** "9:30 am", or null when the kickoff carries no time. */
function timeOf(kickoffAt: string | null): string | null {
  if (kickoffAt === null || kickoffAt.length <= 10) return null;
  return formatWallTime(kickoffAt.replace(" ", "T").slice(0, 16));
}

/** "Today · 9:30 am", "Mon, 29 Sep · 2:30 pm" — never the raw "2026-09-29 14:30". */
function whenLabel(kickoffAt: string | null, today: string): string {
  if (kickoffAt === null) return "Date to be announced";
  const day = kickoffAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return kickoffAt;
  const date =
    day === today ? "Today" : day === tomorrowOf(today) ? "Tomorrow" : formatDayDate(day);
  const time = timeOf(kickoffAt);
  return time === null ? date : `${date} · ${time}`;
}

function tomorrowOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
