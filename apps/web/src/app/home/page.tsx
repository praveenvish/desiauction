import { LoadingState } from "@desiauction/ui";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageTitle } from "../../components/shell/page-title";
import { currentSession } from "../../server/auth/actions";
import { myRegistrations } from "../../server/competition/public";
import { currentTeam, rolesOf, type PersonRoles } from "../../server/roles/roles";
import { AuctioneerHome } from "./auctioneer-home";
import { greetingFor } from "./home-parts";
import { homeSections } from "./home-router";
import { MemberHome } from "./member-home";
import { NewcomerHome } from "./newcomer-home";
import { chooseNextStep, type NextStep } from "./next-step";
import { NextStepBanner } from "./next-step-banner";
import { OrganizerHome } from "./organizer-home";
import { OwnerHome } from "./owner-home";
import { PlayerHome } from "./player-home";
import "./home.css";

export const metadata = { title: "Home · DesiAuction" };

/**
 * /HOME IS A ROUTER (RN-1 Phase 3).
 *
 * It was one 1670-line component with `manages ?` woven through its render, so
 * a role's home was not a thing anyone could design, review or test — it was a
 * set of conditions inside somebody else's page, and the conditions had already
 * drifted (a team owner got the club's whole calendar; a player got the profile
 * nudge and nothing else; an auctioneer got a banner and no record at all).
 *
 * Now: one file per role, each loading only its own data. A player's visit no
 * longer runs the season scan, the money roll-up and the activity feed in order
 * to render none of them.
 *
 * COMPOSITION, NOT SELECTION. Somebody can be several of these at once, so the
 * sections stack in the menu's own precedence order (nav.ts §3.1) — which is
 * what lets the rail cap at five items: Home is the union surface, so anything
 * the cap drops is still exactly one tap away, here.
 */
export default async function HomePage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/home");
  }
  if (session.name === null || session.name.trim() === "") {
    redirect("/onboarding");
  }
  return (
    <main className="home">
      <Suspense fallback={<LoadingState variant="page" />}>
        <HomeBody personId={session.personId} name={session.name} />
      </Suspense>
    </main>
  );
}

/**
 * WHAT YOU HAVE, in one line under the greeting.
 *
 * The founder's "they should know exactly what they have". Roles in the same
 * precedence order as the menu, so the sentence and the rail agree.
 */
function identityLine(roles: PersonRoles, entries: number): string {
  const parts: string[] = [];
  if (roles.organizes.length > 0) {
    const club = roles.organizes[0];
    parts.push(
      roles.organizes.length === 1 && club !== undefined
        ? `Organizer · ${club.name}`
        : `Organizer · ${String(roles.organizes.length)} clubs`,
    );
  }
  if (roles.owns.length > 0) {
    const team = roles.owns[0];
    parts.push(
      roles.owns.length === 1 && team !== undefined
        ? `Owner · ${team.teamName}`
        : `Owner · ${String(roles.owns.length)} teams`,
    );
  }
  if (roles.conducts.length > 0) {
    parts.push(
      roles.conducts.length === 1
        ? "Auctioneer"
        : `Auctioneer · ${String(roles.conducts.length)} nights`,
    );
  }
  if (roles.plays && entries > 0) {
    parts.push(`${String(entries)} season${entries === 1 ? "" : "s"} played`);
  }
  if (parts.length === 0 && roles.memberOf.length > 0) {
    parts.push(`Member of ${roles.memberOf.map((club) => club.name).join(", ")}`);
  }
  return parts.join(" · ") || "Welcome";
}

async function HomeBody({ personId, name }: { personId: string; name: string }) {
  const roles = await rolesOf(personId);
  const manages = roles.organizes.length > 0;
  /*
   * WHICH SECTIONS, decided by the pure ruling in ./home-router — which is what
   * home-router.test.ts pins. The page composes; it does not choose.
   */
  const sections = new Set(
    homeSections({
      manages,
      owns: roles.owns.length > 0,
      conducts: roles.conducts.length > 0,
      plays: roles.plays,
      belongsToClub: roles.memberOf.length > 0,
    }),
  );
  const newcomer = sections.has("newcomer");

  /*
   * Read only for the line under the greeting, and only when this person plays.
   * It is `cache`d and PlayerHome asks for it too, so the two share one query.
   */
  const entries = roles.plays ? (await myRegistrations(personId)).length : 0;

  /*
   * THE ONE THING TO DO NEXT, chosen across every role at once — which is why
   * it lives here and not in any single role's home. The organizer's inputs
   * (a live season, the attention scan) are expensive and only that home has
   * them, so it is handed this closure and calls it with what it loaded. Every
   * other role's inputs are already here.
   */
  const team = currentTeam(roles);
  const nextStepFor = (input: {
    managedLive: { competitionSlug: string; competitionName: string } | null;
    attention: { label: string; detail: string; href: string }[];
  }): NextStep | null =>
    chooseNextStep({
      ownedTeam: team,
      managedLive: input.managedLive,
      attention: input.attention,
      latestEntry: null,
      brandNew: newcomer,
      conducting:
        roles.conducts.find(
          (row) => row.auctionStatus !== "completed" && row.auctionStatus !== "reconciled",
        ) ?? null,
    });

  /*
   * Roles that do not reach OrganizerHome still deserve the banner, so it is
   * rendered here for them — the organizer's own copy sits above its ladder,
   * where it can defer to the ladder on a brand-new club.
   *
   * Except a newcomer: `NewcomerHome` IS their next step, full-bleed. Rendering
   * both put two identical "Create your club" buttons on one page, carrying the
   * same test hook — which is how the e2e suite found it, and how a reader
   * would have met the same question asked twice in a row.
   */
  const standaloneStep =
    sections.has("organizer") || sections.has("newcomer")
      ? null
      : nextStepFor({ managedLive: null, attention: [] });

  return (
    <>
      <PageTitle title={greetingFor(new Date(), name)} subtitle={identityLine(roles, entries)} />
      {standaloneStep !== null ? <NextStepBanner step={standaloneStep} /> : null}
      {sections.has("newcomer") ? <NewcomerHome /> : null}
      {sections.has("owner") ? <OwnerHome teams={roles.owns} /> : null}
      {sections.has("auctioneer") ? <AuctioneerHome seasons={roles.conducts} /> : null}
      {sections.has("organizer") ? (
        <Suspense fallback={<LoadingState variant="page" />}>
          <OrganizerHome nextStepFor={nextStepFor} />
        </Suspense>
      ) : null}
      {sections.has("player") ? (
        <Suspense fallback={<LoadingState variant="cards" />}>
          <PlayerHome personId={personId} offerOrganizing={!manages} />
        </Suspense>
      ) : null}
      {sections.has("member") ? <MemberHome clubCount={roles.memberOf.length} /> : null}
    </>
  );
}
