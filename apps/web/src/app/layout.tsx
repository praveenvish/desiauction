import "@desiauction/ui/styles/fonts.css";
import "@desiauction/ui/styles/primitives.css";
import "@desiauction/ui/styles/floodlight.css";
import "@desiauction/ui/styles/daylight.css";
import "./base.css";

import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";

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
  title: "DesiAuction",
  description: "Tournament auctions, taken seriously.",
};

// Console default is Daylight; live surfaces pin floodlight per C-4 (doc 18).
// PX-2: the root layout owns the Product Shell — session + the navigation
// reads (orgs, competitions) feed the rail, switchers, context bar and
// command palette. All reads are existing actions; anonymous renders skip them.
export default async function RootLayout({ children }: { children: ReactNode }) {
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
              ? { name: session.name, phone: session.phone, personId: session.personId }
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
