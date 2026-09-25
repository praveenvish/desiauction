import { roleLabelIn, sportPackFor } from "@desiauction/core";
import {
  ButtonLink,
  IconArrowRight,
  IconFileCheck,
  IconUser,
  Pill,
  SectionCard,
  TeamChip,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import type { CSSProperties } from "react";

import { monogram } from "../../components/season-hero/season-hero";
import { moneyFormat } from "../../lib/money";
import { myRegistrations, type MyRegistration } from "../../server/competition/public";
import { hasPlayerProfile, profileCompletenessFor } from "../../server/player/profile";
import { verdictOf } from "../me/registration-card";
import "./player-home.css";

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
        <ButtonLink
          href={`${base}/register`}
          size="lg"
          variant={registration.posterReady ? "secondary" : "primary"}
        >
          Your season
        </ButtonLink>
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

  return (
    <>
      {moment !== null ? (
        <SoldMoment registration={moment} completeness={showNudge ? completeness : null} />
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
          tone="green"
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
                  {registration.posterReady ? (
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
