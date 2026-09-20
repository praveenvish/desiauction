import { roleLabelIn, sportPackFor } from "@desiauction/core";
import { Badge, Card, SectionHeader, IconArrowRight } from "@desiauction/ui";
import Link from "next/link";

import { myRegistrations } from "../../server/competition/public";
import { hasPlayerProfile, profileCompletenessFor } from "../../server/player/profile";
import { monogram, REG_TONE } from "./home-parts";

/**
 * THE PLAYER'S HOME.
 *
 * Its one job (RN-1 §0): am I in, when is it, and what did I get. Everything
 * here is about THIS person's entries — there is no dashboard, no lifecycle
 * rail, no money roll-up and no attention queue, because a player can act on
 * none of them and used to be shown all of them.
 *
 * The last row is the quiet, permanent door the other way. A player who wants
 * to run their own tournament needs somewhere to start, and it is deliberately
 * not a menu item: a rail item is a promise, and most players will never take
 * this one. Last on the page, every time, is the right amount of offer.
 *
 * It is withheld from somebody who ALREADY runs a club — an organizer who also
 * plays was being asked whether they had considered organizing, underneath
 * their own club's dashboard.
 */
export async function PlayerHome({
  personId,
  offerOrganizing,
}: {
  personId: string;
  /** False for somebody who already runs a club — see the section below. */
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
        <Card className="home-profile-nudge" data-testid="home-profile-nudge">
          <div className="home-attn">
            <span className="home-attn-text">
              <strong>
                Complete your player profile — {completeness.done}/{completeness.total}
              </strong>
              <span>
                {completeness.missing.length === 1
                  ? "One thing left"
                  : `${String(completeness.missing.length)} things left`}{" "}
                — the next registration form starts filled in.
              </span>
            </span>
            <Link href="/account" className="home-own-poster">
              Finish it
            </Link>
          </div>
        </Card>
      ) : null}

      {registrations.length > 0 ? (
        <>
          <SectionHeader
            title="My seasons"
            actions={
              <Link href={`/me/${pack.key}`} data-testid="home-career-link">
                My {pack.label.toLowerCase()}
                <IconArrowRight size={16} className="icon-trail" />
              </Link>
            }
          />
          <Card data-testid="home-registrations">
            <ul className="home-list">
              {registrations.map((registration) => (
                <li key={registration.registrationId}>
                  <Link
                    href={`/seasons/${registration.competitionSlug}/register`}
                    className="home-attn"
                  >
                    <span className="home-crest home-crest--sm" aria-hidden>
                      {monogram(registration.competitionName)}
                    </span>
                    <span className="home-attn-text">
                      <strong>{registration.competitionName}</strong>
                      <span>
                        {registration.orgName} ·{" "}
                        {roleLabelIn(sportPackFor(registration.sport), registration.role)} ·{" "}
                        {registration.number}
                      </span>
                    </span>
                    <Badge tone={REG_TONE[registration.status] ?? "neutral"}>
                      {registration.status}
                    </Badge>
                  </Link>
                  {/* A sibling of the row, not a child: the row is already one
                      big link, and an anchor inside an anchor is invalid HTML
                      that browsers repair by dropping one — usually not the one
                      you meant. Offered only where a verdict exists. */}
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
          </Card>
        </>
      ) : null}

      {offerOrganizing ? (
        <section className="home-aside" aria-labelledby="home-player-organize">
          <h2 id="home-player-organize" className="home-flat-title">
            Want to run your own?
          </h2>
          <p>
            Anyone can start a club and run an auction on DesiAuction — you do not need to be
            invited.
          </p>
          <Link href="/orgs" className="home-own-poster" data-testid="home-player-organize-link">
            Start a club
            <IconArrowRight size={16} className="icon-trail" />
          </Link>
        </section>
      ) : null}
    </>
  );
}
