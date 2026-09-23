import { roleLabelIn, sportPackFor } from "@desiauction/core";
import {
  ButtonLink,
  IconArrowRight,
  IconFileCheck,
  IconTrophy,
  IconUser,
  Notice,
  Pill,
  SectionCard,
} from "@desiauction/ui";
import Link from "next/link";

import { monogram } from "../../components/season-hero/season-hero";
import { myRegistrations } from "../../server/competition/public";
import { hasPlayerProfile, profileCompletenessFor } from "../../server/player/profile";
import { REG_TONE } from "./home-parts";

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

  return (
    <>
      {showNudge ? (
        <Notice
          tone="info"
          icon={<IconUser size={20} />}
          testId="home-profile-nudge"
          title={`Complete your player profile — ${String(completeness.done)}/${String(completeness.total)}`}
          action={
            <ButtonLink href="/account" variant="secondary" size="sm">
              Finish it
            </ButtonLink>
          }
        >
          {completeness.missing.length === 1
            ? "One thing left"
            : `${String(completeness.missing.length)} things left`}{" "}
          — the next registration form starts filled in.
        </Notice>
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
              <IconArrowRight size={14} />
            </Link>
          }
        >
          <ul className="home-list">
            {registrations.map((registration) => (
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
                  </span>
                  <Pill tone={REG_TONE[registration.status] ?? "neutral"}>
                    {registration.status}
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
            ))}
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
        <SectionCard
          icon={<IconTrophy />}
          tone="neutral"
          title="Want to run your own?"
          action={
            <ButtonLink
              href="/orgs"
              variant="secondary"
              size="sm"
              data-testid="home-player-organize-link"
            >
              Start a club
              <IconArrowRight size={14} />
            </ButtonLink>
          }
        >
          <p className="home-card-note">
            Anyone can start a club and run an auction on DesiAuction — you do not need to be
            invited.
          </p>
        </SectionCard>
      ) : null}
    </>
  );
}
