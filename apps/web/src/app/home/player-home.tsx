import { roleLabelIn, sportPackFor } from "@desiauction/core";
import {
  ButtonLink,
  IconArrowRight,
  IconCalendar,
  IconFileCheck,
  IconTrophy,
  IconUser,
  IconUsers,
  Pill,
  PlayerImage,
  SectionCard,
  TeamChip,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import type { CSSProperties } from "react";

import { monogram } from "../../components/season-hero/season-hero";
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
import { playerUpcomingMatches, type UpcomingMatch } from "../../server/player/career";
import { hasPlayerProfile, profileCompletenessFor } from "../../server/player/profile";
import { verdictOf } from "../me/registration-card";
import "./home-duo.css";
import "./player-home.css";
import { dateTile, istCalendarDate } from "../../lib/format-date";

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
function SoldMoment({
  registration,
  completeness,
}: {
  registration: MyRegistration;
  completeness: { done: number; total: number } | null;
}) {
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
      {completeness !== null ? (
        <p className="pm-moment-foot">
          <span>
            Profile {String(completeness.done)}/{String(completeness.total)} — the next registration
            form starts filled in.
          </span>
          <Link href="/account">
            Finish it
            <IconArrowRight size={16} />
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/** "2026-10-04 09:30" (local wall-clock text) → { day: "4", month: "Oct" }. */
function dateBlock(kickoffAt: string | null): { day: string; month: string } | null {
  if (kickoffAt === null) return null;
  const day = kickoffAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return dateTile(day);
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
  topBuys,
}: {
  registration: MyRegistration;
  team: PublicTeam | null;
  upcoming: UpcomingMatch[];
  topBuys: PublicTopBuy[];
}) {
  const money = moneyFormat(registration.auctionUnit);
  // Five faces, and always their own among them.
  const selfRow = team?.members.find((m) => m.registrationId === registration.registrationId);
  const firstFive = team === null ? [] : team.members.slice(0, 5);
  const mates =
    selfRow === undefined || firstFive.includes(selfRow)
      ? firstFive
      : [selfRow, ...firstFive.slice(0, 4)];
  const next = upcoming.find((match) => match.competitionSlug === registration.competitionSlug);
  const when = next === undefined ? null : dateBlock(next.kickoffAt);
  const seasonHref = `/c/${registration.competitionSlug}`;
  if (team === null && next === undefined && topBuys.length === 0) return null;
  return (
    <div className="hd-duo" data-testid="home-player-duo">
      {team !== null ? (
        <section className="hd-card" aria-labelledby="hd-squad-title">
          <div className="hd-head">
            <h2 id="hd-squad-title" className="hd-title">
              <IconUsers size={20} />
              My squad
              <span className="hd-title-sub">· {String(team.members.length)} players</span>
            </h2>
            <Link className="hd-link" href={`${seasonHref}/t/${team.team.slug}`}>
              See all
              <IconArrowRight size={16} />
            </Link>
          </div>
          <ul className="hd-rows" data-plain="true">
            {mates.map((member) => {
              const self = member.registrationId === registration.registrationId;
              return (
                <li key={member.registrationId} className="hd-row" data-self={self}>
                  <PlayerImage
                    name={member.name}
                    seed={member.registrationId}
                    src={member.photoUrl}
                    size="sm"
                    shape="round"
                    decorative
                  />
                  <span className="hd-who">
                    <span className="hd-name">
                      {member.name}
                      {self ? <span className="hd-you">You</span> : null}
                    </span>
                    <span className="hd-meta">
                      {roleLabelIn(sportPackFor(team.sport), member.role) || "Player"}
                    </span>
                  </span>
                  <span
                    className="hd-figure"
                    data-muted={member.pricePaise === null ? "true" : undefined}
                  >
                    {member.pricePaise === null ? "Pre-signed" : money.ledger(member.pricePaise)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {next !== undefined ? (
        <section className="hd-card" aria-labelledby="hd-next-title">
          <div className="hd-head">
            <h2 id="hd-next-title" className="hd-title">
              <IconCalendar size={20} />
              Next match
            </h2>
            <Link className="hd-link" href="/me">
              All matches
              <IconArrowRight size={16} />
            </Link>
          </div>
          <div className="hd-match">
            <span className="hd-date" aria-hidden={when === null}>
              {when === null ? (
                <IconCalendar size={24} />
              ) : (
                <>
                  <b>{when.day}</b>
                  <small>{when.month}</small>
                </>
              )}
            </span>
            <span className="hd-vs">
              <strong>
                {next.teamName} vs {next.opponentName}
              </strong>
              <span className="hd-meta">
                {next.kickoffAt === null ? "Date to be announced" : next.kickoffAt.slice(11, 16)}
                {" · "}
                {next.competitionName}
              </span>
            </span>
          </div>
          {upcoming.length > 1 ? (
            <p className="hd-foot">
              Then <strong>{String(upcoming.length - 1)} more</strong> published{" "}
              {upcoming.length === 2 ? "match" : "matches"} on your calendar.
            </p>
          ) : null}
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
                      {self ? <span className="hd-you">You</span> : null}
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
  const [registrations, hasProfile, completeness] = await Promise.all([
    myRegistrations(personId),
    hasPlayerProfile(personId),
    profileCompletenessFor(personId),
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
  // The most recent sale leads the page (the list is oldest-first).
  const moment =
    [...registrations]
      .reverse()
      .find((entry) => entry.auction?.kind === "sold" && entry.teamName !== null) ?? null;
  // Today in IST — fixture kickoffs are local wall-clock text (as /me reads it).
  const today = istCalendarDate();
  const [team, upcoming, topBuys] =
    moment === null || moment.teamName === null
      ? [null, [], []]
      : await Promise.all([
          publicTeam(moment.competitionSlug, teamSlugOf(moment.teamName)),
          playerUpcomingMatches(personId, today),
          publicTopBuys(moment.competitionSlug, 3),
        ]);

  return (
    <>
      {moment !== null ? (
        <SoldMoment registration={moment} completeness={showNudge ? completeness : null} />
      ) : null}
      {moment !== null ? (
        <SoldDuo registration={moment} team={team} upcoming={upcoming} topBuys={topBuys} />
      ) : null}
      {showNudge && moment === null ? (
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
            <Link href={`/me/${pack.key}`} className="home-more" data-testid="home-career-link">
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
                        {registration.orgName} ·{" "}
                        {roleLabelIn(sportPackFor(registration.sport), registration.role)} ·{" "}
                        {registration.number}
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
                  {/* …and the season in the sold moment above already offers its
                      card, so its row does not offer it twice. */}
                  {registration.posterReady &&
                  registration.auction?.kind !== "unsold" &&
                  registration.registrationId !== moment?.registrationId ? (
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
