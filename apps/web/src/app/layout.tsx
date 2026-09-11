import "@desiauction/ui/styles/fonts.css";
import "@desiauction/ui/styles/primitives.css";
import "@desiauction/ui/styles/floodlight.css";
import "@desiauction/ui/styles/daylight.css";
import "./base.css";

import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";

import { env } from "../env";
import { ProductShell } from "../components/shell/product-shell";
import { THEME_BOOTSTRAP } from "../components/shell/theme-toggle";
import { adminNavVisible } from "../server/admin/actions";
import { currentSession, logoutAction } from "../server/auth/actions";
import { latestSecurityEventAt } from "../server/auth/security-events";
import { competitionsView } from "../server/competition/actions";
import { myOrgs } from "../server/orgs/actions";
import { finopsOrgIds } from "../server/financial-operations/actions";
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
  let session: Awaited<ReturnType<typeof currentSession>> = null;
  try {
    session = await currentSession();
  } catch (error) {
    unstable_rethrow(error);
    // `no-console` is on for apps/web because the app has no logger of its own
    // and stray logs are noise. This one is the exact opposite: the degraded
    // render is deliberately invisible to the visitor, so stderr is the only
    // place a database outage can still announce itself. Silence here would
    // turn a production incident into a mystery.
    // eslint-disable-next-line no-console
    console.error("[shell] session lookup failed; rendering the signed-out header", error);
  }
  // PX-7: the Money tab is gated by `settlement.view`, so the shell needs the
  // person's settlement orgs. It is ONE grants read, expanded by settlement's
  // own capability engine — the nav and the surface share one answer.
  // PX-9 adds `isAdmin` to the same one-shot fan-out: the avatar menu's Platform
  // admin door is revealed by the SAME evaluation the surface gates on, so the
  // nav and the console can never disagree about who is staff.
  const [orgs, competitionsView_, settlementOrgs, financeOrgs, latestEventAt, isAdmin] =
    session !== null
      ? await Promise.all([
          myOrgs(),
          competitionsView(),
          settlementOrgIds().then((ids) => new Set(ids)),
          finopsOrgIds().then((ids) => new Set(ids)),
          latestSecurityEventAt(session.personId).then((at) => at?.toISOString() ?? null),
          adminNavVisible(),
        ])
      : [[], null, new Set<string>(), new Set<string>(), null, false];

  const orgSlugById = new Map(orgs.map((org) => [org.id, org.slug]));
  const competitions = (competitionsView_?.competitions ?? []).map((competition) => ({
    slug: competition.slug,
    name: competition.name,
    orgName: competition.orgName,
    orgSlug: orgSlugById.get(competition.orgId) ?? "",
    canSettle: settlementOrgs.has(competition.orgId),
  }));
  return (
    // `suppressHydrationWarning`: the bootstrap below rewrites `data-theme`
    // before React hydrates, which is a deliberate server/client difference.
    <html lang="en" data-theme="daylight" suppressHydrationWarning>
      <body>
        {/* Replay the remembered console theme before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
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
          isAdmin={isAdmin}
          latestEventAt={latestEventAt}
          logout={logoutAction}
        >
          {children}
        </ProductShell>
      </body>
    </html>
  );
}
