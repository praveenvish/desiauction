import { SPORTS, roleLabelIn, sportPackFor, type MoneyUnit } from "@desiauction/core";
import {
  ButtonLink,
  EmptyState,
  HeroBanner,
  IconArrowRight,
  IconCalendar,
  IconGavel,
  IconMatch,
  IconPin,
  IconShieldCheck,
  IconTrophy,
  IconUsers,
  type KitTone,
  Pill,
  PlayerImage,
  RosterMark,
  SectionCard,
  TeamChip,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";

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
  type CareerSeason,
  type UpcomingMatch,
} from "../../server/player/career";
import {
  ownPhotoUrl,
  playerProfileFor,
  profileCompletenessFor,
  sportProfilesFor,
  type SportProfile,
} from "../../server/player/profile";
import { rolesOf, type OwnedTeam } from "../../server/roles/roles";
import {
  STAGE_STEPS,
  clubsOf,
  liveStage,
  matchRecord,
  profileAsk,
  recentForm,
  seasonRecordLine,
  soldOf,
  type FormResult,
  type LiveStage,
} from "./me-model";
import { verdictOf } from "./registration-card";
import "./me.css";
import { formatDate, formatDayDate, formatWallTime, istCalendarDate } from "../../lib/format-date";
import { formatCount } from "../../lib/plural";

export const metadata = { title: "My profile · DesiAuction" };

/**
 * MY PROFILE — everything about this person as a player, on one page: the
 * sports they play and their role in each, the seasons still live for them,
 * the career season by season, the clubs and teams, the matches and how they
 * play. The founder's ask: "give all snapshot about me as player — which all
 * sports, which all matches, which all seasons and tournaments running, which
 * all clubs". It replaces the hub + per-sport page pair (/me/[sport] now
 * redirects to `/me?sport=`), where the same seasons were told twice.
 *
 * Self view only: the person id is the session's, never a parameter.
 */

const RESULT_LETTER: Record<NonNullable<CareerMatch["result"]>, string> = {
  won: "W",
  lost: "L",
  tied: "T",
  no_result: "–",
};

const RESULT_WORD: Record<NonNullable<CareerMatch["result"]>, string> = {
  won: "Won",
  lost: "Lost",
  tied: "Tied",
  no_result: "No result",
};

function matchDate(kickoffAt: string | null): string {
  if (kickoffAt === null) return "—";
  const day = kickoffAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDate(day).replace(/ \d{4}$/, "") : day;
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
  return startsOn === null ? "" : startsOn.slice(0, 4);
}

function seasonTitle(season: CareerSeason): string {
  return season.tournamentName ?? season.competitionName;
}

const ledger = (amount: number, unit: MoneyUnit): string => moneyFormat(unit).ledger(amount);

