import {
  Badge,
  ButtonLink,
  Card,
  Stat,
  StatRow,
  AnnouncerProvider,
  ToastProvider,
  VisuallyHidden,
} from "@desiauction/ui";
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
import { orgMessagingSettingsView } from "../../../server/messaging/actions";
import { moneyAuthority } from "../../../server/settlement/actions";
import { CreateCompetitionForm } from "../../seasons/create-competition-form";
import { CreateTournamentForm } from "../../tournaments/create-tournament-form";
import { TournamentAccordion, type AccordionGroup } from "../../tournaments/tournament-accordion";
import { FinanceAuthorityPanel } from "./finance-authority";
import { JoinedToast } from "./joined-toast";
import { MembersPanel } from "./members-panel";
import { MessagingSwitches } from "./messaging-switches";
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
  "org.members.removed": "Member removed",
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

/**
 * One line of the org's own history.
 *
 * `subject` — who the entry is ABOUT — has been on the row object all along and
 * was never rendered, so the feed said "Access granted" six times with no who,
 * no whom and no by-whom. The names arrive only for a reader who may hold the
 * directory (orgOverview gates them); everyone else still gets the event.
 */
function ActivityRow({ row }: { row: OrgActivityRow }) {
  const tone = ACTIVITY_TONE[row.action.split(".")[0] ?? ""] ?? "muted";
  const who = [
    row.subjectName === null ? null : row.subjectName,
    row.actorName === null ? null : `by ${row.actorName}`,
  ].filter((part): part is string => part !== null);
  return (
    <li className="od-activity-row">
      <span className={`od-dot od-dot--${tone}`} aria-hidden />
      <span className="od-activity-text">
        <strong>{activityLabel(row.action)}</strong>
        <span>{[...who, ago(row.at)].join(" · ")}</span>
      </span>
    </li>
  );
}

/** "1 Season" / "3 Seasons" — a stat label that agrees with its own figure. */
function plural(value: number, singular: string): string {
  return value === 1 ? singular : `${singular}s`;
}

interface OrgRung {
  key: string;
  /** Its number on the /home ladder, so the two surfaces count the same way. */
  step: number;
  title: string;
  blurb: string;
  done: boolean;
  cta: ReactNode;
}

/**
 * The rest of the /home setup ladder, inside the club it is about.
 *
 * /home's ladder retires the moment the org exists — its first rung is "create
 * your club" — and the user is then dropped on an org Overview made of four
 * zeros. The remaining rungs follow them here, keeping their /home numbering so
 * "step 2 of 5" means the same thing on both screens.
 */
