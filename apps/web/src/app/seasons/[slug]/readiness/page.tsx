import {
  ButtonLink,
  IconCalendar,
  IconCheck,
  IconFlag,
  IconTile,
  IconLayers,
  IconPin,
  IconUser,
  IconUsers,
  Pill,
  SectionCard,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { auctionDashboard } from "../../../../server/auction/actions";
import { competitionView, registrationDashboard } from "../../../../server/competition/actions";
import { fixtureDashboard, venuesView } from "../../../../server/competition/fixture-actions";
import { myOrgs } from "../../../../server/orgs/actions";
import "../../seasons.css";
import "../_tabs/tabs.css";
import "./readiness.css";

export const metadata = { title: "Readiness · DesiAuction" };

// PX-4 Readiness Center: ONE unified view that SURFACES existing validation.
// The only pass/fail authority here is the platform's own AuctionReady
// projection (auction-ready.ts); everything else is counts from existing
// dashboards with links to the screen that changes them. No rules invented.
/** Where each auction gate is cleared. */
function fixOf(id: string, base: string): { href: string; label: string } {
  switch (id) {
    case "intake_closed":
      return { href: base, label: "Close registration" };
    case "pool_present":
      return { href: `${base}/registrations`, label: "Review registrations" };
    case "teams_present":
      return { href: `${base}/teams`, label: "Add teams" };
    default:
      return { href: `${base}/auction`, label: "Open auction setup" };
  }
}

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
  const firstBlocked = checks.find((check) => !check.pass);

  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <div className="st-head">
          <p className="st-head-lede">
            Every row links to the screen that changes it. Pass or fail comes from the
            platform&apos;s own auction-readiness checks.
          </p>
          {auction !== null && blockers === 0 ? (
            <Pill tone={runningShort ? "amber" : "green"} dot testId="readiness-verdict">
              {runningShort ? "Ready — but running short" : "Ready for auction"}
            </Pill>
          ) : (
            <Pill tone="amber" dot testId="readiness-verdict">
              {blockers > 0
                ? `${String(blockers)} blocker${blockers === 1 ? "" : "s"}`
                : "In preparation"}
            </Pill>
          )}
        </div>

        <SectionCard
          icon={<IconFlag />}
          tone={blockers > 0 ? "red" : "green"}
          title="Auction gates"
          description={
            auction === null
              ? undefined
              : blockers > 0
                ? `${String(blockers)} of ${String(checks.length)} still blocked`
                : "Every gate passes"
          }
          data-testid="readiness-auction"
        >
          {auction === null ? (
            <p className="st-note">Sign-in lacks access to this season&apos;s auction view.</p>
          ) : (
            <ul className="rd-checks">
              {checks.map((check) => (
                <li key={check.id} data-pass={check.pass} data-testid={`check-${check.id}`}>
                  <span className="rd-mark" aria-hidden>
                    <IconCheck size={14} />
                  </span>
                  <span className="rd-text">
                    <strong>{check.label}</strong>
                    <span className="st-note">
                      <span className="st-sr">{check.pass ? "Pass: " : "Blocked: "}</span>
                      {check.detail}
                    </span>
                  </span>
                  {/* A blocked gate names where it is cleared — the page's own
                      promise, which the three gates were the only rows to break. */}
                  {!check.pass ? (
                    <Link className="st-link" href={fixOf(check.id, base).href}>
                      {fixOf(check.id, base).label}
                    </Link>
                  ) : (
                    <Pill tone="green">Pass</Pill>
                  )}
                </li>
              ))}
              {/* The sum that decides whether the night can end normally.
                  Deliberately not counted as a blocker: a league may knowingly
                  run short, but it must not find out at closing time. */}
              <li
                data-pass={auction.feasibility.ok}
                data-soft="true"
                data-testid="check-squads_fillable"
              >
                <span className="rd-mark" aria-hidden>
                  <IconCheck size={14} />
                </span>
                <span className="rd-text">
                  <strong>Pool against squads</strong>
                  <span className="st-note">{auction.feasibility.headline}</span>
                </span>
                <Pill tone={auction.feasibility.ok ? "green" : "amber"}>
                  {auction.feasibility.ok ? "Fits" : "Short"}
                </Pill>
              </li>
              <li data-pass={auction.view !== null}>
                <span className="rd-mark" aria-hidden>
                  <IconCheck size={14} />
                </span>
                <span className="rd-text">
                  <strong>Auction</strong>
                  <span className="st-note">
                    {auction.view !== null ? "Created" : "Not created yet"}
                  </span>
                </span>
                <Link className="st-link" href={`${base}/auction`}>
                  Open auction setup
                </Link>
              </li>
            </ul>
          )}
        </SectionCard>

        <SectionCard
          icon={<IconLayers />}
          tone="blue"
          title="Preparation"
          description="Where each part of the season stands"
          data-testid="readiness-sections"
        >
          <ul className="rd-areas">
            <Area
              testId="readiness-lifecycle"
              icon={<IconFlag />}
              tone="gold"
              title="Season lifecycle"
              detail="Where the season is in its steps"
              pill={(() => {
                const words = view.competition.status.replace(/_/g, " ");
                return words.charAt(0).toUpperCase() + words.slice(1);
              })()}
              pillTone="blue"
              href={base}
              link="Manage on Overview"
            />
            <Area
              testId="readiness-registrations"
              icon={<IconUser />}
              tone="green"
              title="Registrations"
              detail={
                registrations?.stats !== undefined
                  ? `${String(registrations.stats.approved)} approved of ${String(registrations.stats.total)}`
                  : "No access"
              }
              pill={
                registrations?.stats !== undefined
                  ? `${String(registrations.stats.submitted)} pending`
                  : "—"
              }
              pillTone={
                registrations?.stats !== undefined && registrations.stats.submitted > 0
                  ? "amber"
                  : "neutral"
              }
              href={`${base}/registrations?status=submitted`}
              link="Review queue"
            />
            <Area
              testId="readiness-teams"
              icon={<IconUsers />}
              tone="purple"
              title="Teams"
              detail={view.teams.length >= 2 ? "Enough to hold an auction" : "At least two needed"}
              pill={String(view.teams.length)}
              pillTone={view.teams.length >= 2 ? "green" : "amber"}
              href={`${base}/teams`}
              link="Open team workspace"
            />
            <Area
              testId="readiness-venues"
              icon={<IconPin />}
              tone="blue"
              title="Grounds"
              detail={
                venues !== null
                  ? `Across ${String(venues.venues.length)} venue${venues.venues.length === 1 ? "" : "s"}`
                  : "Venues of the organization"
              }
              pill={`${String(activeGrounds)} active`}
              pillTone={activeGrounds > 0 ? "green" : "neutral"}
              {...(org !== null ? { href: `/org/${org.slug}/venues`, link: "Manage venues" } : {})}
            />
            <Area
              testId="readiness-fixtures"
              icon={<IconCalendar />}
              tone="amber"
              title="Fixtures"
              detail={
                fixtures !== null
                  ? `${String(fixtures.stats.total)} total, ${String(fixtures.stats.scheduled)} scheduled`
                  : "No access"
              }
              pill={
                fixtures !== null
                  ? (fixtures.conflicts ?? []).length > 0
                    ? `${String((fixtures.conflicts ?? []).length)} conflict${(fixtures.conflicts ?? []).length === 1 ? "" : "s"}`
                    : `${String(fixtures.stats.published)} published`
                  : "—"
              }
              pillTone={
                fixtures !== null && (fixtures.conflicts ?? []).length > 0
                  ? "red"
                  : fixtures !== null && fixtures.stats.published > 0
                    ? "green"
                    : "neutral"
              }
              href={`${base}/fixtures`}
              link="Open fixtures"
            />
          </ul>
        </SectionCard>

        <div className="rd-actions">
          {/* ONE next step. While a gate is blocked, creating the auction is not
              it — the first blocker's fix is, so that is the ink button and the
              auction is the secondary one. */}
          {firstBlocked !== undefined ? (
            <ButtonLink
              href={fixOf(firstBlocked.id, base).href}
              size="touch"
              data-testid="readiness-next"
            >
              {fixOf(firstBlocked.id, base).label}
            </ButtonLink>
          ) : null}
          <ButtonLink
            href={`${base}/auction`}
            size="touch"
            {...(firstBlocked !== undefined ? { variant: "secondary" as const } : {})}
          >
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

/** One area of preparation: what it is, where it stands, where to change it. */
function Area({
  testId,
  icon,
  tone,
  title,
  detail,
  pill,
  pillTone,
  href,
  link,
}: {
  testId: string;
  icon: ReactNode;
  tone: KitTone;
  title: string;
  detail: string;
  pill: string;
  pillTone: KitTone;
  href?: string;
  link?: string;
}) {
  return (
    <li data-testid={testId}>
      <IconTile icon={icon} tone={tone} size="sm" />
      <span className="rd-text">
        <strong>{title}</strong>
        <span className="st-note">{detail}</span>
      </span>
      <span className="rd-state">
        <Pill tone={pillTone}>{pill}</Pill>
      </span>
      {href !== undefined && link !== undefined ? (
        <Link className="st-link" href={href}>
          {link}
        </Link>
      ) : (
        <span />
      )}
    </li>
  );
}
