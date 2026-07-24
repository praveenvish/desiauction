import { Badge, ButtonLink, Card, Stat, StatRow, ToastProvider } from "@desiauction/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { FormDialog } from "../../../components/form-dialog";
import { PageTitle } from "../../../components/shell/page-title";
import { AboutBanner } from "./about-banner";
import { OrgTabs } from "./org-tabs";
import { financeAuthority } from "../../../server/financial-operations/actions";
import { orgOverview, orgView, type OrgActivityRow } from "../../../server/orgs/actions";
import type { CompetitionSummary } from "../../../server/competition/competitions";
import type { SeasonRow } from "../../../server/competition/tournament-actions";
import { orgCatalogue } from "../../../server/orgs/catalogue";
import { moneyAuthority } from "../../../server/settlement/actions";
import { CreateCompetitionForm } from "../../seasons/create-competition-form";
import { CreateTournamentForm } from "../../tournaments/create-tournament-form";
import { TournamentAccordion, type AccordionGroup } from "../../tournaments/tournament-accordion";
import { FinanceAuthorityPanel } from "./finance-authority";
import { MembersPanel } from "./members-panel";
import { MoneyAuthorityPanel } from "./money-authority";
import "../../orgs/orgs.css";
import "../../tournaments/tournaments.css";
import "./org-detail.css";

export const metadata = { title: "Organization · DesiAuction" };

/** "Malad Cricket Club" → "MC". First code point of up to two words. */
function monogram(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => {
        const cp = word.codePointAt(0);
        return cp === undefined ? "" : String.fromCodePoint(cp);
      })
      .join("")
      .toUpperCase() || "—"
  );
}

/** "grant.issued" → "Access granted"; the org's own events, in plain words. */
const ACTIVITY_PHRASE: Record<string, string> = {
  "org.created": "Organization created",
  "tournament.created": "Tournament created",
  "competition.created": "Season created",
  "competition.cloned": "Season cloned",
  "competition.status_changed": "Season status changed",
  "grant.issued": "Access granted",
  "grant.revoked": "Access revoked",
  "org.members.invite": "Member invited",
  "team.created": "Team added",
  "payment.captured": "Payment received",
  "settlement.CaseClosed": "Settlement closed",
  "finops.ProfileDeclared": "Finance profile declared",
  "finops.PeriodOpened": "Books opened",
  "finops.PeriodClosed": "Books closed",
  "finops.CertificationDerived": "Finance updated",
  "finops.dispatch": "Receipt delivered",
  "finops.document": "Document issued",
};

/** Internal domain words the organizer never calls by that name. */
const ACTIVITY_DOMAIN: Record<string, string> = {
  finops: "Finance",
  competition: "Season",
  grant: "Access",
};