function OrgLadder({ rungs, current }: { rungs: OrgRung[]; current: number }) {
  return (
    <section className="od-ladder" aria-labelledby="od-ladder-title" data-testid="org-setup-ladder">
      <div className="od-ladder-head">
        <h2 id="od-ladder-title">Set up your first auction night</h2>
        <p>Step {rungs[current]?.step ?? 2} of 5</p>
      </div>
      <ol className="od-ladder-steps">
        {rungs.map((rung, index) => {
          const state = rung.done ? "done" : index === current ? "now" : "todo";
          return (
            <li key={rung.key} className={`od-rung od-rung--${state}`}>
              <span className="od-rung-mark" aria-hidden>
                {rung.done ? "✓" : rung.step}
              </span>
              <span className="od-rung-text">
                <strong>
                  <VisuallyHidden>
                    {state === "done" ? "Done: " : state === "now" ? "Next: " : "Later: "}
                  </VisuallyHidden>
                  {rung.title}
                </strong>
                <span>{rung.blurb}</span>
              </span>
              {index === current ? <span className="od-rung-cta">{rung.cta}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default async function OrgHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await orgView(slug);
  if (view === null) {
    // Non-members and unknown slugs are indistinguishable (M-IP2-3 tenancy).
    notFound();
  }
  const [authority, finance, catalogue, overview, messaging] = await Promise.all([
    moneyAuthority(slug),
    financeAuthority(slug),
    orgCatalogue(slug),
    orgOverview(slug),
    orgMessagingSettingsView(slug),
  ]);

  // Counts fold from the reads already in hand — no extra query.
  const editions = [
    ...(catalogue?.tournaments.flatMap((tournament) => tournament.editions) ?? []),
    ...(catalogue?.standalone ?? []),
  ];
  const stats = {
    tournaments: catalogue?.tournaments.length ?? 0,
    seasons: editions.length,
    // The count, not the directory: `view.members` is empty for anyone who may
    // not read it, and a stat tile is not a reason to ship a phone book.
    members: view.memberCount,
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
    // The catalogue does not carry dates-vs-today, and this tab is a summary
    // rather than the place an edition is run from; /tournaments marks it.
    running: false,
  });
  // `tournament.create` and `competition.create` are both owner-only in the
  // capability sets, so the flag the org view already resolved answers this
  // too — and the accordion no longer renders "+ Season" to a staff member the
  // server would refuse.
  const canCreateSeasonHere = view.viewer.canCreateTournament;
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
      canCreateSeason: canCreateSeasonHere,
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
            canCreateSeason: canCreateSeasonHere,
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

  // The four rungs after "create your club", derived from reads already in
  // hand. Shown only to somebody who can actually climb them.
  const canManageOrg = view.viewer.canCreateTournament;
  const editionNeedingTeams = editions.find((edition) => edition.teams === 0) ?? editions[0];
  const editionToOpen =
    editions.find((edition) => edition.status !== "registration_open") ?? editions[0];
  const rungs: OrgRung[] = [
    {
      key: "tournament",
      step: 2,
      title: "Name your tournament",
      blurb: "The recurring competition — your league, not one edition of it.",
      done: stats.tournaments > 0,
      cta: (
        <FormDialog
          title="New tournament"
          triggerLabel="Create a tournament"
          size="touch"
          triggerTestId="org-ladder-tournament"
        >
          <CreateTournamentForm orgs={[{ id: view.org.id, name: view.org.name }]} />
        </FormDialog>
      ),
    },
    {
      key: "season",
      step: 3,
      title: "Add this year's season",
      blurb: "The edition that actually runs, with its own dates and teams.",
      done: stats.seasons > 0,
      cta: (
        <ButtonLink href={`/org/${slug}#tournaments`} size="touch">
          Add a season
        </ButtonLink>
      ),
    },
    {
      key: "teams",
      step: 4,
      title: "Add the teams that will bid",
      blurb: "Auction night needs at least two teams holding paddles.",
      done: stats.teams > 0,
      cta:
        editionNeedingTeams === undefined ? null : (
          <ButtonLink href={`/seasons/${editionNeedingTeams.slug}/teams`} size="touch">
            Add teams
          </ButtonLink>
        ),
    },
    {
      key: "registrations",
      step: 5,
      title: "Open registration",
      blurb: "Players sign up, you approve them, and they become the auction pool.",
      done: editions.some((edition) => edition.status === "registration_open"),
      cta:
        editionToOpen === undefined ? null : (
          <ButtonLink href={`/seasons/${editionToOpen.slug}`} size="touch">
            Open registration
          </ButtonLink>
        ),
    },
  ];
  const currentRung = rungs.findIndex((rung) => !rung.done);
  // Retires when the LAST rung is done, not the first gap — the /home rule, for
  // the same reason: rungs complete out of order.
  const laddering = canManageOrg && currentRung !== -1 && !(rungs[rungs.length - 1]?.done ?? false);

  const overviewTab: ReactNode = (
    <div className="od-overview">
      {overview !== null ? (
        <AboutBanner
          slug={slug}
          description={overview.description}
          canManage={overview.canManage}
        />
      ) : null}

      {/* A brand-new club read "0 Tournaments · 0 Seasons · 1 Members · 0 Active
          teams" ten seconds after the user's first successful action: four
          zeros, a tombstone, and no idea what to do next. The /home ladder
          already knows what comes after "create your club" — so the rest of it
          follows the user in here, with the next rung live. */}
      {laddering ? <OrgLadder rungs={rungs} current={currentRung} /> : null}

      <StatRow label="Organization at a glance">
        <Stat label={plural(stats.tournaments, "Tournament")} value={stats.tournaments} />
        <Stat label={plural(stats.seasons, "Season")} value={stats.seasons} />
        <Stat label={plural(stats.members, "Member")} value={stats.members} />
        <Stat label={`Active ${plural(stats.teams, "team")}`} value={stats.teams} />
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
          {/* Grounds belong beside the fixtures that use them, not on the tab
              about who may touch the money — it was the one link on that tab
              that had nothing to do with money. Offered only to whoever can
              manage them, which is who the page now admits. */}
          {canManageOrg ? (
            <ButtonLink
              href={`/org/${slug}/venues`}
              variant="secondary"
              size="touch"
              data-testid="open-venues"
            >
              Venues →
            </ButtonLink>
          ) : null}
        </div>
      ),
    },
    { id: "members", label: "Members", content: <MembersPanel view={view} slug={slug} /> },
    {
      id: "notifications",
      label: "Notifications",
      content: (
        <div className="od-notifications">
          <Card>
            <h2>What this club sends</h2>
            {/* The honest framing, because the alternative invites an organizer
                to believe this switch is more powerful than it is: it can stop
                a message, and it can never start one for somebody who has
                already said no. `maySend` reads the person first. */}
            <p className="competitions-hint">
              Text messages this club sends on your behalf. Switching one off stops it for everyone
              here. Switching one on does not override anybody who has turned it off in their own
              account — their answer always wins.
            </p>
            {messaging === null ? (
              <p className="competitions-hint">Not available.</p>
            ) : (
              <>
                <MessagingSwitches slug={slug} settings={messaging} />
                {messaging.canManage ? null : (
                  <p className="competitions-hint">
                    Only an owner can change these. You are seeing what the club sends.
                  </p>
                )}
              </>
            )}
            <p className="competitions-hint">
              Sign-in codes are not listed and cannot be switched off — somebody who turns off SMS
              and then cannot log in has been handed a worse problem than the one they avoided.
            </p>
          </Card>
        </div>
      ),
    },
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

          {/* Two separate acts of trust, side by side (design) — under ONE
              sentence. The panels each carried a paragraph making the same
              partition argument in different words, directly above the other
              one making it again; nobody read either. */}
          <p className="od-authority-lead">
            <strong>Two separate keys.</strong> <em>Settles money</em> opens cases and records what
            was paid. <em>Speaks for the money</em> issues receipts and closes the books. Neither
            lets anyone run an auction, and running the club grants neither. Hand each one out on
            purpose.
          </p>
          <div className="od-authority-grid">
            {authority !== null ? <MoneyAuthorityPanel slug={slug} authority={authority} /> : null}
            {finance !== null ? <FinanceAuthorityPanel slug={slug} authority={finance} /> : null}
          </div>
        </div>
      ),
    },
  ];

  // "Est. 2026" fell back to `Date.now()` when `overview` was null, so a page
  // that had failed to read the org still stated a founding year with total
  // confidence. It says nothing now unless the database said it.
  const established = overview === null ? null : new Date(overview.createdAt).getFullYear();

  /*
   * The Notifications tab's switches announce their state changes to a screen
   * reader, and `useAnnouncer` throws without this ancestor — a runtime-only
   * error that neither the build nor the integration suite can see.
   */
  return (
    <AnnouncerProvider>
      <ToastProvider>
        {/* "You've joined X" — the confirmation acceptance never gave. */}
        <JoinedToast />
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
                  {established === null ? null : <span>Est. {established}</span>}
                  <span className="od-hero-slug">/{view.org.slug}</span>
                </p>
              </div>
              <div className="od-hero-actions">
                {/* At the org level the thing you create is a TOURNAMENT — seasons
                  are added inside one. The Tournaments tab used to repeat this
                  button; now the hero owns it and the tab just lists.

                  Gated: it rendered for a viewer, opened, took a name, and the
                  server then said "You can't create tournaments in this
                  organization." A button whose only outcome is a refusal is
                  worse than no button — four lines above, AboutBanner had been
                  taking `canManage` and doing exactly this all along. */}
                {view.viewer.canCreateTournament ? (
                  <FormDialog
                    title="New tournament"
                    triggerLabel="+ New tournament"
                    size="touch"
                    triggerTestId="org-new-tournament"
                  >
                    <CreateTournamentForm orgs={[{ id: view.org.id, name: view.org.name }]} />
                  </FormDialog>
                ) : null}
              </div>
            </header>

            <OrgTabs tabs={tabs} />
          </div>
        </main>
      </ToastProvider>
    </AnnouncerProvider>
  );
}
