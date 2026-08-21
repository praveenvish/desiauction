import { Badge, ButtonLink, Card, PageIntro } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auctionDashboard } from "../../../../server/auction/actions";
import { competitionView, registrationDashboard } from "../../../../server/competition/actions";
import { fixtureDashboard, venuesView } from "../../../../server/competition/fixture-actions";
import { myOrgs } from "../../../../server/orgs/actions";
import "../../seasons.css";

export const metadata = { title: "Readiness · DesiAuction" };

// PX-4 Readiness Center: ONE unified view that SURFACES existing validation.
// The only pass/fail authority here is the platform's own AuctionReady
// projection (auction-ready.ts); everything else is counts from existing
// dashboards with links to the screen that changes them. No rules invented.
export default async function ReadinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await competitionView(slug);
  if (view === null) {
    notFound();
  }
  const [registrations, fixtures, auction, orgs] = await Promise.all([
    registrationDashboard(slug, {}),
    fixtureDashboard(slug, {}),
    auctionDashboard(slug),
    myOrgs(),
  ]);
  const org = orgs.find((entry) => entry.id === view.competition.orgId) ?? null;
  const venues = org !== null ? await venuesView(org.slug) : null;
  const activeGrounds =
    venues?.venues.flatMap((venue) => venue.grounds).filter((g) => g.status === "active").length ??
    0;
  const base = `/seasons/${slug}`;
  const checks = auction?.ready.checks ?? [];
  const blockers = checks.filter((check) => !check.pass).length;
  /**
   * THE VERDICT MUST NOT CONTRADICT THE ROW UNDER IT.
   *
   * Squad feasibility is deliberately NOT a blocker (see the note on its row
   * below: a league may knowingly run short, but must not find out at closing
   * time). That decision is right and is unchanged here. What was wrong was the
   * PRESENTATION: with no blockers the header showed a plain green "Ready for
   * auction" while the card immediately beneath it read "Short — 2 players
   * cannot fill 4 squads of at least 2". On the one screen whose entire job is
   * to answer "can I start?", the summary and the detail disagreed and nothing
   * reconciled them. The verdict now carries the caveat it was hiding.
   */
  const runningShort = auction !== null && !auction.feasibility.ok;

  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <PageIntro
          subtitle="Every row links to the screen that changes it. Pass/fail comes from the platform's own auction-readiness checks."
          actions={
            auction !== null && blockers === 0 ? (
              <Badge tone={runningShort ? "warning" : "success"} data-testid="readiness-verdict">
                {runningShort ? "Ready — but running short" : "Ready for auction"}
              </Badge>
            ) : (
              <Badge tone="warning" data-testid="readiness-verdict">
                {blockers > 0
                  ? `${String(blockers)} blocker${blockers === 1 ? "" : "s"}`
                  : "In preparation"}
              </Badge>
            )
          }
        />

        <Card data-testid="readiness-auction">
          <h2>Auction gates</h2>
          {auction === null ? (
            <p className="competitions-hint">
              Sign-in lacks access to this season&apos;s auction view.
            </p>
          ) : (
            <ul className="readiness-list">
              {checks.map((check) => (
                <li key={check.id} className="readiness-row" data-testid={`check-${check.id}`}>
                  <Badge tone={check.pass ? "success" : "warning"}>
                    {check.pass ? "Pass" : "Blocked"}
                  </Badge>
                  <span className="registration-name">{check.label}</span>
                  <span className="competitions-hint">{check.detail}</span>
                </li>
              ))}
              {/* The sum that decides whether the night can end normally.
                  Deliberately not counted as a blocker: a league may knowingly
                  run short, but it must not find out at closing time. */}
              <li className="readiness-row" data-testid="check-squads_fillable">
                <Badge tone={auction.feasibility.ok ? "success" : "warning"}>
                  {auction.feasibility.ok ? "Fits" : "Short"}
                </Badge>
                <span className="registration-name">Pool against squads</span>
                <span className="competitions-hint">{auction.feasibility.headline}</span>
              </li>
              <li className="readiness-row">
                <Badge tone={auction.view !== null ? "success" : "neutral"}>
                  {auction.view !== null ? "Created" : "Not created"}
                </Badge>
                <span className="registration-name">Auction</span>
                <Link href={`${base}/auction`}>Open auction setup</Link>
              </li>
            </ul>
          )}
        </Card>

        <Card data-testid="readiness-sections">
          <h2>Preparation</h2>
          <ul className="readiness-list">
            <li className="readiness-row" data-testid="readiness-lifecycle">
              <Badge tone="info">{view.competition.status.replace(/_/g, " ")}</Badge>
              <span className="registration-name">Season lifecycle</span>
              <Link href={base}>Manage on Overview</Link>
            </li>
            <li className="readiness-row" data-testid="readiness-registrations">
              <Badge
                tone={
                  registrations?.stats !== undefined && registrations.stats.submitted > 0
                    ? "warning"
                    : "neutral"
                }
              >
                {registrations?.stats !== undefined
                  ? `${String(registrations.stats.submitted)} pending`
                  : "—"}
              </Badge>
              <span className="registration-name">
                Registrations —{" "}
                {registrations?.stats !== undefined
                  ? `${String(registrations.stats.approved)} approved of ${String(registrations.stats.total)}`
                  : "no access"}
              </span>
              <Link href={`${base}/registrations?status=submitted`}>Review queue</Link>
            </li>
            <li className="readiness-row" data-testid="readiness-teams">
              <Badge tone={view.teams.length >= 2 ? "success" : "warning"}>
                {String(view.teams.length)}
              </Badge>
              <span className="registration-name">Teams</span>
              <Link href={`${base}/teams`}>Open team workspace</Link>
            </li>
            <li className="readiness-row" data-testid="readiness-venues">
              <Badge tone={activeGrounds > 0 ? "success" : "neutral"}>
                {String(activeGrounds)} active
              </Badge>
              <span className="registration-name">
                Grounds
                {venues !== null
                  ? ` across ${String(venues.venues.length)} venue${venues.venues.length === 1 ? "" : "s"}`
                  : ""}
              </span>
              {org !== null ? <Link href={`/org/${org.slug}/venues`}>Manage venues</Link> : null}
            </li>
            <li className="readiness-row" data-testid="readiness-fixtures">
              <Badge
                tone={
                  fixtures !== null && (fixtures.conflicts ?? []).length > 0
                    ? "danger"
                    : fixtures !== null && fixtures.stats.published > 0
                      ? "success"
                      : "neutral"
                }
              >
                {fixtures !== null
                  ? (fixtures.conflicts ?? []).length > 0
                    ? `${String((fixtures.conflicts ?? []).length)} conflict${(fixtures.conflicts ?? []).length === 1 ? "" : "s"}`
                    : `${String(fixtures.stats.published)} published`
                  : "—"}
              </Badge>
              <span className="registration-name">
                Fixtures —{" "}
                {fixtures !== null
                  ? `${String(fixtures.stats.total)} total, ${String(fixtures.stats.scheduled)} scheduled`
                  : "no access"}
              </span>
              <Link href={`${base}/fixtures`}>Open fixtures</Link>
            </li>
          </ul>
        </Card>

        <div className="readiness-actions">
          <ButtonLink href={`${base}/auction`} size="touch">
            {auction !== null && auction.view !== null
              ? "Open auction setup"
              : "Create the auction"}
          </ButtonLink>
          <ButtonLink href={base} variant="secondary" size="touch">
            Back to overview
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
