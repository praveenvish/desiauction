import { SPORTS, roleLabelIn, sportPackFor } from "@desiauction/core";
import {
  EmptyState,
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
  type KitTone,
  Notice,
  Pill,
  PlayerImage,
  SectionCard,
  TeamChip,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeroChip, HeroStatus } from "../../components/season-hero/season-hero";
import { PageTitle } from "../../components/shell/page-title";
import { moneyFormat } from "../../lib/money";
import { planView } from "../../server/auction/owner-plan-actions";
import { seasonUnit } from "../../server/competition/season-unit";
import { currentSession } from "../../server/auth/actions";
import {
  playerCareer,
  playerMatches,
  playerUpcomingMatches,
  type CareerMatch,
} from "../../server/player/career";
import { ownPhotoUrl, playerProfileFor, profileCompletenessFor } from "../../server/player/profile";
import { rolesOf, type OwnedTeam } from "../../server/roles/roles";
import { anyLineupRecorded, matchRecord, profileAsk } from "./me-model";
import { SeasonRow } from "./registration-card";
import "./me.css";
import { formatDate, formatDayDate, formatWallTime, istCalendarDate } from "../../lib/format-date";
import { formatCount } from "../../lib/plural";

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
  const day = kickoffAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDate(day) : day;
}

/** "Sat, 27 Sep · 4:30 pm" from the fixture's local wall-clock text. */
function kickoffLabel(kickoffAt: string | null): string {
  if (kickoffAt === null) return "Time to be announced";
  const day = kickoffAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return kickoffAt;
  const wall = kickoffAt.replace(" ", "T").slice(0, 16);
  return kickoffAt.length > 10
    ? `${formatDayDate(day)} · ${formatWallTime(wall)}`
    : formatDayDate(day);
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
  const today = istCalendarDate();
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
  /** Owns a team and has never entered as a player. */
  const ownerOnly = career.seasons.length === 0 && owns.length > 0;
  const shownMatches = matches.filter((match) => filter === undefined || match.sport === filter);
  const shownRecord = matchRecord(shownMatches);
  /** "Not recorded" on every row said nothing until a club records a lineup. */
  const showYou = anyLineupRecorded(shownMatches);
  const shownUpcoming = upcomingMatches.filter(
    (match) => filter === undefined || match.sport === filter,
  );
  const auctioned = career.seasons.filter((season) => season.auction !== null).length;
  const record = matchRecord(matches.filter((match) => match.played !== "bench"));
  const ask = profileAsk(completeness.missing);

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
  /*
   * A player's rail held a copy of the squad their home already shows (round
   * 5: dropped — /me/cricket carries the season table). With no fixtures and
   * one sport, the rail has nothing but its privacy note, so the page is one
   * column instead of a short card beside a near-empty rail.
   */
  const asideEmpty = !ownerOnly && shownUpcoming.length === 0 && bySport.length <= 1;
  const privacy = (
    <p className="me-privacy">
      <IconShieldCheck size={16} aria-hidden />
      <span>
        <strong>Who sees this page?</strong> Only you. Clubs see what you enter for their season;
        your share card shows only what you choose.
      </span>
    </p>
  );

  return (
    <main className="me">
      {/* Somebody who owns a team and has never played was greeted "My
          sports" (round 2); their record here is the team. */}
      {career.totals.seasons === 0 && owns.length > 0 ? (
        <PageTitle
          title="My teams"
          subtitle="The teams you own — and your seasons, once you play."
        />
      ) : null}
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
          // An unfinished profile is asked for in the footer, by name; the
          // corner keeps the plain door. A player-profile count means nothing
          // to an owner who does not play (their /account asks for no role).
          ask === null || ownerOnly ? (
            <Link href="/account" className="sh-ghost">
              {ownerOnly ? "Account settings" : "Edit profile"}
              <IconArrowRight size={14} />
            </Link>
          ) : undefined
        }
        sideAlign="start"
        footer={
          career.totals.seasons === 0 &&
          record.played === 0 &&
          (ask === null || ownerOnly) ? undefined : (
            <div className="me-hero-foot">
              {/* THE CAREER STRIP. The page opened on three tiles each saying
                  "1"; the record is four figures in the hero, and reads the
                  same at one season as at forty. */}
              {career.totals.seasons === 0 && record.played === 0 ? null : (
                <dl className="me-strip" data-testid="me-figures">
                  <div>
                    <dt>
                      {career.totals.seasons === 1 ? "Season" : "Seasons"}
                      {sports.length > 1 ? ` · ${String(sports.length)} sports` : ""}
                    </dt>
                    <dd>{formatCount(career.totals.seasons)}</dd>
                  </div>
                  <div>
                    <dt>
                      {record.played === 1 ? "Match" : "Matches"}
                      {record.played > 0 ? ` · ${String(record.won)} won` : ""}
                    </dt>
                    <dd>{formatCount(record.played)}</dd>
                  </div>
                  <div>
                    <dt>{career.totals.teams === 1 ? "Team" : "Teams"}</dt>
                    <dd>{formatCount(career.totals.teams)}</dd>
                  </div>
                  <div>
                    <dt>
                      {career.totals.highestPrice === null
                        ? "Auctions"
                        : `Top price · sold ${career.totals.soldCount === 1 ? "once" : `${String(career.totals.soldCount)}×`}`}
                    </dt>
                    <dd>
                      {career.totals.highestPrice === null
                        ? formatCount(auctioned)
                        : moneyFormat(career.totals.highestUnit).compact(
                            career.totals.highestPrice,
                          )}
                    </dd>
                  </div>
                </dl>
              )}
              {ask === null || ownerOnly ? null : (
                <Link href="/account" className="me-ask" data-testid="me-profile-ask">
                  <span>
                    <strong>
                      Profile {completeness.done} of {completeness.total}.
                    </strong>{" "}
                    {ask} — every registration form starts filled in.
                  </span>
                  <span className="me-ask-bar" aria-hidden>
                    <i style={{ width: `${String(Math.round(completeness.score * 100))}%` }} />
                  </span>
                  <IconArrowRight size={16} aria-hidden />
                </Link>
              )}
            </div>
          )
        }
      />

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

      {/* An owner who does not play has one object — their team — and /teams
          holds the squad: the rail here was its fourth copy (review r3). One
          column at a reading measure, not a short card beside a tall rail. */}
      {/* An owner who does not play: two even columns — the team and its
          notes on the left, the night on the right — so neither column ends
          ~120px above the other (round-5 review). */}
      <div
        className="me-layout"
        data-single={asideEmpty ? "" : undefined}
        data-owner={ownerOnly ? "" : undefined}
      >
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
              title="Season by season"
              description={
                seasons.length === 0
                  ? "Every season you enter shows up here, with where it stands."
                  : `${String(seasons.length)} ${seasons.length === 1 ? "season" : "seasons"} · newest first`
              }
              flush={seasons.length > 0}
              action={
                <Link href="/c" className="me-link">
                  Find a tournament <IconArrowRight size={14} aria-hidden />
                </Link>
              }
              data-testid="me-tournaments"
            >
              {seasons.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<IconTrophy />}
                  title="No registrations as a player yet"
                  description="Find a tournament from the link above and your entries line up here."
                />
              ) : (
                <ul className="me-seasons">
                  {seasons.map((season) => (
                    <li key={season.registrationId}>
                      <SeasonRow
                        season={season}
                        year={seasonYear(season.startsOn)}
                        roleLabel={
                          season.role === null
                            ? ""
                            : roleLabelIn(sportPackFor(season.sport), season.role)
                        }
                        money={(amount, unit) => moneyFormat(unit).ledger(amount)}
                      />
                    </li>
                  ))}
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
                shownRecord.played === 0
                  ? `${String(shownMatches.length)} in progress`
                  : `${String(shownRecord.won)} won · ${String(shownRecord.lost)} lost${shownRecord.tied > 0 ? ` · ${String(shownRecord.tied)} tied` : ""}`
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
                        {showYou ? <th scope="col">You</th> : null}
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
                          {showYou ? (
                            <td className={`me-played me-played--${match.played}`} data-label="You">
                              {PLAYED_LABEL[match.played]}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          )}
          {ownerOnly ? privacy : null}
        </div>

        <aside
          className="me-side"
          aria-label={ownerOnly ? "Your auction night" : "Coming up and career by sport"}
        >
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

          {/* THE OWNER'S RECORD (round 5). Without the squad rail the page was
              one card and ~55% blank on a laptop. An owner's record is the
              night their team was built: what it cost and where it went. */}
          {ownerOnly && owns[0] !== undefined ? <OwnerNight team={owns[0]} /> : null}

          {ownerOnly ? null : privacy}
        </aside>
      </div>
    </main>
  );
}

