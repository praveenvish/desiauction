import "@desiauction/ui/styles/fonts.css";
import "@desiauction/ui/styles/primitives.css";
import "@desiauction/ui/styles/floodlight.css";
import "@desiauction/ui/styles/daylight.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ProductShell } from "../components/shell/product-shell";
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
  const session = await currentSession();
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
    <html lang="en" data-theme="daylight">
      <body>
        <ProductShell
          session={session !== null ? { name: session.name, phone: session.phone } : null}
          orgs={orgs.map((org) => ({
            slug: org.slug,
            name: org.name,
            canFinance: financeOrgs.has(org.id),
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
