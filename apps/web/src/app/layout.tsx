import "@desiauction/ui/styles/fonts.css";
import "@desiauction/ui/styles/primitives.css";
import "@desiauction/ui/styles/floodlight.css";
import "@desiauction/ui/styles/daylight.css";
import "@desiauction/ui/styles/motion.css";
import "./base.css";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";

import { env } from "../env";
import { ReportProblemProvider } from "../components/report-problem/report-problem";
import { AppLinkProvider } from "../components/shell/app-link-provider";
import { NavigationProgress } from "../components/shell/navigation-progress";
import { ProductShell } from "../components/shell/product-shell";
import { THEME_BOOTSTRAP } from "../components/shell/theme-toggle";
import { platformDoorCapabilities } from "../server/admin/actions";
import { currentSession, logoutAction } from "../server/auth/actions";
import { latestSecurityEventAt } from "../server/auth/security-events";
import { competitionsView } from "../server/competition/actions";
import { myOrgs } from "../server/orgs/actions";
import { rolesOf } from "../server/roles/roles";
import { seasonRoleFor, type NavRoles, type SeasonRole } from "../components/shell/nav";
import { myRegistrations } from "../server/competition/public";
import { finopsOrgIds } from "../server/financial-operations/actions";
import { requestLogger } from "../server/logger";
import { settlementOrgIds } from "../server/settlement/actions";

export const metadata: Metadata = {
  // WITHOUT metadataBase, Next resolves every relative metadata URL — including
  // the file-based share cards — against a localhost default and says so in a
  // build warning. The share card is the one asset whose whole job is to be
  // fetched by somebody else's server, so the origin has to be real.
  metadataBase: new URL(env.PUBLIC_BASE_URL),
  title: "DesiAuction",
  description: "Tournament auctions, taken seriously.",
  // Defaults, inherited by every route that does not state its own. Pages with
  // a richer card (a competition, a player, pricing) still win — a file lower
  // in the tree, and an explicit `openGraph` on a page, both override this.
  openGraph: {
    siteName: "DesiAuction",
    type: "website",
    locale: "en_IN",
  },
  twitter: { card: "summary_large_image" },
};