const OWNED_STATUS: Record<string, { label: string; tone: KitTone }> = {
  scheduled: { label: "Auction coming up", tone: "neutral" },
  live: { label: "Auction live", tone: "green" },
  paused: { label: "Auction paused", tone: "amber" },
  completed: { label: "Auction finished", tone: "green" },
  reconciled: { label: "Auction finished", tone: "green" },
};

/**
 * TEAMS I OWN (wow pass, round 2). An owner with no registrations was told
 * "No tournaments yet" while running a squad in one. Ownership is part of the
 * record, so it is a row here — from the same roles read the rail uses.
 */
async function OwnedTeams({ teams }: { teams: OwnedTeam[] }) {
  // The same gated read the owner's home hero uses, so this card shows no
  // figure the plan page would not (null when planning is off: no figures).
  const figures = await Promise.all(
    teams.map(async (team) => {
      const [plan, unit] = await Promise.all([
        planView(team.competitionSlug, team.teamId),
        seasonUnit(team.competitionSlug),
      ]);
      return plan === null
        ? null
        : {
            purseLeft: moneyFormat(unit).compactFloor(plan.standing.purseRemaining),
            squad: `${String(plan.standing.squadSize)}/${String(plan.rules.squadMax)}`,
          };
    }),
  );
  return (
    <SectionCard
      icon={<IconUsers />}
      title="Teams I own"
      // The title already says "own": the line under it says what the row holds.
      description={
        teams.length === 1
          ? "Its purse, its squad and the way in."
          : `${String(teams.length)} teams — their purses, squads and the way in.`
      }
      data-testid="me-owned"
    >
      <ul className="me-regs">
        {teams.map((team, index) => {
          const status = OWNED_STATUS[team.auctionStatus] ?? {
            label: "Auction being set up",
            tone: "neutral" as KitTone,
          };
          const figure = figures[index] ?? null;
          return (
            <li key={`${team.auctionId}:${team.teamId}`}>
              <Link
                href={`/seasons/${team.competitionSlug}/teams?team=${encodeURIComponent(team.teamId)}`}
                className="me-reg me-owned da-lift"
              >
                {/* The home hero's mini version (round 2: "no monogram, colour,
                    purse or squad count"). */}
                <span className="me-owned-crest" aria-hidden>
                  {teamMonogram(team.teamName)}
                </span>
                <span className="me-owned-body">
                  <span className="me-reg-top">
                    <span className="me-reg-when">Owner · {team.competitionName}</span>
                    <Pill tone={status.tone} dot>
                      {status.label}
                    </Pill>
                  </span>
                  <strong className="me-reg-name">{team.teamName}</strong>
                  {figure !== null ? (
                    <span className="me-owned-figures">
                      <span>
                        <b>{figure.purseLeft}</b> purse left
                      </span>
                      <span>
                        <b>{figure.squad}</b> squad
                      </span>
                    </span>
                  ) : null}
                </span>
                <span className="me-reg-go me-owned-go">
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

/**
 * AUCTION NIGHT — one owned team's night in figures: spent, the squad's split,
 * the average and the three dearest buys. Read from the same gated plan view
 * the home hero and "Teams I own" use, so nothing appears here that the plan
 * page would not show this owner.
 */
async function OwnerNight({ team }: { team: OwnedTeam }) {
  const [plan, unit] = await Promise.all([
    planView(team.competitionSlug, team.teamId),
    seasonUnit(team.competitionSlug),
  ]);
  if (plan === null) return null;
  const money = moneyFormat(unit);
  const bought = plan.lots
    .filter((lot) => lot.status === "sold" && lot.soldToTeamId === team.teamId)
    .sort((a, b) => (b.soldPrice ?? 0) - (a.soldPrice ?? 0));
  const spent = plan.rules.pursePerTeam - plan.standing.purseRemaining;
  const preSigned = plan.preSignedPlayers.length;
  if (bought.length === 0 && preSigned === 0) return null;
  const average = bought.length === 0 ? 0 : Math.round(spent / bought.length);
  return (
    <SectionCard
      icon={<IconGavel />}
      tone="gold"
      title="Auction night"
      description={`${team.teamName} · ${team.competitionName}`}
      data-testid="me-owner-night"
    >
      <dl className="me-night-facts">
        <div>
          <dt>Spent</dt>
          <dd>{money.ledger(spent)}</dd>
        </div>
        <div>
          <dt>Average buy</dt>
          <dd>{bought.length === 0 ? "—" : money.ledger(average)}</dd>
        </div>
        <div>
          <dt>Bought</dt>
          <dd>{bought.length}</dd>
        </div>
        <div>
          <dt>Pre-signed</dt>
          <dd>{preSigned}</dd>
        </div>
      </dl>
      {bought.length === 0 ? null : (
        <ol className="me-night-top" aria-label="Dearest buys">
          {bought.slice(0, 3).map((lot) => (
            <li key={lot.lotId}>
              <PlayerImage
                name={lot.playerName ?? "Player"}
                seed={lot.registrationId}
                src={plan.lotMedia[lot.lotId]?.photoUrl ?? null}
                size="sm"
                shape="round"
                decorative
              />
              <span className="me-night-name">{lot.playerName ?? "Player"}</span>
              <span className="me-night-price">{money.ledger(lot.soldPrice ?? 0)}</span>
            </li>
          ))}
        </ol>
      )}
      <Link
        href={`/seasons/${team.competitionSlug}/auction/plan?team=${encodeURIComponent(team.teamId)}`}
        className="me-link"
      >
        The night in full <IconArrowRight size={14} aria-hidden />
      </Link>
    </SectionCard>
  );
}

/** Two letters for a team's crest. */
function teamMonogram(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