export default async function MyProfilePage({
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
  // Today in IST — fixture kickoffs and season dates are local calendar text.
  const today = istCalendarDate();
  const [
    query,
    career,
    matches,
    upcomingMatches,
    profile,
    sportProfiles,
    completeness,
    photoUrl,
    roles,
  ] = await Promise.all([
    searchParams,
    playerCareer(session.personId),
    playerMatches(session.personId),
    playerUpcomingMatches(session.personId, today),
    playerProfileFor(session.personId),
    sportProfilesFor(session.personId),
    profileCompletenessFor(session.personId),
    ownPhotoUrl(session.personId),
    rolesOf(session.personId),
  ]);
  const owns = roles.owns;
  /** Owns a team and has never entered as a player. */
  const ownerOnly = career.seasons.length === 0 && owns.length > 0;
  const ask = profileAsk(completeness.missing);
  const crest = (
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
  );
  const privacy = (
    <p className="me-privacy">
      <IconShieldCheck size={16} aria-hidden />
      <span>
        <strong>Who sees this page?</strong> Only you. Clubs see what you enter for their season;
        your share card shows only what you choose.
      </span>
    </p>
  );

  if (ownerOnly) {
    return (
      <main className="me">
        {/* Somebody who owns a team and has never played was greeted as a
            player (round 2); their record here is the team. */}
        <PageTitle
          title="My teams"
          subtitle="The teams you own — and your seasons, once you play."
        />
        <HeroBanner
          testId="me-hero"
          crest={crest}
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
            ...owns.map((team) => (
              <HeroChip key={`${team.auctionId}:${team.teamId}`}>Owner · {team.teamName}</HeroChip>
            )),
          ]}
          actions={
            <Link href="/account" className="sh-ghost">
              Account settings
              <IconArrowRight size={14} />
            </Link>
          }
          sideAlign="start"
        />
        <div className="me-layout" data-owner="">
          <div className="me-main">
            <OwnedTeams teams={owns} />
            <p className="me-quiet" data-testid="me-tournaments">
              <IconTrophy size={16} aria-hidden />
              <span>
                Playing too? <Link href="/c">Find a tournament to enter</Link> — your seasons show
                up here.
              </span>
            </p>
            {privacy}
          </div>
          <aside className="me-side" aria-label="Your auction night">
            {owns[0] !== undefined ? <OwnerNight team={owns[0]} /> : null}
          </aside>
        </div>
      </main>
    );
  }

  // Every sport this person plays — entered or set up on their profile — in
  // the platform's own order. The filter offers only the ones they entered.
  const entered = new Set(career.seasons.map((season) => season.sport));
  const profiled = new Map(sportProfiles.map((row) => [row.sport, row]));
  const sports = SPORTS.filter((pack) => entered.has(pack.key) || profiled.has(pack.key));
  const filterable = sports.filter((pack) => entered.has(pack.key));
  const filter = filterable.some((pack) => pack.key === query.sport) ? query.sport : undefined;
  const inFilter = (sport: string): boolean => filter === undefined || sport === filter;

  const newestFirst = career.seasons.slice().reverse();
  /** The role a sport is played in: the profile's answer, else the latest entry's. */
  const roleIn = (sport: string): string | null => {
    const pack = sportPackFor(sport);
    const set = profiled.get(sport)?.defaultRole ?? null;
    const latest = newestFirst.find((season) => season.sport === sport && season.role !== null);
    const role = set ?? latest?.role ?? null;
    return role === null ? null : roleLabelIn(pack, role) || null;
  };

  const live = newestFirst
    .map((season) => ({ season, stage: liveStage(season, today) }))
    .filter((row): row is { season: CareerSeason; stage: LiveStage } => row.stage !== null);
  const playsFor = live.find((row) => row.season.teamName !== null)?.season ?? null;
  // The card to share: the newest season the auction (or a pre-signing) has
  // spoken for — an unsold player gets no card (the share-card rule).
  const shareFrom = newestFirst.find(
    (season) =>
      season.status === "approved" && season.auction !== null && season.auction.kind !== "unsold",
  );

  const finished = matches.filter((match) => match.played !== "bench");
  const record = matchRecord(finished);
  const sold = soldOf(career.seasons);
  const clubs = clubsOf(career.seasons);
  const nextMatchFor = (registrationId: string): UpcomingMatch | undefined =>
    upcomingMatches.find((match) => match.registrationId === registrationId);

  const shownLive = live.filter((row) => inFilter(row.season.sport));
  const shownSeasons = newestFirst.filter((season) => inFilter(season.sport));
  const shownMatches = matches.filter((match) => inFilter(match.sport));
  const shownUpcoming = upcomingMatches.filter((match) => inFilter(match.sport));
  const shownRecord = matchRecord(shownMatches);
  const shownPlay = sports.filter((pack) => inFilter(pack.key));
  /** Everything they have is one season waiting on its first step. */
  const justStarted =
    career.seasons.length > 0 &&
    live.length === career.seasons.length &&
    sold.sold === 0 &&
    record.played === 0;

  const figures: { value: string; label: string; note?: string }[] = [
    {
      value: formatCount(career.totals.seasons),
      label: career.totals.seasons === 1 ? "Season" : "Seasons",
      ...(live.length > 0 ? { note: `${String(live.length)} live` } : {}),
    },
    {
      value: formatCount(record.played),
      label: record.played === 1 ? "Match" : "Matches",
      ...(record.played > 0 ? { note: `${String(record.won)} won` } : {}),
    },
    sold.auctioned > 0
      ? { value: `${String(sold.sold)} of ${String(sold.auctioned)}`, label: "Times sold" }
      : {
          value: formatCount(career.totals.teams),
          label: career.totals.teams === 1 ? "Team" : "Teams",
        },
    career.totals.highestPrice !== null
      ? {
          value: moneyFormat(career.totals.highestUnit).compact(career.totals.highestPrice),
          label: "Top price",
        }
      : { value: formatCount(clubs.length), label: clubs.length === 1 ? "Club" : "Clubs" },
  ];

  return (
    <main className="me">
      <HeroBanner
        testId="me-hero"
        crest={crest}
        {...(career.totals.seasons > 0 ? { eyebrow: <HeroStatus>Player</HeroStatus> } : {})}
        title={session.name}
        meta={[
          ...sports.map((pack) => {
            const role = roleIn(pack.key);
            return (
              <HeroChip key={pack.key}>
                {pack.label}
                {role === null ? null : <span className="mp-chip-role">{role}</span>}
              </HeroChip>
            );
          }),
          ...(profile.location !== null && profile.location !== ""
            ? [
                <>
                  <IconPin />
                  {profile.location}
                </>,
              ]
            : []),
          ...(playsFor !== null && playsFor.teamName !== null
            ? [
                <span className="mp-plays-for">
                  Plays for <strong>{playsFor.teamName}</strong>
                </span>,
              ]
            : []),
          ...(sports.length === 0
            ? [<>Your playing record starts with your first registration.</>]
            : []),
        ]}
        actions={
          <span className="mp-hero-actions">
            <Link href="/account?section=player" className="sh-ghost">
              Edit profile
            </Link>
            {shareFrom !== undefined ? (
              <ButtonLink
                href={`/seasons/${shareFrom.competitionSlug}/posters`}
                size="sm"
                data-testid="me-share-card"
              >
                Share my card
              </ButtonLink>
            ) : null}
          </span>
        }
        sideAlign="start"
        footer={
          career.totals.seasons === 0 && ask === null ? undefined : (
            <div className="me-hero-foot">
              {career.totals.seasons === 0 ? null : (
                <dl className="me-strip" data-testid="me-figures">
                  {figures.map((figure) => (
                    <div key={figure.label}>
                      <dt>
                        {figure.label}
                        {figure.note === undefined ? null : (
                          <span className="mp-strip-note"> · {figure.note}</span>
                        )}
                      </dt>
                      <dd>{figure.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {clubs.length === 0 ? null : (
                <ul className="mp-clubs" aria-label="Clubs you've played in" data-testid="me-clubs">
                  {clubs.map((club) => (
                    <li key={club.name}>
                      <span className="mp-club-mark" aria-hidden>
                        {monogram(club.name)}
                      </span>
                      {club.name}
                      <span className="mp-club-count">
                        {club.seasons === 1 ? "1 season" : `${String(club.seasons)} seasons`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {ask === null ? null : (
                <Link
                  href="/account?section=player"
                  className="me-ask"
                  data-testid="me-profile-ask"
                >
                  <span
                    className="mp-ring"
                    style={{ "--mp-done": String(completeness.score) } as CSSProperties}
                    aria-hidden
                  >
                    <b>
                      {completeness.done}/{completeness.total}
                    </b>
                  </span>
                  <span>
                    <strong>
                      Profile {completeness.done} of {completeness.total}.
                    </strong>{" "}
                    {ask}
                    <span className="mp-ask-why"> — every registration form starts filled in.</span>
                  </span>
                  <IconArrowRight size={16} aria-hidden />
                </Link>
              )}
            </div>
          )
        }
      />

      {filterable.length > 1 ? (
        <nav className="mp-filter" aria-label="Filter by sport">
          <Link href="/me" aria-current={filter === undefined ? "page" : undefined}>
            All
          </Link>
          {filterable.map((pack) => (
            <Link
              key={pack.key}
              href={`/me?sport=${pack.key}`}
              aria-current={filter === pack.key ? "page" : undefined}
            >
              {pack.label}
              <span className="mp-filter-count">
                {career.seasons.filter((season) => season.sport === pack.key).length}
              </span>
            </Link>
          ))}
        </nav>
      ) : null}

      {shownLive.length === 0 ? null : (
        <section className="mp-now" aria-labelledby="mp-now-title" data-testid="me-now">
          <h2 id="mp-now-title" className="mp-eyebrow">
            Right now
            <span>
              {" "}
              · {shownLive.length} live {shownLive.length === 1 ? "season" : "seasons"}
            </span>
          </h2>
          <div className="mp-now-grid">
            {shownLive.map(({ season, stage }) => (
              <NowCard
                key={season.registrationId}
                season={season}
                stage={stage}
                next={nextMatchFor(season.registrationId)}
                record={seasonRecordLine(matches, season.registrationId)}
              />
            ))}
            {justStarted ? (
              <section className="mp-now-card mp-now-start">
                <strong>Your career starts here</strong>
                <p>
                  Once a team buys you, every season, team, price and match you play lands on this
                  page — and on a card you can share.
                </p>
                <Link href="/c" className="me-link">
                  Find another tournament <IconArrowRight size={14} aria-hidden />
                </Link>
              </section>
            ) : null}
          </div>
        </section>
      )}

      {owns.length > 0 ? <OwnedTeams teams={owns} /> : null}

      <div
        className="mp-cols"
        data-single={shownMatches.length === 0 && shownUpcoming.length === 0 ? "" : undefined}
      >
        <SectionCard
          icon={<IconTrophy />}
          title="Career"
          description={
            shownSeasons.length === 0
              ? "Every season you enter shows up here, with where it stands."
              : `${formatCount(shownSeasons.length)} ${shownSeasons.length === 1 ? "season" : "seasons"} · newest first`
          }
          action={
            <Link href="/c" className="me-link">
              Find a tournament <IconArrowRight size={14} aria-hidden />
            </Link>
          }
          data-testid="career-seasons"
        >
          {shownSeasons.length === 0 ? (
            <EmptyState
              size="compact"
              headingLevel={3}
              icon={<IconTrophy />}
              title="No seasons yet"
              description="When you register for a tournament it shows up here — and after auction night, so does your result."
            />
          ) : (
            <ol className="mp-career">
              {shownSeasons.map((season) => (
                <CareerEntry
                  key={season.registrationId}
                  season={season}
                  record={seasonRecordLine(matches, season.registrationId)}
                />
              ))}
            </ol>
          )}
        </SectionCard>

        {shownMatches.length === 0 && shownUpcoming.length === 0 ? null : (
          <SectionCard
            icon={<IconMatch />}
            title="Matches"
            action={<Form results={recentForm(shownMatches)} />}
            data-testid="me-matches"
          >
            {shownUpcoming[0] === undefined ? null : <NextTicket match={shownUpcoming[0]} />}
            {shownMatches.length === 0 ? (
              <p className="mp-quiet">
                Results land here once your team&apos;s matches are played.
              </p>
            ) : (
              <ul className="mp-matches">
                {shownMatches.slice(0, 6).map((match) => (
                  <li key={match.fixtureId}>
                    <span className="mp-match-date">{matchDate(match.kickoffAt)}</span>
                    <span className="mp-match-body">
                      <strong>vs {match.opponentName}</strong>
                      <span>
                        {match.teamName} · {match.competitionName}
                        {match.played === "bench" ? " · on the bench" : ""}
                      </span>
                    </span>
                    {match.result === null ? (
                      <Pill tone="blue" dot>
                        Live
                      </Pill>
                    ) : (
                      <span className="mp-result" data-result={match.result}>
                        <span aria-hidden>{RESULT_LETTER[match.result]}</span>
                        <VisuallyHidden>{RESULT_WORD[match.result]}</VisuallyHidden>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {shownMatches.length === 0 ? null : (
              <p className="mp-match-foot">
                <strong>{formatCount(shownRecord.played)}</strong> played ·{" "}
                <strong className="mp-won">{formatCount(shownRecord.won)} won</strong> ·{" "}
                <strong className="mp-lost">{formatCount(shownRecord.lost)} lost</strong>
                {shownRecord.tied > 0 ? ` · ${String(shownRecord.tied)} tied` : ""}
                {shownMatches.length > 6 ? (
                  <span className="mp-match-more"> · latest 6 shown</span>
                ) : null}
              </p>
            )}
          </SectionCard>
        )}
      </div>

      {shownPlay.length === 0 ? null : (
        <SectionCard
          icon={<IconUsers />}
          title="How you play"
          description="Every registration form starts filled in from this."
          action={
            <Link href="/account?section=player#sports" className="me-link">
              Edit <IconArrowRight size={14} aria-hidden />
            </Link>
          }
          data-testid="career-profile"
        >
          <div className="mp-play">
            {shownPlay.map((pack) => (
              <HowYouPlay key={pack.key} sport={pack.key} profile={profiled.get(pack.key)} />
            ))}
          </div>
        </SectionCard>
      )}

      {privacy}
    </main>
  );
}

/** The four steps, the current one lit. */
function StageTrack({ at }: { at: number }) {
  return (
    <ol className="mp-track" aria-label={`Step ${String(at + 1)} of ${String(STAGE_STEPS.length)}`}>
      {STAGE_STEPS.map((step, index) => (
        <li
          key={step}
          data-state={index < at ? "done" : index === at ? "now" : "todo"}
          aria-current={index === at ? "step" : undefined}
        >
          {step}
        </li>
      ))}
    </ol>
  );
}

/** One live season: where it stands, and the one next thing in it. */
function NowCard({
  season,
  stage,
  next,
  record,
}: {
  season: CareerSeason;
  stage: LiveStage;
  next: UpcomingMatch | undefined;
  record: string | null;
}) {
  const pack = sportPackFor(season.sport);
  const price =
    season.auction?.kind === "sold"
      ? `Sold for ${ledger(season.auction.soldPrice, season.auctionUnit)}`
      : null;
  const facts = [price, record].filter((part): part is string => part !== null).join(" · ");
  const line: { head: string; detail: string; href: string | null; cta: string | null } =
    stage.kind === "waiting"
      ? {
          head: "Waiting for the organizer to approve you",
          detail: "You'll get a message the moment they decide.",
          href: `/seasons/${season.competitionSlug}/register`,
          cta: "Your registration",
        }
      : stage.kind === "waitlisted"
        ? {
            head: "On the waitlist",
            detail: "If a place opens, the organizer can move you into the pool.",
            href: `/seasons/${season.competitionSlug}/register`,
            cta: "Your registration",
          }
        : stage.kind === "auction_live"
          ? {
              head: "The auction is live now",
              detail: "Watch the bids — we'll message you the moment a team buys you.",
              href: `/seasons/${season.competitionSlug}/auction/spectate`,
              cta: "Watch",
            }
          : stage.kind === "pool"
            ? {
                head: "You're in the auction pool",
                detail: "We'll message you the moment a team buys you.",
                href: null,
                cta: null,
              }
            : next !== undefined
              ? {
                  head: `Next: vs ${next.opponentName} · ${kickoffLabel(next.kickoffAt)}`,
                  detail: facts === "" ? (season.teamName ?? "") : facts,
                  href: `/seasons/${season.competitionSlug}/register`,
                  cta: "Your season",
                }
              : {
                  head: season.teamName === null ? "You're in" : `In the ${season.teamName} squad`,
                  detail:
                    facts === "" ? "Fixtures show up here once the club publishes them." : facts,
                  href: `/seasons/${season.competitionSlug}/register`,
                  cta: "Your season",
                };
  return (
    <section
      className="mp-now-card"
      aria-label={`${seasonTitle(season)} — ${STAGE_STEPS[stage.at]}`}
    >
      <div className="mp-now-head">
        <div>
          <span className="mp-eyebrow">
            {pack.label} · {season.orgName}
          </span>
          <strong className="mp-now-title">
            {seasonTitle(season)} {seasonYear(season.startsOn)}
          </strong>
        </div>
        {season.teamName !== null ? (
          <TeamChip color={season.teamColor}>{season.teamName}</TeamChip>
        ) : null}
      </div>
      <StageTrack at={stage.at} />
      <div className="mp-now-next">
        <span>
          <strong>{line.head}</strong>
          {line.detail === "" ? null : <span>{line.detail}</span>}
        </span>
        {line.href !== null && line.cta !== null ? (
          <Link href={line.href} className="me-link">
            {line.cta} <IconArrowRight size={14} aria-hidden />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

const VERDICT_TONE: Partial<Record<KitTone, string>> = {
  gold: "sold",
  green: "pool",
  blue: "wait",
  amber: "wait",
  purple: "signed",
};

/** One season on the career rail: where, for whom, as what, and how it ended. */
function CareerEntry({ season, record }: { season: CareerSeason; record: string | null }) {
  const pack = sportPackFor(season.sport);
  const verdict = verdictOf(season, ledger);
  const role = season.role === null ? "" : roleLabelIn(pack, season.role);
  const armband =
    season.isCaptain && season.auction?.kind !== "captain"
      ? "captain"
      : season.isViceCaptain
        ? "vice-captain"
        : null;
  return (
    <li
      className="mp-entry"
      style={
        season.teamColor === null ? undefined : ({ "--mp-team": season.teamColor } as CSSProperties)
      }
      data-team={season.teamName === null ? undefined : ""}
    >
      <span className="mp-entry-year">{seasonYear(season.startsOn)}</span>
      <span className="mp-entry-dot" aria-hidden />
      <div className="mp-entry-body">
        <div className="mp-entry-top">
          <Link href={`/seasons/${season.competitionSlug}/register`} className="mp-entry-name">
            {seasonTitle(season)}
            <span className="mp-entry-phone-year"> {seasonYear(season.startsOn)}</span>
          </Link>
          <span className="mp-entry-verdict" data-tone={VERDICT_TONE[verdict.tone] ?? "quiet"}>
            {verdict.label}
          </span>
        </div>
        <span className="mp-entry-where">
          {pack.label} · {season.orgName}
          {season.tournamentName !== null && season.tournamentName !== season.competitionName
            ? ` · ${season.competitionName}`
            : ""}
        </span>
        <span className="mp-entry-facts">
          {season.teamName !== null ? (
            <TeamChip color={season.teamColor}>{season.teamName}</TeamChip>
          ) : null}
          {role === "" ? null : <span className="mp-tag">{role}</span>}
          {armband === null ? null : <RosterMark kind={armband} />}
          {record === null ? null : <span className="mp-entry-record">{record}</span>}
        </span>
      </div>
    </li>
  );
}

/** The last few results as letters, oldest first. */
function Form({ results }: { results: FormResult[] }) {
  if (results.length === 0) return null;
  return (
    <span className="mp-form">
      <VisuallyHidden>
        Last {results.length} results, oldest first: {results.join(" ")}
      </VisuallyHidden>
      {results.map((result, index) => (
        <span key={index} data-result={result} aria-hidden>
          {result}
        </span>
      ))}
    </span>
  );
}

/** The next published fixture, as a ticket. */
function NextTicket({ match }: { match: UpcomingMatch }) {
  return (
    <div className="mp-ticket" data-theme="floodlight" data-testid="me-upcoming">
      <span className="mp-ticket-when">
        <IconCalendar size={14} aria-hidden />
        Next · {kickoffLabel(match.kickoffAt)}
      </span>
      <span className="mp-ticket-teams">
        <span>
          <i style={{ background: match.teamColor ?? "currentColor" }} aria-hidden />
          {match.teamName}
        </span>
        <span className="mp-ticket-vs">vs</span>
        <span>
          <i style={{ background: match.opponentColor ?? "currentColor" }} aria-hidden />
          {match.opponentName}
        </span>
      </span>
      <span className="mp-ticket-where">
        {[match.competitionName, match.groundName]
          .filter((part): part is string => part !== null)
          .join(" · ")}
      </span>
    </div>
  );
}

/** One sport's answers — role and styles — or the one line that asks for them. */
function HowYouPlay({ sport, profile }: { sport: string; profile: SportProfile | undefined }) {
  const pack = sportPackFor(sport);
  const role =
    profile?.defaultRole === null || profile?.defaultRole === undefined
      ? null
      : roleLabelIn(pack, profile.defaultRole) || null;
  const answers = pack.attributes
    .map((attribute) => {
      const value = profile?.attributes[attribute.key];
      const label =
        value === undefined
          ? null
          : (attribute.options.find((option) => option.key === value)?.label ?? null);
      return label === null ? null : { key: attribute.key, label: attribute.label, value: label };
    })
    .filter((row): row is { key: string; label: string; value: string } => row !== null);
  return (
    <div className="mp-play-sport">
      <span className="mp-eyebrow">{pack.label}</span>
      {role === null && answers.length === 0 ? (
        <p className="mp-quiet">
          Nothing set yet. <Link href="/account?section=player#sports">Add how you play</Link>
        </p>
      ) : (
        <dl>
          <div>
            <dt>Role</dt>
            <dd data-empty={role === null ? "true" : undefined}>{role ?? "Not set"}</dd>
          </div>
          {answers.map((row) => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Two letters for a club's or team's mark. */
function monogram(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
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
                  {monogram(team.teamName)}
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
