import { roleLabelIn, sportPackFor } from "@desiauction/core";
import {
  ButtonLink,
  IconArrowRight,
  IconCalendar,
  IconFileCheck,
  IconTrophy,
  IconUser,
  Pill,
  PlayerImage,
  RosterMark,
  SectionCard,
  TeamChip,
  type KitTone,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";
import type { CSSProperties } from "react";

import { monogram } from "../../components/season-hero/season-hero";
import { SquadList } from "../../components/team/squad-list";
import { moneyFormat } from "../../lib/money";
import {
  myRegistrations,
  publicTeam,
  publicTopBuys,
  teamSlugOf,
  type MyRegistration,
  type PublicTeam,
  type PublicTopBuy,
} from "../../server/competition/public";
import {
  playerCareer,
  playerAwaitingMatches,
  playerMatches,
  playerUpcomingMatches,
  type CareerMatch,
  type UpcomingMatch,
} from "../../server/player/career";
import { hasPlayerProfile, profileCompletenessFor } from "../../server/player/profile";
import { STAGE_STEPS, matchRecord } from "../me/me-model";
import { verdictOf } from "../me/registration-card";
import { currentSeason, heroKind, type CurrentSeason, type HeroKind } from "./player-home-model";
import "./home-duo.css";
import "./player-home.css";
import { dateTile, formatDayDate, formatWallTime, istCalendarDate } from "../../lib/format-date";

/**
 * THE PLAYER'S HOME.
 *
 * Its one job (RN-1 §0): am I in, when is it, and what did I get. Everything
 * here is about THIS person's entries — no dashboard, no lifecycle rail, no
 * money roll-up and no attention queue, because a player can act on none of
 * them and used to be shown all of them.
 *
 * Dressed in the same kit as the organizer's home (section cards, pills,
 * notices) rather than the plainer console markup RN-1 shipped it in: the two
 * arrived from branches that never saw each other, and a player's home looking
 * like a different product from an organizer's is the kind of seam a reader
 * notices without being able to name.
 */

/** The one word for a pre-signed place, when there is room for a team after it. */
const PRE_SIGNED_WORD = { captain: "Captain", icon: "Icon player", retained: "Retained" } as const;

/**
 * WHERE THIS SEASON STANDS, in the career page's own words.
 *
 * The row used to carry the registration's raw status — a green "approved"
 * pill on the home of a player who had been SOLD for 50,000 points, with no
 * word about the team or the price. That is the one fact this page exists to
 * tell them. `verdictOf` is what /me already says ("Sold · 50,000 pts"), so the
 * two surfaces cannot drift; a pre-signed place names its team in the same
 * breath ("Captain · Mumbai Mavericks"), because "picked before the auction" is
 * the career page's longer explanation and the team is what a home row needs.
 */
function verdictFor(registration: MyRegistration): {
  label: string;
  tone: KitTone;
  /** Whether the label already names the team — then no chip beside it. */
  namesTeam: boolean;
} {
  const kind = registration.auction?.kind;
  if (
    registration.teamName !== null &&
    (kind === "captain" || kind === "icon" || kind === "retained")
  ) {
    return {
      label: `${PRE_SIGNED_WORD[kind]} · ${registration.teamName}`,
      tone: "purple",
      namesTeam: true,
    };
  }
  // The full figure, not the room's shorthand: this is their price, once.
  const verdict = verdictOf(registration, (amount, unit) => moneyFormat(unit).ledger(amount));
  return { ...verdict, namesTeam: false };
}

/**
 * THE MOMENT (wow pass). Being sold is the biggest thing that happens to a
 * player on this product, and home said it in an 11px pill inside a generic
 * row — under a blue "complete your profile" nag. The latest sale now leads
 * the page as a floodlit card: the team, the price as the loudest figure on
 * screen, and the two things a sold player does next.
 */
function SoldMoment({ registration }: { registration: MyRegistration }) {
  const auction = registration.auction;
  if (auction?.kind !== "sold" || registration.teamName === null) {
    return null;
  }
  const price = moneyFormat(registration.auctionUnit).ledger(auction.soldPrice);
  const base = `/seasons/${registration.competitionSlug}`;
  return (
    <section
      className="pm-moment"
      data-theme="floodlight"
      data-testid="home-sold-moment"
      aria-labelledby="pm-moment-title"
      style={
        registration.teamColor === null
          ? undefined
          : ({ "--pm-team": registration.teamColor } as CSSProperties)
      }
    >
      <div className="pm-moment-copy">
        <p className="pm-moment-kicker">
          {registration.competitionName} · {registration.orgName}
        </p>
        <h2 id="pm-moment-title" className="pm-moment-title">
          Sold to <span className="pm-moment-team">{registration.teamName}</span>
        </h2>
        <p className="pm-moment-price">{price}</p>
      </div>
      <div className="pm-moment-actions">
        {registration.posterReady ? (
          <ButtonLink href={`${base}/posters`} size="lg">
            Share your card
            <IconArrowRight size={16} />
          </ButtonLink>
        ) : null}
        {/* ONE LINK PER DESTINATION (round 3B): with a card to share, the
            season's own page is the row under "My seasons", not a second
            button here. */}
        {registration.posterReady ? null : (
          <ButtonLink href={`${base}/register`} size="lg">
            Your season
          </ButtonLink>
        )}
      </div>
    </section>
  );
}

/** "Mon 28" from the fixture's local wall-clock text. */
function dayLabel(kickoffAt: string | null): string {
  if (kickoffAt === null) return "TBA";
  const day = kickoffAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "TBA";
  const tile = dateTile(day);
  return `${tile.day} ${tile.month}`;
}

/** "9:30 am", or null when the kickoff has no time. */
function timeLabel(kickoffAt: string | null): string | null {
  if (kickoffAt === null || kickoffAt.length <= 10) return null;
  return formatWallTime(kickoffAt.replace(" ", "T").slice(0, 16));
}

const RESULT_WORD = { won: "Won", lost: "Lost", tied: "Tied", no_result: "No result" } as const;

function ResultMark({ result }: { result: CareerMatch["result"] }) {
  if (result === null) return <span className="pm-match-next">Live</span>;
  return (
    <span className="pm-result" data-result={result}>
      <span aria-hidden>
        {result === "won" ? "W" : result === "lost" ? "L" : result === "tied" ? "T" : "–"}
      </span>
      <VisuallyHidden>{RESULT_WORD[result]}</VisuallyHidden>
    </span>
  );
}

/** The four steps a player's season goes through, the current one lit. */
function StageTrack({ at }: { at: number }) {
  return (
    <ol
      className="pm-track"
      aria-label={`Step ${String(at + 1)} of ${String(STAGE_STEPS.length)}: ${STAGE_STEPS[at] ?? ""}`}
    >
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

/**
 * BEFORE A TEAM: where this person's season stands — waiting, in the pool,
 * the auction live — on the same four steps My profile draws.
 */
function StageHero({
  registration,
  kind,
  at,
}: {
  registration: MyRegistration;
  kind: HeroKind;
  at: number;
}) {
  const role =
    registration.role === null
      ? null
      : roleLabelIn(sportPackFor(registration.sport), registration.role);
  const base = `/seasons/${registration.competitionSlug}`;
  const copy =
    kind === "waiting"
      ? {
          title: "Your registration is with the organizer",
          line: `${role !== null ? `Registered as ${role === "" ? "a player" : aOrAn(role)}. ` : ""}You'll get a message the moment they approve it — then you're in the auction pool.`,
          door: { label: "Your registration", href: `${base}/register`, primary: false },
        }
      : kind === "waitlisted"
        ? {
            title: "You're on the waitlist",
            line: "If a place opens, the organizer can move you into the pool — we'll message you.",
            door: { label: "Your registration", href: `${base}/register`, primary: false },
          }
        : kind === "auction_live"
          ? {
              title: "The auction is live — you're in the pool",
              line: "Owners are bidding now. We'll message you the moment a team buys you.",
              door: {
                label: "Watch the auction live",
                href: `${base}/auction/spectate`,
                primary: true,
              },
            }
          : kind === "pool"
            ? {
                title: "You're in the auction pool",
                line: "Owners bid for you on auction night — we'll message you the moment a team buys you.",
                door: registration.posterReady
                  ? { label: "Share your card", href: `${base}/posters`, primary: false }
                  : { label: "Your registration", href: `${base}/register`, primary: false },
              }
            : {
                title: `You're in the ${registration.teamName ?? ""} squad`,
                line: "Your matches show here the moment the club publishes the schedule.",
                door: { label: "Your season", href: `${base}/register`, primary: false },
              };
  return (
    <section
      className="pm-stage"
      data-theme="floodlight"
      data-testid="home-stage-hero"
      data-kind={kind}
      aria-labelledby="pm-stage-title"
    >
      <p className="pm-moment-kicker">
        {registration.competitionName} · {registration.orgName}
      </p>
      <div className="pm-stage-main">
        <div className="pm-stage-copy">
          <h2 id="pm-stage-title" className="pm-stage-title">
            {copy.title}
          </h2>
          <p className="pm-stage-line">{copy.line}</p>
        </div>
        <ButtonLink
          href={copy.door.href}
          size="lg"
          variant={copy.door.primary ? "primary" : "secondary"}
        >
          {copy.door.label}
          <IconArrowRight size={16} />
        </ButtonLink>
      </div>
      <StageTrack at={at} />
    </section>
  );
}

function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

/**
 * THE SEASON IS ON: the next match leads, and the season so far in four
 * figures — all from this person's own reads.
 */
function MatchHero({
  registration,
  next,
  record,
  toCome,
  squad,
}: {
  registration: MyRegistration;
  next: UpcomingMatch | undefined;
  record: { played: number; won: number; lost: number };
  toCome: number;
  squad: number | null;
}) {
  const base = `/seasons/${registration.competitionSlug}`;
  const price =
    registration.auction?.kind === "sold"
      ? moneyFormat(registration.auctionUnit).ledger(registration.auction.soldPrice)
      : null;
  const day = next?.kickoffAt?.slice(0, 10) ?? null;
  const today = istCalendarDate();
  const when =
    next === undefined
      ? null
      : day === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)
        ? "Date to be announced"
        : [formatDayDate(day), timeLabel(next.kickoffAt), next.groundName]
            .filter((part): part is string => part !== null && part !== "")
            .join(" · ");
  const soon =
    day === null
      ? "Next match"
      : day === today
        ? "Next match · today"
        : day === tomorrowOf(today)
          ? "Next match · tomorrow"
          : "Next match";
  return (
    <section
      className="pm-match-hero"
      data-theme="floodlight"
      data-testid="home-match-hero"
      aria-labelledby="pm-match-title"
      style={
        registration.teamColor === null
          ? undefined
          : ({ "--pm-team": registration.teamColor } as CSSProperties)
      }
    >
      <p className="pm-moment-kicker">
        {next !== undefined ? soon : "Season on"} · {registration.competitionName}
      </p>
      <div className="pm-stage-main">
        <div className="pm-stage-copy">
          {next !== undefined ? (
            <h2 id="pm-match-title" className="pm-vs">
              <span>
                <i style={{ background: next.teamColor ?? "currentColor" }} aria-hidden />
                {next.teamName}
              </span>
              <span className="pm-vs-word">vs</span>
              <span>
                <i style={{ background: next.opponentColor ?? "currentColor" }} aria-hidden />
                {next.opponentName}
              </span>
            </h2>
          ) : (
            <h2 id="pm-match-title" className="pm-vs">
              {registration.teamName}
            </h2>
          )}
          <p className="pm-stage-line">
            {when ?? "No more matches on the schedule yet — the club publishes them."}
          </p>
        </div>
        {registration.posterReady ? (
          <ButtonLink href={`${base}/posters`} size="lg" variant="secondary">
            Share your card
            <IconArrowRight size={16} />
          </ButtonLink>
        ) : null}
      </div>
      <dl className="pm-figs">
        <div>
          <dt>won – lost</dt>
          <dd>
            {record.won} – {record.lost}
          </dd>
        </div>
        <div>
          <dt>{toCome === 1 ? "match to come" : "matches to come"}</dt>
          <dd>{toCome}</dd>
        </div>
        {price !== null ? (
          <div>
            <dt>your price</dt>
            <dd>{price}</dd>
          </div>
        ) : null}
        {squad !== null ? (
          <div>
            <dt>in the squad</dt>
            <dd>{squad}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function tomorrowOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * THE SECOND OBJECT (wow pass, round 2). Under the sale: the squad they were
 * sold into, and either their next match or — until the schedule exists — the
 * season's top buys. Both come from reads the public pages already publish, so
 * nothing here is more than the season's own page shows a visitor.
 */
function SoldDuo({
  registration,
  team,
  upcoming,
  awaiting = [],
  matches,
  topBuys,
}: {
  registration: MyRegistration;
  team: PublicTeam | null;
  upcoming: UpcomingMatch[];
  /** Matches whose day passed with no result (census 9). */
  awaiting?: UpcomingMatch[];
  matches: CareerMatch[];
  topBuys: PublicTopBuy[];
}) {
  const money = moneyFormat(registration.auctionUnit);
  const mine = upcoming.filter((match) => match.registrationId === registration.registrationId);
  const next = mine[0];
  const owed = awaiting.filter((match) => match.registrationId === registration.registrationId);
  const results = matches.filter(
    (match) => match.registrationId === registration.registrationId && match.result !== null,
  );
  const record = matchRecord(results);
  const seasonHref = `/c/${registration.competitionSlug}`;
  if (team === null && next === undefined && results.length === 0 && topBuys.length === 0) {
    return null;
  }
  return (
    <div className="hd-duo" data-testid="home-player-duo">
      {team !== null ? (
        <SquadList
          team={team}
          selfId={registration.registrationId}
          title="My squad"
          // Three rows and "+N more" stand level with the three top buys and
          // their note beside it (round 5: five rows left ~150px of stretch
          // above the neighbour's foot).
          limit={3}
          headingId="hd-squad-title"
        />
      ) : null}

      {next !== undefined || results.length > 0 || owed.length > 0 ? (
        <section className="hd-card" aria-labelledby="hd-next-title" data-testid="home-matches">
          <div className="hd-head">
            <h2 id="hd-next-title" className="hd-title">
              <IconCalendar size={20} />
              Your matches
              {record.played > 0 ? (
                <span className="hd-title-sub">
                  · {record.played} played · {record.won} won
                </span>
              ) : null}
            </h2>
            <Link className="hd-link" href="/me">
              All matches
              <IconArrowRight size={16} />
            </Link>
          </div>
          <ol className="hd-rows pm-matches">
            {mine.slice(0, 2).map((match) => (
              <li key={match.fixtureId} className="pm-match">
                <span className="pm-match-when">{dayLabel(match.kickoffAt)}</span>
                <span className="hd-who">
                  <span className="hd-name">vs {match.opponentName}</span>
                  <span className="hd-meta">
                    {[timeLabel(match.kickoffAt), match.groundName]
                      .filter((part): part is string => part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </span>
                <span className="pm-match-next">Next</span>
              </li>
            ))}
            {/* Owed a result: said, between what is next and what was played. */}
            {owed.slice(-2).map((match) => (
              <li key={match.fixtureId} className="pm-match" data-state="due">
                <span className="pm-match-when">{dayLabel(match.kickoffAt)}</span>
                <span className="hd-who">
                  <span className="hd-name">vs {match.opponentName}</span>
                  <span className="hd-meta">{match.groundName ?? match.competitionName}</span>
                </span>
                <span className="pm-match-next" data-state="due">
                  Result due
                </span>
              </li>
            ))}
            {results.slice(0, mine.length + owed.length > 0 ? 2 : 4).map((match) => (
              <li key={match.fixtureId} className="pm-match">
                <span className="pm-match-when">{dayLabel(match.kickoffAt)}</span>
                <span className="hd-who">
                  <span className="hd-name">vs {match.opponentName}</span>
                  <span className="hd-meta">{match.competitionName}</span>
                </span>
                <ResultMark result={match.result} />
              </li>
            ))}
          </ol>
        </section>
      ) : topBuys.length > 0 ? (
        <section className="hd-card" aria-labelledby="hd-top-title">
          <div className="hd-head">
            <h2 id="hd-top-title" className="hd-title">
              <IconTrophy size={20} />
              Top buys
              <span className="hd-title-sub">· {registration.competitionName}</span>
            </h2>
            <Link className="hd-link" href={seasonHref}>
              The season
              <IconArrowRight size={16} />
            </Link>
          </div>
          <ol className="hd-rows">
            {topBuys.map((buy, index) => {
              const self = buy.registrationId === registration.registrationId;
              return (
                <li
                  key={buy.registrationId}
                  className="hd-row"
                  data-rank={index + 1}
                  data-self={self}
                >
                  <span className="hd-rank">{String(index + 1)}</span>
                  <PlayerImage
                    name={buy.name}
                    seed={buy.registrationId}
                    src={null}
                    size="sm"
                    shape="round"
                    decorative
                  />
                  <span className="hd-who">
                    <span className="hd-name">
                      {buy.name}
                      {self ? <RosterMark kind="you" className="hd-you" /> : null}
                    </span>
                    <span className="hd-meta">{buy.teamName ?? "Sold"}</span>
                  </span>
                  <span className="hd-figure">{money.ledger(buy.pricePaise)}</span>
                </li>
              );
            })}
          </ol>
          <p className="hd-foot">
            No fixtures yet — your first match shows here the moment{" "}
            <strong>{registration.orgName}</strong> publishes the schedule.
          </p>
        </section>
      ) : null}
    </div>
  );
}

export async function PlayerHome({
  personId,
  offerOrganizing,
}: {
  personId: string;
  /** False for somebody who already runs a club — see the last section. */
  offerOrganizing: boolean;
}) {
  // Today in IST — fixture kickoffs and season dates are local wall-clock text.
  const today = istCalendarDate();
  const [registrations, hasProfile, completeness, career, matches, upcoming, awaiting] =
    await Promise.all([
      myRegistrations(personId),
      hasPlayerProfile(personId),
      profileCompletenessFor(personId),
      playerCareer(personId),
      playerMatches(personId),
      playerUpcomingMatches(personId, today),
      playerAwaitingMatches(personId, today),
    ]);

  // Nudge only somebody the platform can SEE is a player (an entry or a
  // profile row) — a pure organizer's home never asks for a bowling style.
  const showNudge =
    (registrations.length > 0 || hasProfile) && completeness.done < completeness.total;

  /*
   * The sport this person most recently registered in. `myRegistrations` is
   * ordered by start date ASCENDING because that is the order the list reads
   * in, so the most recent season is the LAST row — taking the first sent a
   * footballer to an empty cricket career and told them that was their record.
   */
  const pack = sportPackFor(registrations[registrations.length - 1]?.sport ?? null);

  /*
   * ONE HERO THAT FOLLOWS THE SEASON (2026-09-28). The sale used to lead the
   * page for ever — three matches in, with the next one tomorrow, the loudest
   * thing on it was still the price. Now the newest live season decides:
   * waiting, in the pool, the auction live, sold (until the first match is
   * played), then match day.
   */
  const current: CurrentSeason | null = currentSeason(career.seasons, today);
  const lead =
    current === null
      ? undefined
      : registrations.find((entry) => entry.registrationId === current.season.registrationId);
  const played =
    lead === undefined
      ? 0
      : matches.filter(
          (match) => match.registrationId === lead.registrationId && match.result !== null,
        ).length;
  const leadUpcoming =
    lead === undefined
      ? []
      : upcoming.filter((match) => match.registrationId === lead.registrationId);
  const kind =
    current === null || lead === undefined
      ? null
      : heroKind(current, { played, upcoming: leadUpcoming.length });
  const moment = kind === "sold" || kind === "match" || kind === "squad" ? (lead ?? null) : null;
  const [team, topBuys] =
    moment === null || moment.teamName === null
      ? [null, []]
      : await Promise.all([
          publicTeam(moment.competitionSlug, teamSlugOf(moment.teamName)),
          publicTopBuys(moment.competitionSlug, 3),
        ]);
  const record = matchRecord(
    lead === undefined
      ? []
      : matches.filter((match) => match.registrationId === lead.registrationId),
  );

  return (
    <>
      {lead !== undefined && current !== null && kind !== null ? (
        kind === "sold" ? (
          <SoldMoment registration={lead} />
        ) : kind === "match" ? (
          <MatchHero
            registration={lead}
            next={leadUpcoming[0]}
            record={record}
            toCome={leadUpcoming.length}
            squad={team === null ? null : team.members.length}
          />
        ) : (
          <StageHero registration={lead} kind={kind} at={current.stage.at} />
        )
      ) : null}
      {moment !== null ? (
        <SoldDuo
          registration={moment}
          team={team}
          upcoming={upcoming}
          awaiting={awaiting}
          matches={matches}
          topBuys={topBuys}
        />
      ) : null}
      {showNudge ? (
        <p className="pm-nudge" data-testid="home-profile-nudge">
          <IconUser size={20} />
          {/* "Profile N of M" — the one way /home, /me and /account all say it. */}
          <span>
            <strong>
              Profile {String(completeness.done)} of {String(completeness.total)} done
            </strong>{" "}
            — the next registration form starts filled in.
          </span>
          <Link href="/account">
            Finish it
            <IconArrowRight size={16} />
          </Link>
        </p>
      ) : null}

      {registrations.length > 0 ? (
        <SectionCard
          data-testid="home-registrations"
          icon={<IconFileCheck />}
          concept="season"
          title="My seasons"
          action={
            <Link
              href={`/me?sport=${pack.key}`}
              className="home-more"
              data-testid="home-career-link"
            >
              My {pack.label.toLowerCase()}
              <IconArrowRight size={16} />
            </Link>
          }
        >
          <ul className="home-list">
            {registrations.map((registration) => {
              const verdict = verdictFor(registration);
              return (
                <li key={registration.registrationId} className="home-reg">
                  <Link
                    href={`/seasons/${registration.competitionSlug}/register`}
                    className="home-row-link"
                  >
                    <span className="home-crest" aria-hidden>
                      {monogram(registration.competitionName)}
                    </span>
                    <span className="home-row-text">
                      <strong>{registration.competitionName}</strong>
                      <span>
                        {[
                          registration.orgName,
                          roleLabelIn(sportPackFor(registration.sport), registration.role),
                          // No registration number: it is a receipt to quote to
                          // the club, and the season's own page (this row's
                          // door) still carries it while it matters.
                        ]
                          .filter((part) => part !== "")
                          .join(" · ")}
                      </span>
                      {registration.teamName !== null && !verdict.namesTeam ? (
                        <span>
                          <TeamChip color={registration.teamColor}>
                            {registration.teamName}
                          </TeamChip>
                        </span>
                      ) : null}
                    </span>
                    <Pill tone={verdict.tone} dot testId="home-reg-verdict">
                      {verdict.label}
                    </Pill>
                  </Link>
                  {/* The player's own card — a sibling of the row link, never
                    nested in it, and offered only where a verdict exists. */}
                  {/* An unsold player gets no share card (the share-card rule);
                      the route still draws the verdict, home doesn't offer it. */}
                  {/* …and the season in the hero above already offers its card,
                      so its row does not offer it twice. */}
                  {registration.posterReady &&
                  registration.auction?.kind !== "unsold" &&
                  registration.registrationId !== lead?.registrationId ? (
                    <Link
                      href={`/seasons/${registration.competitionSlug}/posters`}
                      className="home-own-poster"
                      data-testid="my-poster"
                    >
                      Get your card
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ) : null}

      {/*
       * The quiet, permanent door the other way. A player who wants to run
       * their own tournament needs somewhere to start, and it is deliberately
       * not a menu item: a rail item is a promise, and most players will never
       * take this one. Last on the page, every time, is the right amount of
       * offer — and it is withheld from somebody who already runs a club, who
       * was being asked whether they had considered organizing underneath
       * their own club's dashboard.
       */}
      {offerOrganizing ? (
        <p className="pm-organize">
          Want to run your own tournament? Anyone can start a club — no invitation needed.{" "}
          <Link href="/orgs" data-testid="home-player-organize-link">
            Start a club
            <IconArrowRight size={16} />
          </Link>
        </p>
      ) : null}
    </>
  );
}
