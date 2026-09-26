import { SPORTS, sportPackFor } from "@desiauction/core";
import {
  HeroBanner,
  IconArrowRight,
  IconCalendar,
  IconChart,
  IconGavel,
  IconMatch,
  IconPin,
  IconShieldCheck,
  IconTrophy,
  IconUsers,
  Notice,
  Pill,
  PlayerImage,
  SectionCard,
  StatCard,
  StatGrid,
  TeamChip,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeroChip, HeroStatus } from "../../components/season-hero/season-hero";
import { moneyFormat } from "../../lib/money";
import { currentSession } from "../../server/auth/actions";
import {
  playerCareer,
  playerMatches,
  playerUpcomingMatches,
  type CareerMatch,
} from "../../server/player/career";
import { ownPhotoUrl, playerProfileFor, profileCompletenessFor } from "../../server/player/profile";
import { rolesOf, type OwnedTeam } from "../../server/roles/roles";
import { RegistrationCard } from "./registration-card";
import "./me.css";

export const metadata = { title: "My sports · DesiAuction" };

/**
 * MY SPORTS — every tournament, match and sport, in one place (launch polish,
 * Phase 3). The founder's ask, verbatim: "what all tournaments they have
 * played, what all matches they have played, which all sports they have
 * played". The career used to live one sport per page with no index, and had
 * no matches at all — results were per team. Matches now come from lineups
 * (0074), with "didn't play" and "not recorded" kept apart.
 *
 * Self view only: the person id is the session's, never a parameter.
 */

const RESULT_LABEL: Record<NonNullable<CareerMatch["result"]>, string> = {
  won: "Won",
  lost: "Lost",
  tied: "Tied",
  no_result: "No result",
};

const RESULT_TONE: Record<NonNullable<CareerMatch["result"]>, KitTone> = {
  won: "green",
  lost: "red",
  tied: "amber",
  no_result: "neutral",
};

const PLAYED_LABEL: Record<CareerMatch["played"], string> = {
  played: "Played",
  bench: "In the squad",
  unknown: "Not recorded",
};