// Console default is Daylight; live surfaces pin floodlight per C-4 (doc 18).
// PX-2: the root layout owns the Product Shell — session + the navigation
// reads (orgs, competitions) feed the rail, switchers, context bar and
// command palette. All reads are existing actions; anonymous renders skip them.
export default async function RootLayout({
  children,
  action,
}: {
  children: ReactNode;
  /**
   * THE PAGE'S PRIMARY ACTION, RESOLVED BY THE ROUTER RATHER THAN PUBLISHED
   * AFTER HYDRATION.
   *
   * `@action` is a parallel route: the router resolves it alongside `children`
   * and hands both here, so the button is part of the SERVER render of the
   * shell. It used to arrive through a React context that `PageAction`
   * published from a `useEffect` — which never runs on the server, so the first
   * paint had no action, hydration inserted one, and every console surface
   * carrying an action shifted its content down by ~106px (CLS 0.123, and 0.15
   * on /home). Routes with no action resolve to `@action/default.tsx`, which
   * renders nothing.
   *
   * The context channel still exists and still wins when something publishes,
   * because /tournaments swaps its action with a client-side view toggle. What
   * it no longer has to do is deliver the FIRST one.
   *
   * REQUIRED, and the build enforces it: Next generates `LayoutProps` from the
   * app directory, so once `@action` exists the slot is part of this layout's
   * contract. Declaring it optional now fails the build — which is the right
   * way round, and worth knowing if the first build after adding a slot errors
   * the OTHER way (the generated type is still the pre-slot one until one build
   * completes).
   */
  action: ReactNode;
}) {
  // The session read is the ONE database call every page in the product makes,
  // including the marketing pages that need no database at all. Unguarded, a
  // Postgres blip turned `GET /` into a 500 — a landing page taken out by an
  // outage it does not depend on. A failed lookup now degrades to exactly what
  // an expired cookie already produces: the signed-out header. It is logged,
  // not swallowed, so a real outage still shows up in the server logs; and
  // `unstable_rethrow` lets Next's own control-flow signals (redirect,
  // notFound, the dynamic-rendering bailout) through untouched, so this can
  // never silently freeze a dynamic render into a static, permanently
  // signed-out shell.
  // Minted per request by middleware.ts; absent only when middleware did not
  // run (a prefetch), in which case the inline script below renders without it
  // exactly as it did before there was a policy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  let session: Awaited<ReturnType<typeof currentSession>> = null;
  try {
    session = await currentSession();
  } catch (error) {
    unstable_rethrow(error);
    // The degraded render is deliberately invisible to the visitor, so the log
    // is the only place a database outage can still announce itself. Silence
    // here would turn a production incident into a mystery.
    (await requestLogger()).error({ err: error }, "shell.session_lookup_failed");
  }
  // PX-7: the Money tab is gated by `settlement.view`, so the shell needs the
  // person's settlement orgs. It is ONE grants read, expanded by settlement's
  // own capability engine — the nav and the surface share one answer.
  // PX-9 adds `isAdmin` to the same one-shot fan-out: the avatar menu's Platform
  // admin door is revealed by the SAME evaluation the surface gates on, so the
  // nav and the console can never disagree about who is staff.
  //
  // GUARDED LIKE THE SESSION READ, AND FOR THE SAME REASON. These seven reads
  // run on every signed-in render of every route, so an unguarded blip in any
  // one of them replaced the whole product — marketing pages included — with
  // Next's unstyled default error (the root layout sits ABOVE `error.tsx`, so
  // no boundary of ours can catch it). A failure now degrades to the
  // signed-out shell the session guard already produces: the page still
  // renders, and the next request tries again.
  //
  // The registrations read rides on `rolesOf` rather than behind the whole
  // fan-out: it only runs for somebody who plays, and it is the one read here
  // that has to wait for another's answer — so it waits for that one alone.
  const signedOut = {
    orgs: [] as Awaited<ReturnType<typeof myOrgs>>,
    competitionsView_: null as Awaited<ReturnType<typeof competitionsView>> | null,
    settlementOrgs: new Set<string>(),
    financeOrgs: new Set<string>(),
    latestEventAt: null as string | null,
    platform: [] as Awaited<ReturnType<typeof platformDoorCapabilities>>,
    roles: null as Awaited<ReturnType<typeof rolesOf>> | null,
    registered: [] as Awaited<ReturnType<typeof myRegistrations>>,
  };
  let shell = signedOut;
  if (session !== null) {
    const personId = session.personId;
    try {
      const [orgs, competitionsView_, settlementOrgs, financeOrgs, latestEventAt, platform, lens] =
        await Promise.all([
          myOrgs(),
          competitionsView(),
          settlementOrgIds().then((ids) => new Set(ids)),
          finopsOrgIds().then((ids) => new Set(ids)),
          latestSecurityEventAt(personId).then((at) => at?.toISOString() ?? null),
          platformDoorCapabilities(),
          rolesOf(personId).then(async (roles) => ({
            roles,
            registered: roles.plays ? await myRegistrations(personId) : [],
          })),
        ]);
      shell = {
        orgs,
        competitionsView_,
        settlementOrgs,
        financeOrgs,
        latestEventAt,
        platform,
        roles: lens.roles,
        registered: lens.registered,
      };
    } catch (error) {
      unstable_rethrow(error);
      (await requestLogger()).error({ err: error }, "shell.navigation_reads_failed");
      session = null;
    }
  }
  const { orgs, competitionsView_, settlementOrgs, financeOrgs, latestEventAt, platform, roles } =
    shell;
  /*
   * WHAT THE MENU OFFERS THIS PERSON (RN-1). Facts in, menu out — `nav.ts`
   * decides the shape, this only translates `server/roles` into its vocabulary.
   *
   * Note what is NOT passed: `memberOf`. Membership is not a role. It confers
   * read access and never a menu item, which is what stops `acceptOwnerJoin` —
   * it makes every team owner a viewer-level member of the host club — from
   * handing a player who accepted a team the whole organizer product.
   *
   * Nothing here is ordered or truncated: `navigationFor` owns the precedence
   * and the cap, so the two can never drift apart across a server boundary.
   */
  const isLive = (status: string | null): boolean => status === "live" || status === "paused";
  const navRoles: NavRoles | null =
    roles === null
      ? null
      : {
          organizes: roles.organizes.length > 0,
          // EVERY team, not `currentTeam()`'s one: an owner with teams in two
          // seasons used to lose one of them to that reduction without a trace.
          teams: roles.owns.map((team) => ({
            label: team.teamName,
            seasonSlug: team.competitionSlug,
            seasonName: team.competitionName,
            live: isLive(team.auctionStatus),
          })),
          conducts: roles.conducts.map((season) => ({
            label: season.competitionName,
            seasonSlug: season.competitionSlug,
            seasonName: season.competitionName,
            live: isLive(season.auctionStatus),
          })),
          plays: roles.plays,
          // Money earned its rail slot back for the people who have books, and
          // stays absent for everyone else (LAW 3). Both partitions count: the
          // settlement desk and the finance desk are separate keys.
          hasBooks: settlementOrgs.size > 0 || financeOrgs.size > 0,
          platform,
        };

  const orgSlugById = new Map(orgs.map((org) => [org.id, org.slug]));

  /*
   * WHO THIS PERSON IS IN EACH SEASON (RN-1 Phase 4).
   *
   * Not globally — somebody organizes club A, owns a team in season B and plays
   * in season C, and the season workspace is the one place where that genuinely
   * differs per object. The tab strip used to ask one and a half booleans
   * (`canManage`, `canSettle`), so a team owner was handed six tabs and neither
   * "My plan" nor "My squad" was among them.
   *
   * The registrations read (in the fan-out above) is skipped entirely for
   * somebody who does not play.
   */
  const managedLevel = new Map((roles?.organizes ?? []).map((club) => [club.orgId, club.level]));
  const memberOrgIds = new Set((roles?.memberOf ?? []).map((club) => club.orgId));
  const conductedSlugs = new Set((roles?.conducts ?? []).map((season) => season.competitionSlug));
  const ownedSlugs = new Set((roles?.owns ?? []).map((team) => team.competitionSlug));
  const registeredSlugs = new Set(shell.registered.map((row) => row.competitionSlug));

  const competitions = (competitionsView_?.competitions ?? []).map((competition) => ({
    slug: competition.slug,
    name: competition.name,
    status: competition.status,
    location: competition.location,
    startsOn: competition.startsOn,
    orgName: competition.orgName,
    orgSlug: orgSlugById.get(competition.orgId) ?? "",
    // A points season (0091) has nothing to settle: no Money tab, no settle
    // shortcut in search, whatever the person's grants in the club.
    canSettle: settlementOrgs.has(competition.orgId) && competition.auctionUnit === "inr",
    seasonRole: seasonRoleFor({
      manages: managedLevel.get(competition.orgId) ?? null,
      conducts: conductedSlugs.has(competition.slug),
      ownsTeam: ownedSlugs.has(competition.slug),
      registered: registeredSlugs.has(competition.slug),
      member: memberOrgIds.has(competition.orgId),
    }) satisfies SeasonRole,
  }));
  return (
    // `suppressHydrationWarning`: the bootstrap below rewrites `data-theme`
    // before React hydrates, which is a deliberate server/client difference.
    <html lang="en" data-theme="daylight" suppressHydrationWarning>
      <body>
        {/* Replay the remembered console theme before first paint (no flash).
            The one inline script the app writes itself, so it carries the
            request's nonce like every script Next emits (middleware.ts).
            `suppressHydrationWarning`: browsers HIDE a nonce once the
            element is parsed (the attribute reads back as ""), so exfiltrating
            it through the DOM is impossible — and React, comparing the server's
            nonce with that empty attribute, reports a mismatch that is the
            security feature working. It suppresses this element's own
            attributes only. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
        />
        {/* Every shell, every route: a click is answered before the network is. */}
        <NavigationProgress />
        <AppLinkProvider>
          <ReportProblemProvider signedIn={session !== null} defaultEmail={session?.email ?? null}>
            <ProductShell
              session={
                session !== null
                  ? {
                      name: session.name,
                      phone: session.phone,
                      email: session.email,
                      personId: session.personId,
                    }
                  : null
              }
              orgs={orgs.map((org) => ({
                slug: org.slug,
                name: org.name,
                canFinance: financeOrgs.has(org.id),
                // Settlement and Finance are separate capability partitions, and
                // the money tab strip spans both. Without this the strip was built
                // from membership alone, so someone with neither key saw four tabs
                // that all 404 for them.
                canSettle: settlementOrgs.has(org.id),
              }))}
              competitions={competitions}
              serverAction={action}
              navRoles={navRoles}
              latestEventAt={latestEventAt}
              logout={logoutAction}
            >
              {children}
            </ProductShell>
          </ReportProblemProvider>
        </AppLinkProvider>
      </body>
    </html>
  );
}
