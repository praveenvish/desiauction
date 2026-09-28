import {
  ButtonLink,
  IconAlert,
  IconCalendar,
  IconCheck,
  IconClose,
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
import { readinessSteps, readinessTitle, shortfallSentence } from "./readiness-model";

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

/** A season status in words — the gate's own detail is the raw enum. */
const STATUS_WORDS: Record<string, string> = {
  draft: "The season is still a draft",
  setup: "The season is in setup",
  registration_open: "Registration is open",
  registration_closed: "Registration is closed",
};

/**
 * The gate's detail, readable. The projection reports the intake gate as
 * "competition is registration closed" — the enum with its underscores taken
 * out, which is a log line, not a sentence. Every other detail already reads.
 */
function checkDetail(check: { id: string; detail: string }, status: string): string {
  return check.id === "intake_closed" ? (STATUS_WORDS[status] ?? check.detail) : check.detail;
}

/**
 * Whether a check's detail adds anything to its label. "Registration is still
 * open — close it to lock the pool" was followed by "Registration is open".
 */
function detailAdds(check: { id: string; label: string; pass: boolean }, detail: string): boolean {
  if (check.id === "intake_closed" && !check.pass) return false;
  return !check.label.toLowerCase().startsWith(detail.toLowerCase());
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
  /*
   * AFTER THE HAMMER THIS PAGE IS A RECORD, NOT A CHECKLIST. It used to keep
   * asking "can I start?" of an auction that had already run.
   */
  const auctionStatus = auction?.view?.auction.status ?? null;
  const auctionOver = auctionStatus === "completed" || auctionStatus === "reconciled";
  const auctionLive = auctionStatus === "live" || auctionStatus === "paused";
  const auctionCreated = auction?.view !== null && auction?.view !== undefined;
  const regStats = registrations?.stats;
  const pending = regStats?.submitted ?? 0;
  /*
   * THE STEPS ARE THE COUNT. The corner pill said "1 blocker" while the list
   * under it drew two red marks — "the auction exists" was drawn blocked and
   * never counted. Title, button and marks now read from one list.
   */
  const steps =
    auction === null || auctionOver || auctionLive
      ? []
      : readinessSteps({ checks, auctionCreated, pending, base });
  /*
   * Squad feasibility is deliberately NOT a step: a league may knowingly run
   * short, but it must not find out at closing time — so it is said as a
   * sentence with the ways out, and the verdict carries the caveat.
   */
  const short =
    auction === null || auctionOver ? null : shortfallSentence(auction.feasibility, pending);
  const runningShort = short !== null;
  const fixtureCount = fixtures?.stats.total ?? 0;
  const published = fixtures?.stats.published ?? 0;
  const conflicts = (fixtures?.conflicts ?? []).length;

  const verdictPill = auctionOver
    ? { tone: "green" as KitTone, label: "Auction completed" }
    : auctionLive
      ? { tone: "green" as KitTone, label: "Auction live" }
      : auction !== null && steps.length === 0
        ? {
            tone: (runningShort ? "amber" : "green") as KitTone,
            label: runningShort ? "Ready — but running short" : "Ready for auction",
          }
        : { tone: "amber" as KitTone, label: "Not ready yet" };

  const title = auctionOver
    ? fixtureCount > 0 && published === fixtureCount && conflicts === 0
      ? "The auction is done — the schedule is out"
      : "The auction is done — next is the match schedule"
    : auctionLive
      ? "The auction is live"
      : readinessTitle(steps.length);
  const firstStep = steps[0];
  const primary = auctionOver
    ? {
        label: fixtureCount === 0 ? "Build fixtures" : "Open fixtures",
        href: `${base}/fixtures`,
      }
    : auctionLive
      ? { label: "Open the cockpit", href: `${base}/auction/cockpit` }
      : firstStep !== undefined
        ? firstStep.action
        : { label: "Open auction setup", href: `${base}/auction` };

  const checkRows =
    auction === null ? null : (
      <ul className="rd-checks">
        {checks.map((check) => (
          <CheckRow
            key={check.id}
            testId={`check-${check.id}`}
            state={check.pass ? "pass" : "block"}
            title={check.label}
            detail={
              detailAdds(check, checkDetail(check, view.competition.status))
                ? checkDetail(check, view.competition.status)
                : null
            }
            {...(!check.pass && !auctionOver ? { fix: fixOf(check.id, base) } : {})}
          />
        ))}
        {auctionOver ? null : (
          <CheckRow
            testId="check-squads_fillable"
            state={auction.feasibility.ok ? "pass" : "warn"}
            title="Pool against squads"
            detail={
              auction.feasibility.ok
                ? auction.feasibility.headline
                : `${String(auction.feasibility.shortfall)} short — ${String(auction.feasibility.poolSize)} players for ${String(auction.feasibility.needed)} squad places`
            }
            {...(auction.feasibility.ok
              ? {}
              : { fix: { href: `${base}/auction`, label: "Auction setup" } })}
          />
        )}
        <CheckRow
          testId="check-auction_created"
          state={auctionCreated ? "pass" : "block"}
          title="The auction exists"
          detail={auctionOver ? "Completed" : auctionCreated ? "Created" : "Not created yet"}
          {...(auctionCreated
            ? {}
            : { fix: { href: `${base}/auction`, label: "Create the auction" } })}
        />
      </ul>
    );

  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <section
          className="rd-verdict"
          data-tone={auctionOver || auctionLive ? "done" : steps.length === 0 ? "ready" : "todo"}
          aria-labelledby="rd-verdict-title"
          data-testid="readiness-card"
        >
          <div className="rd-verdict-head">
            <Pill tone={verdictPill.tone} dot testId="readiness-verdict">
              {verdictPill.label}
            </Pill>
            <h2 id="rd-verdict-title">{title}</h2>
            <p>
              {auctionOver
                ? `${view.competition.name} · ${String(fixtureCount)} fixture${fixtureCount === 1 ? "" : "s"}, ${String(published)} published${conflicts > 0 ? ` · ${String(conflicts)} conflict${conflicts === 1 ? "" : "s"}` : ""}`
                : `${view.competition.name} · ${String(auction?.feasibility.poolSize ?? 0)} players in the pool, ${String(view.teams.length)} team${view.teams.length === 1 ? "" : "s"}`}
            </p>
          </div>
          {steps.length > 0 ? (
            <ol className="rd-steps" data-testid="readiness-steps">
              {steps.map((step, index) => (
                <li key={step.key} data-now={index === 0 || undefined}>
                  <span className="rd-step-n" aria-hidden>
                    {index + 1}
                  </span>
                  <span className="rd-text">
                    <strong>{step.label}</strong>
                    {step.detail === null ? null : <span className="st-note">{step.detail}</span>}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {short === null ? null : (
            <p className="rd-short" data-testid="readiness-short">
              <IconAlert size={18} aria-hidden />
              <span>
                <strong>{short.lead}</strong> {short.body}
              </span>
            </p>
          )}
          <div className="rd-actions">
            <ButtonLink href={primary.href} size="touch" data-testid="readiness-next">
              {primary.label}
            </ButtonLink>
            {firstStep !== undefined && firstStep.action.href !== firstStep.href ? (
              <ButtonLink href={firstStep.href} variant="secondary" size="touch">
                {firstStep.label}
              </ButtonLink>
            ) : null}
            {auctionOver ? (
              <ButtonLink href={`${base}/auction`} variant="secondary" size="touch">
                See the auction results
              </ButtonLink>
            ) : primary.href !== `${base}/auction` ? (
              <ButtonLink href={`${base}/auction`} variant="secondary" size="touch">
                Auction setup
              </ButtonLink>
            ) : null}
          </div>
        </section>

        <div className="rd-grid" data-over={auctionOver || undefined}>
          {auctionOver ? null : (
            <SectionCard
              icon={<IconFlag />}
              tone={steps.length > 0 ? "red" : "green"}
              title="Checks"
              description="What the platform looks at before it lets the auction open"
              data-testid="readiness-auction"
            >
              {checkRows ?? (
                <p className="st-note">Sign-in lacks access to this season&apos;s auction view.</p>
              )}
            </SectionCard>
          )}

          <div className="rd-prep" data-testid="readiness-sections">
            {auctionOver ? null : (
              <SectionCard
                icon={<IconLayers />}
                tone="gold"
                title="For auction night"
                description="The parts the auction needs"
              >
                <ul className="rd-areas">
                  <Area
                    testId="readiness-registrations"
                    icon={<IconUser />}
                    title="Registrations"
                    figure={
                      regStats !== undefined
                        ? `${String(regStats.approved)} of ${String(regStats.total)}`
                        : "—"
                    }
                    detail={
                      regStats !== undefined
                        ? `approved · ${pending > 0 ? `${String(pending)} waiting` : "none waiting"}`
                        : "No access"
                    }
                    attention={pending > 0}
                    href={`${base}/registrations?status=submitted`}
                    link="Review queue"
                  />
                  <Area
                    testId="readiness-teams"
                    icon={<IconUsers />}
                    title="Teams"
                    figure={`${String(view.teams.length)} team${view.teams.length === 1 ? "" : "s"}`}
                    detail={
                      view.teams.length >= 2
                        ? "each needs an owner before the night"
                        : "at least two are needed"
                    }
                    attention={view.teams.length < 2}
                    href={`${base}/teams`}
                    link="Team workspace"
                  />
                </ul>
              </SectionCard>
            )}

            <SectionCard
              icon={<IconCalendar />}
              tone="gold"
              title={auctionOver ? "Next: the match schedule" : "After the auction"}
              description={
                auctionOver
                  ? "What the season needs now"
                  : "Not needed yet — for the match schedule"
              }
            >
              <ul className="rd-areas">
                <Area
                  testId="readiness-venues"
                  icon={<IconPin />}
                  title="Grounds"
                  figure={activeGrounds === 0 ? "None yet" : `${String(activeGrounds)} active`}
                  detail={
                    venues !== null && venues.venues.length > 0
                      ? `across ${String(venues.venues.length)} venue${venues.venues.length === 1 ? "" : "s"}`
                      : "add a venue before building fixtures"
                  }
                  attention={auctionOver && activeGrounds === 0}
                  quiet={!auctionOver && activeGrounds === 0}
                  {...(org !== null ? { href: `/org/${org.slug}/venues`, link: "Venues" } : {})}
                />
                <Area
                  testId="readiness-fixtures"
                  icon={<IconCalendar />}
                  title="Fixtures"
                  figure={
                    fixtures === null
                      ? "—"
                      : fixtureCount === 0
                        ? "None yet"
                        : `${String(published)} of ${String(fixtureCount)} published`
                  }
                  detail={
                    fixtures === null
                      ? "No access"
                      : fixtureCount === 0
                        ? "none published — built once teams are final"
                        : `${String(fixtures.stats.scheduled)} scheduled · ${conflicts === 0 ? "no conflicts" : `${String(conflicts)} conflict${conflicts === 1 ? "" : "s"}`}`
                  }
                  attention={conflicts > 0}
                  quiet={!auctionOver && fixtureCount === 0}
                  href={`${base}/fixtures`}
                  link="Fixtures"
                />
              </ul>
            </SectionCard>
          </div>

          {auctionOver && checkRows !== null ? (
            // The night passed every check; the list stays one click away.
            <details className="rd-record" data-testid="readiness-auction">
              <summary>
                <span className="rd-mark" aria-hidden>
                  <IconCheck size={14} />
                </span>
                <span>
                  <strong>Every auction check passed</strong> — registration closed,{" "}
                  {String(auction?.feasibility.poolSize ?? 0)} left in the pool, {view.teams.length}{" "}
                  teams, auction completed.
                </span>
                <span className="rd-record-show">Show the checks</span>
              </summary>
              {checkRows}
            </details>
          ) : null}
        </div>
      </div>
    </main>
  );
}

type CheckState = "pass" | "block" | "warn";

const CHECK_ICON: Record<CheckState, ReactNode> = {
  pass: <IconCheck size={14} />,
  block: <IconClose size={14} />,
  warn: <IconAlert size={14} />,
};

const CHECK_WORD: Record<CheckState, string> = {
  pass: "Pass: ",
  block: "Blocked: ",
  warn: "Warning: ",
};

/** One check: a mark whose shape says the state, the words, and its fix. */
function CheckRow({
  testId,
  state,
  title,
  detail,
  fix,
}: {
  testId: string;
  state: CheckState;
  title: string;
  detail: string | null;
  fix?: { href: string; label: string };
}) {
  return (
    <li data-pass={state === "pass"} data-state={state} data-testid={testId}>
      <span className="rd-mark" aria-hidden>
        {CHECK_ICON[state]}
      </span>
      <span className="rd-text">
        <strong>{title}</strong>
        <span className="st-note">
          <span className="st-sr">{CHECK_WORD[state]}</span>
          {detail}
        </span>
      </span>
      {fix !== undefined ? (
        <Link className="st-link" href={fix.href}>
          {fix.label}
        </Link>
      ) : (
        <span />
      )}
    </li>
  );
}

/** One area: what it is, a figure with its noun, and where to change it. */
function Area({
  testId,
  icon,
  title,
  figure,
  detail,
  attention = false,
  quiet = false,
  href,
  link,
}: {
  testId: string;
  icon: ReactNode;
  title: string;
  figure: string;
  detail: string;
  attention?: boolean;
  quiet?: boolean;
  href?: string;
  link?: string;
}) {
  return (
    <li
      data-testid={testId}
      data-attention={attention || undefined}
      data-quiet={quiet || undefined}
    >
      <IconTile icon={icon} tone="neutral" size="sm" />
      <span className="rd-text">
        <strong>{title}</strong>
        <span className="st-note">{detail}</span>
      </span>
      <span className="rd-state rd-figure">{figure}</span>
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