function matchDate(kickoffAt: string | null): string {
  if (kickoffAt === null) return "—";
  const d = new Date(`${kickoffAt.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? kickoffAt.slice(0, 10)
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** "Sat 27 Sept · 4:30 pm" from the fixture's local wall-clock text. */
function kickoffLabel(kickoffAt: string | null): string {
  if (kickoffAt === null) return "Time to be announced";
  const d = new Date(kickoffAt.length > 10 ? kickoffAt : `${kickoffAt}T00:00`);
  if (Number.isNaN(d.getTime())) return kickoffAt;
  const day = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return kickoffAt.length > 10
    ? `${day} · ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}`
    : day;
}

function seasonYear(startsOn: string | null): string {
  return startsOn === null ? "—" : startsOn.slice(0, 4);
}

export default async function MySportsPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/me");
  }
  if (session.name === null || session.name.trim() === "") {
    redirect("/onboarding");
  }
  // Today in IST — fixture kickoffs are local wall-clock text.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [query, career, matches, upcomingMatches, profile, completeness, photoUrl, roles] =
    await Promise.all([
      searchParams,
      playerCareer(session.personId),
      playerMatches(session.personId),
      playerUpcomingMatches(session.personId, today),
      playerProfileFor(session.personId),
      profileCompletenessFor(session.personId),
      ownPhotoUrl(session.personId),
      rolesOf(session.personId),
    ]);
  const owns = roles.owns;

  // Sports this person actually played, in the platform's own order.
  const played = new Set(career.seasons.map((season) => season.sport));
  const sports = SPORTS.filter((pack) => played.has(pack.key));
  const filter = sports.some((pack) => pack.key === query.sport) ? query.sport : undefined;
  const seasons = career.seasons
    .filter((season) => filter === undefined || season.sport === filter)
    .slice()
    .reverse();
  const shownMatches = matches.filter((match) => filter === undefined || match.sport === filter);
  const shownUpcoming = upcomingMatches.filter(
    (match) => filter === undefined || match.sport === filter,
  );
  const matchesPlayed = matches.filter((match) => match.played === "played").length;
  const wins = matches.filter(
    (match) => match.played === "played" && match.result === "won",
  ).length;
  const auctioned = career.seasons.filter((season) => season.auction !== null).length;

  const bySport = sports.map((pack) => ({
    key: pack.key,
    label: pack.label,
    seasons: career.seasons.filter((season) => season.sport === pack.key).length,
    matches: matches.filter((match) => match.sport === pack.key && match.played === "played")
      .length,
  }));
  const maxSeasons = Math.max(1, ...bySport.map((row) => row.seasons));

  // The one contained surface: what is coming, if anything is.
  const waiting = career.seasons.find((season) => season.status === "submitted");
  const inPool = career.seasons.find(
    (season) => season.status === "approved" && season.auction === null && season.teamName === null,
  );
  const upcoming = waiting ?? inPool;

  return (
    <main className="me">
      {/* Their own face when they have uploaded one; the branded initials mark
          (C-25) until then — the same mark every season surface shows. */}
      <HeroBanner
        testId="me-hero"
        crest={
          <span className="me-crest-photo">
            <PlayerImage
              name={session.name}
              seed={session.personId}
              src={photoUrl}
              size="lg"
              fluid
              decorative
            />
          </span>
        }
        // "Player" only for somebody who has played: an owner with no seasons
        // was badged as one above four zeros.
        {...(career.totals.seasons > 0 ? { eyebrow: <HeroStatus>Player</HeroStatus> } : {})}
        title={session.name}
        meta={[
          ...(profile.location !== null && profile.location !== ""
            ? [
                <>
                  <IconPin />
                  {profile.location}
                </>,
              ]
            : []),
          ...(sports.length > 0
            ? sports.map((pack) => <HeroChip key={pack.key}>{pack.label}</HeroChip>)
            : owns.length > 0
              ? // A team owner's record is the team: said as a fact, not an absence.
                owns.map((team) => (
                  <HeroChip key={`${team.auctionId}:${team.teamId}`}>
                    Owner · {team.teamName}
                  </HeroChip>
                ))
              : [<>Your playing record starts with your first registration.</>]),
        ]}
        actions={
          <Link href="/account" className="sh-ghost">
            {completeness.done < completeness.total
              ? `Profile ${String(completeness.done)} of ${String(completeness.total)} — finish it`
              : "Edit profile"}
            <IconArrowRight size={14} />
          </Link>
        }
        sideAlign="start"
      />

      {/* No tiles of zeros for somebody who has not played yet — the hero
          already says the record starts with the first tournament. */}
      {career.totals.seasons === 0 && matchesPlayed === 0 ? null : (
        <StatGrid testId="me-figures">
          <StatCard
            icon={<IconTrophy />}
            tone="gold"
            value={career.totals.seasons.toLocaleString("en-IN")}
            label={career.totals.seasons === 1 ? "Season" : "Seasons"}
            hint={
              sports.length > 0
                ? `${String(sports.length)} ${sports.length === 1 ? "sport" : "sports"}`
                : "None entered yet"
            }
          />
          <StatCard
            icon={<IconMatch />}
            tone="gold"
            value={matchesPlayed.toLocaleString("en-IN")}
            label="Matches played"
            hint={matchesPlayed > 0 ? `${String(wins)} won` : "From recorded lineups"}
          />
          <StatCard
            icon={<IconUsers />}
            tone="gold"
            value={career.totals.teams.toLocaleString("en-IN")}
            label={career.totals.teams === 1 ? "Team" : "Teams"}
            hint="Across every club"
          />
          <StatCard
            icon={<IconGavel />}
            tone="gold"
            value={auctioned.toLocaleString("en-IN")}
            label={auctioned === 1 ? "Auction" : "Auctions"}
            hint={
              career.totals.highestPrice === null
                ? career.totals.soldCount > 0
                  ? `Sold ${String(career.totals.soldCount)}×`
                  : "No sale yet"
                : `Sold ${String(career.totals.soldCount)}× · top ${moneyFormat(career.totals.highestUnit).compact(career.totals.highestPrice)}`
            }
          />
        </StatGrid>
      )}

      {upcoming !== undefined ? (
        <Notice
          tone="info"
          icon={<IconCalendar />}
          testId="me-next"
          title={
            upcoming.status === "submitted"
              ? `Your registration for ${upcoming.competitionName} is with the organizer`
              : `You're in the auction pool for ${upcoming.competitionName}`
          }
        >
          {upcoming.status === "submitted"
            ? "You'll get a message the moment they approve it."
            : "We'll message you the moment a team buys you."}
        </Notice>
      ) : null}

      {sports.length > 1 ? (
        <nav className="me-filter" aria-label="Filter by sport">
          <Link href="/me" aria-current={filter === undefined ? "page" : undefined}>
            All sports
          </Link>
          {sports.map((pack) => (
            <Link
              key={pack.key}
              href={`/me?sport=${pack.key}`}
              aria-current={filter === pack.key ? "page" : undefined}
            >
              {pack.label}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="me-layout">
        <div className="me-main">
          {owns.length > 0 ? <OwnedTeams teams={owns} /> : null}
          {seasons.length === 0 && owns.length > 0 ? (
            // An owner who has never entered as a player: one quiet line, not
            // a second full-weight card under their team.
            <p className="me-quiet" data-testid="me-tournaments">
              <IconTrophy size={16} aria-hidden />
              <span>
                Playing too? <Link href="/c">Find a tournament to enter</Link> — your seasons show
                up here.
              </span>
            </p>
          ) : (
            <SectionCard
              icon={<IconTrophy />}
              title="My registrations"
              description={
                seasons.length === 0
                  ? "Every season you enter shows up here, with where it stands."
                  : `${String(seasons.length)} ${seasons.length === 1 ? "season" : "seasons"} · newest first`
              }
              action={
                <Link href="/c" className="me-link">
                  Find a tournament <IconArrowRight size={14} aria-hidden />
                </Link>
              }
              data-testid="me-tournaments"
            >
              {seasons.length === 0 ? (
                <p className="me-empty">
                  No registrations as a player yet. <Link href="/c">Find a tournament to play</Link>
                  .
                </p>
              ) : (
                <ul className="me-regs">
                  {seasons.map((season) => {
                    const pack = sportPackFor(season.sport);
                    return (
                      <li key={season.registrationId}>
                        <RegistrationCard
                          season={season}
                          eyebrow={`${pack.label} · ${seasonYear(season.startsOn)}`}
                          subline={season.orgName}
                          money={(amount, unit) => moneyFormat(unit).compact(amount)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          )}

          {career.totals.seasons === 0 && shownMatches.length === 0 ? null : shownMatches.length ===
            0 ? (
            // No match yet is one quiet line, not a full-weight empty card.
            <p className="me-quiet" data-testid="me-matches">
              <IconMatch size={16} aria-hidden />
              Matches appear here once your team&apos;s fixtures are played.
            </p>
          ) : (
            <SectionCard
              icon={<IconMatch />}
              tone="gold"
              title="Matches"
              description={
                shownMatches.length === 0
                  ? "Matches and your team's published fixtures appear here once they exist."
                  : `${String(shownMatches.length)} played or in progress`
              }
              flush={shownMatches.length > 0}
              data-testid="me-matches"
            >
              {shownMatches.length === 0 ? undefined : (
                <div className="me-table-wrap">
                  <table className="me-table">
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Match</th>
                        <th scope="col">Result</th>
                        <th scope="col">You</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownMatches.map((match) => (
                        <tr key={match.fixtureId}>
                          <td className="me-num" data-label="Date">
                            {matchDate(match.kickoffAt)}
                          </td>
                          <td className="me-cell-match">
                            <strong>
                              {match.teamName} vs {match.opponentName}
                            </strong>
                            <span>
                              {sportPackFor(match.sport).label} · {match.competitionName}
                            </span>
                          </td>
                          <td data-label="Result">
                            {match.result === null ? (
                              <Pill tone="blue" dot>
                                In progress
                              </Pill>
                            ) : (
                              <Pill tone={RESULT_TONE[match.result]}>
                                {RESULT_LABEL[match.result]}
                              </Pill>
                            )}
                          </td>
                          <td className={`me-played me-played--${match.played}`} data-label="You">
                            {PLAYED_LABEL[match.played]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          )}
        </div>

        <aside className="me-side" aria-label="Coming up and career by sport">
          {shownUpcoming.length === 0 ? null : (
            <SectionCard
              icon={<IconCalendar />}
              tone="gold"
              title="Upcoming matches"
              description={
                shownUpcoming.length === 0
                  ? "Your team's published fixtures appear here."
                  : "Your team's next published fixtures."
              }
              data-testid="me-upcoming"
            >
              {shownUpcoming.length === 0 ? undefined : (
                <ul className="me-upcoming">
                  {shownUpcoming.map((match) => (
                    <li key={match.fixtureId}>
                      <span className="me-upcoming-when">{kickoffLabel(match.kickoffAt)}</span>
                      <span className="me-upcoming-teams">
                        <TeamChip color={match.teamColor}>{match.teamName}</TeamChip>
                        <span className="me-vs">vs</span>
                        <span className="me-upcoming-opp">{match.opponentName}</span>
                      </span>
                      <span className="me-upcoming-comp">{match.competitionName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}

          {/* One sport is not a breakdown: the bar was a full-width stripe
              saying "100%". */}
          {bySport.length > 1 ? (
            <SectionCard
              icon={<IconChart />}
              tone="gold"
              title="Career by sport"
              description="Seasons and matches, per sport."
            >
              <ul className="me-sports">
                {bySport.map((row) => (
                  <li key={row.key}>
                    <div className="me-sport-line">
                      <Link href={`/me/${row.key}`}>{row.label}</Link>
                      <span>
                        {row.seasons} season{row.seasons === 1 ? "" : "s"} · {row.matches} match
                        {row.matches === 1 ? "" : "es"}
                      </span>
                    </div>
                    <span className="me-bar" aria-hidden>
                      <i style={{ width: `${String((row.seasons / maxSeasons) * 100)}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          <p className="me-privacy">
            <IconShieldCheck size={16} aria-hidden />
            <span>
              <strong>Who sees this page?</strong> Only you. Clubs see what you enter for their
              season; your share card shows only what you choose.
            </span>
          </p>
        </aside>
      </div>
    </main>
  );
}

const OWNED_STATUS: Record<string, { label: string; tone: KitTone }> = {
  scheduled: { label: "Auction coming up", tone: "blue" },
  live: { label: "Auction live", tone: "red" },
  paused: { label: "Auction paused", tone: "amber" },
  completed: { label: "Auction finished", tone: "green" },
  reconciled: { label: "Auction finished", tone: "green" },
};

/**
 * TEAMS I OWN (wow pass, round 2). An owner with no registrations was told
 * "No tournaments yet" while running a squad in one. Ownership is part of the
 * record, so it is a row here — from the same roles read the rail uses.
 */
function OwnedTeams({ teams }: { teams: OwnedTeam[] }) {
  return (
    <SectionCard
      icon={<IconUsers />}
      title="Teams I own"
      description={`${String(teams.length)} ${teams.length === 1 ? "team" : "teams"} · as owner`}
      data-testid="me-owned"
    >
      <ul className="me-regs">
        {teams.map((team) => {
          const status = OWNED_STATUS[team.auctionStatus] ?? {
            label: "Auction being set up",
            tone: "neutral" as KitTone,
          };
          return (
            <li key={`${team.auctionId}:${team.teamId}`}>
              <Link
                href={`/seasons/${team.competitionSlug}/teams?team=${encodeURIComponent(team.teamId)}`}
                className="me-reg da-lift"
              >
                <span className="me-reg-top">
                  <span className="me-reg-when">Owner</span>
                  <Pill tone={status.tone} dot>
                    {status.label}
                  </Pill>
                </span>
                <strong className="me-reg-name">{team.teamName}</strong>
                <span className="me-reg-org">{team.competitionName}</span>
                <span className="me-reg-foot me-reg-go">
                  My squad
                  <IconArrowRight size={16} aria-hidden />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