function activityLabel(action: string): string {
  const phrase = ACTIVITY_PHRASE[action];
  if (phrase !== undefined) return phrase;
  const [domain, ...rest] = action.split(".");
  const tail = rest
    .join(" ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]/g, " ")
    .toLowerCase();
  const named =
    ACTIVITY_DOMAIN[domain ?? ""] ??
    (domain ?? action).charAt(0).toUpperCase() + (domain ?? action).slice(1);
  return tail === "" ? named : `${named} ${tail}`;
}

const ACTIVITY_TONE: Record<string, string> = {
  competition: "green",
  tournament: "accent",
  grant: "info",
  org: "info",
  settlement: "violet",
  payment: "violet",
  auction: "accent",
};

function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

function ActivityRow({ row }: { row: OrgActivityRow }) {
  const tone = ACTIVITY_TONE[row.action.split(".")[0] ?? ""] ?? "muted";
  return (
    <li className="od-activity-row">
      <span className={`od-dot od-dot--${tone}`} aria-hidden />
      <span className="od-activity-text">
        <strong>{activityLabel(row.action)}</strong>
        <span>{ago(row.at)}</span>
      </span>
    </li>
  );
}

export default async function OrgHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await orgView(slug);
  if (view === null) {
    // Non-members and unknown slugs are indistinguishable (M-IP2-3 tenancy).
    notFound();
  }
  const [authority, finance, catalogue, overview] = await Promise.all([
    moneyAuthority(slug),
    financeAuthority(slug),
    orgCatalogue(slug),
    orgOverview(slug),
  ]);

  // Counts fold from the reads already in hand — no extra query.
  const editions = [
    ...(catalogue?.tournaments.flatMap((tournament) => tournament.editions) ?? []),
    ...(catalogue?.standalone ?? []),
  ];
  const stats = {
    tournaments: catalogue?.tournaments.length ?? 0,
    seasons: editions.length,
    members: view.members.length,
    teams: editions.reduce((sum, edition) => sum + edition.teams, 0),
  };
  // The org's Tournaments tab renders the SAME accordion as /tournaments,
  // scoped to this org — one component, so the two surfaces never drift. The
  // catalogue's editions become CompetitionSummary rows (org fixed, tournament
  // from the group), and each group carries its own pre-scoped create form.
  const toSeason = (
    edition: (typeof editions)[number],
    tournamentId: string | null,
  ): SeasonRow => ({
    id: edition.id,
    orgId: view.org.id,
    tournamentId,
    name: edition.name,
    slug: edition.slug,
    status: edition.status as CompetitionSummary["status"],
    visibility: edition.visibility,
    location: edition.location,
    startsOn: edition.startsOn,
    endsOn: edition.endsOn,
    orgName: view.org.name,
    // The catalogue folds the same three figures /tournaments shows, so the
    // org's tab and the index cannot disagree about the same season.
    counts: { teams: edition.teams, matches: edition.matches, pending: edition.pending },
  });
  const orgGroups: AccordionGroup[] = [
    ...(catalogue?.tournaments ?? []).map((tournament) => ({
      key: tournament.slug,
      name: tournament.name,
      // Empty: inside the org there is no org name to state, and the accordion
      // supplies the season count on its own.
      meta: "",
      seasons: tournament.editions.map((edition) => toSeason(edition, tournament.id)),
      kind: "tournament" as const,
      href: `/org/${slug}/t/${tournament.slug}`,
      seasonDialogTitle: `New season in ${tournament.name}`,
      seasonForm: (
        <CreateCompetitionForm
          orgs={[{ id: view.org.id, name: view.org.name }]}
          tournamentId={tournament.id}
        />
      ),
    })),
    ...((catalogue?.standalone.length ?? 0) > 0
      ? [
          {
            key: "one-off",
            name: "One-off seasons",
            meta: "Seasons with no recurring tournament",
            seasons: (catalogue?.standalone ?? []).map((edition) => toSeason(edition, null)),
            kind: "standalone" as const,
            seasonDialogTitle: "New one-off season",
            seasonForm: <CreateCompetitionForm orgs={[{ id: view.org.id, name: view.org.name }]} />,
          },
        ]
      : []),
  ];

  // Live & open now: an auction running, or a season taking entries.
  const liveOpen: { key: string; slug: string; name: string; tone: "live" | "open" }[] = [
    ...(overview?.liveAuctions.map((auction) => ({
      key: `live-${auction.slug}`,
      slug: auction.slug,
      name: auction.name,
      tone: "live" as const,
    })) ?? []),
    ...editions
      .filter((edition) => edition.status === "registration_open")
      .map((edition) => ({
        key: `open-${edition.slug}`,
        slug: edition.slug,
        name: edition.name,
        tone: "open" as const,
      })),
  ];

  const overviewTab: ReactNode = (
    <div className="od-overview">
      {overview !== null ? (
        <AboutBanner
          slug={slug}
          description={overview.description}
          canManage={overview.canManage}
        />
      ) : null}

      <StatRow label="Organization at a glance">
        <Stat label="Tournaments" value={stats.tournaments} />
        <Stat label="Seasons" value={stats.seasons} />
        <Stat label="Members" value={stats.members} />
        <Stat label="Active teams" value={stats.teams} />
      </StatRow>

      <div className="od-grid">
        <Card className="od-panel">
          <div className="od-panel-head">
            <h2>Live &amp; open now</h2>
            <Link href={`/org/${slug}#tournaments`}>All tournaments →</Link>
          </div>
          {liveOpen.length === 0 ? (
            <p className="competitions-hint">Nothing live or taking entries right now.</p>
          ) : (
            <ul className="od-live-list">
              {liveOpen.map((row) => (
                <li key={row.key}>
                  <Link href={`/seasons/${row.slug}`} className="od-live-row">
                    <span className="od-live-name">{row.name}</span>
                    <Badge tone={row.tone === "live" ? "success" : "success"}>
                      {row.tone === "live" ? "Live" : "Open"}
                    </Badge>
                    <span className="od-live-go" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="od-panel">
          <h2>Recent activity</h2>
          {overview === null || overview.activity.length === 0 ? (
            <p className="competitions-hint">No activity recorded yet.</p>
          ) : (
            <ul className="od-activity-list">
              {overview.activity.map((row) => (
                <ActivityRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );

  const tabs = [
    { id: "overview", label: "Overview", content: overviewTab },
    {
      id: "tournaments",
      label: "Tournaments",
      content: (
        <div className="od-tournaments">
          {orgGroups.length === 0 ? (
            <p className="competitions-hint">
              No tournaments yet — create one, then add its first season.
            </p>
          ) : (
            <div className="tg-list">
              {orgGroups.map((group, index) => (
                <TournamentAccordion key={group.key} group={group} defaultOpen={index === 0} />
              ))}
            </div>
          )}
        </div>
      ),
    },
    { id: "members", label: "Members", content: <MembersPanel view={view} slug={slug} /> },
    {
      id: "money",
      label: "Money & roles",
      content: (
        <div className="od-money">
          {/* One door to the whole money operation, as the design has it —
              settlement cases, receipts/invoices, the delivery log and the
              reconciliation proof all live behind it. It navigates, so it's a
              full-width row with a trailing arrow, distinct from the in-place
              Grant/Revoke buttons in the panels below. */}
          {authority?.canView === true || finance?.canView === true ? (
            <Link
              href={`/org/${slug}/${finance?.canView === true ? "money" : "settlement"}`}
              className="od-moneydoor"
              data-testid="open-money-ops"
            >
              <span className="od-moneydoor-glyph" aria-hidden>
                ₹
              </span>
              <span className="od-moneydoor-text">
                <strong>Settlement · Finance · Deliveries · Reconciliation</strong>
                <span>
                  Cases, receipts &amp; invoices, the delivery log and the reconciliation proof —
                  the platform&apos;s money operations.
                </span>
              </span>
              <span className="od-moneydoor-go" aria-hidden>
                →
              </span>
            </Link>
          ) : null}

          {/* Two separate acts of trust, side by side (design). */}
          <div className="od-authority-grid">
            {authority !== null ? <MoneyAuthorityPanel slug={slug} authority={authority} /> : null}
            {finance !== null ? <FinanceAuthorityPanel slug={slug} authority={finance} /> : null}
          </div>

          <ButtonLink href={`/org/${slug}/venues`} variant="secondary" data-testid="open-venues">
            Venues →
          </ButtonLink>
        </div>
      ),
    },
  ];

  const established = new Date(overview?.createdAt ?? Date.now()).getFullYear();

  return (
    <ToastProvider>
      <main className="org-detail">
        {/* The org's name IS the shell's h1, one row up and sticky — the hero
            keeps the identity that only it can show: mark, role, age, handle. */}
        <PageTitle title={view.org.name} testId="org-name" />
        <div className="od-stack">
          <header className="od-hero">
            <span className="od-monogram" aria-hidden>
              {monogram(view.org.name)}
            </span>
            <div className="od-hero-id">
              <div className="od-hero-title">
                {overview !== null ? <Badge tone="info">{overview.role}</Badge> : null}
              </div>
              <p className="od-hero-meta">
                <span>Est. {established}</span>
                <span className="od-hero-slug">/{view.org.slug}</span>
              </p>
            </div>
            <div className="od-hero-actions">
              {/* At the org level the thing you create is a TOURNAMENT — seasons
                  are added inside one. The Tournaments tab used to repeat this
                  button; now the hero owns it and the tab just lists. */}
              <FormDialog
                title="New tournament"
                triggerLabel="+ New tournament"
                triggerTestId="org-new-tournament"
              >
                <CreateTournamentForm orgs={[{ id: view.org.id, name: view.org.name }]} />
              </FormDialog>
            </div>
          </header>

          <OrgTabs tabs={tabs} />
        </div>
      </main>
    </ToastProvider>
  );
}
