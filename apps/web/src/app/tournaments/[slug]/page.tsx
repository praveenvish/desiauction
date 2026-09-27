import { sportPackFor } from "@desiauction/core";
import { Card, EmptyState, IconArrowRight, IconPlus, buttonClassName } from "@desiauction/ui";
import Link from "next/link";
import { enabledSports } from "../../../server/competition/sports";
import { notFound } from "next/navigation";
import { cache, Suspense, type ReactNode } from "react";

import { FormDialog } from "../../../components/form-dialog";
import { PageTitle } from "../../../components/shell/page-title";
import { formatWallTime } from "../../../lib/format-date";
import { standingsView } from "../../../server/competition/fixture-actions";
import { nowWallClock } from "../../../server/competition/fixtures";
import {
  tournamentHeader,
  tournamentSeasons,
  type SeasonRow,
} from "../../../server/competition/tournament-actions";
import { formatCount } from "../../../lib/plural";
import { CreateCompetitionForm } from "../../seasons/create-competition-form";
import { dateRange } from "../season-card";
import { SeasonRoad } from "../season-road";
import { STAGE_LABEL, initialsOf, nextStep, seasonStage } from "../season-stage";
import { StagePill } from "../tournament-card";
import { TournamentsSkeleton } from "../tournament-accordion";
import { wallDay } from "../../seasons/[slug]/fixtures/schedule-model";
import "../../seasons/seasons.css";
import "../tournaments.css";

/**
 * `generateMetadata` and the page both need this read, and Next runs them as
 * two calls in one request — so it was fetched twice per render. React
 * `cache` makes the second a memo hit for the rest of the request (wrapped
 * here, not in the server module, because a "use server" file may only export
 * async functions).
 */
const headerOf = cache(tournamentHeader);

/**
 * The tab and every shared link used to read the literal "Tournament ·
 * DesiAuction" for every tournament in the product, so a person with three of
 * these open could not tell them apart and a pasted link named nothing. The
 * header read is deduped per request, so this costs no extra query.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const header = await headerOf(slug);
  return header === null
    ? { title: "Tournament · DesiAuction" }
    : {
        title: `${header.tournament.name} · DesiAuction`,
        description: `The seasons of ${header.tournament.name}, run by ${header.tournament.orgName} on DesiAuction.`,
      };
}

/**
 * What this page is for, in one sentence — which depends on whether it has
 * anything on it yet. "Add the first one" used to sit above a list that already
 * held a season, so the line is now decided where the seasons are known.
 */
const WHAT_A_TOURNAMENT_IS =
  "A tournament holds the editions that actually run. Add the first one to take registrations, pick teams and run auction night.";

function whatThisIs(tournamentName: string, orgName: string, seasons: number): string {
  return seasons === 0
    ? WHAT_A_TOURNAMENT_IS
    : `Every edition of ${tournamentName}, run by ${orgName}.`;
}

/**
 * One tournament and its seasons. This is where a season is added to a
 * tournament — the create form arrives with the tournament fixed, which is the
 * only way an edition gets a parent (the standalone form on /seasons leaves it
 * null on purpose). Creation opens in a modal, so the same fixed-tournament form
 * is reused for the header action and the empty-state CTA.
 *
 * The gate is awaited HERE, before anything is committed: a non-member must get
 * a 404 with no payload, and neither a `loading.tsx` nor a Suspense boundary
 * around this call could keep that promise — both send a 200 first. Only the
 * season list, which is unbounded and the slow half of the page, streams.
 */
export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  // The sports currently switched on — the picker renders only when there is
  // more than one (SP-1 Phase 1).
  const sportOptions = await enabledSports();
  const { slug } = await params;
  const header = await headerOf(slug);
  if (header === null) {
    notFound();
  }
  const { tournament, viewer } = header;

  const addSeasonForm = (
    <CreateCompetitionForm
      sports={sportOptions}
      orgs={[{ id: tournament.orgId, name: tournament.orgName }]}
      tournamentId={tournament.id}
      suggestedName={`${tournament.name} ${String(new Date().getFullYear())}`}
    />
  );

  return (
    <main className="competitions">
      <div className="competitions-stack">
        {/* The way back is the identity bar's trail ("Tournaments"); the
            separate "← All tournaments" row repeated it. */}
        {/* The club is named in the seasons line below (round 2: it floated
            alone at the top left as a subtitle to nothing). */}
        <PageTitle title={tournament.name} />
        <Suspense fallback={<TournamentsSkeleton rows={3} />}>
          <SeasonsSection
            tournamentId={tournament.id}
            tournamentName={tournament.name}
            orgName={tournament.orgName}
            canCreateSeason={viewer.canCreateSeason}
            addSeasonForm={addSeasonForm}
            addSeason={
              viewer.canCreateSeason ? (
                <FormDialog
                  title={`New season in ${tournament.name}`}
                  triggerLabel="+ New season"
                  size="touch"
                  triggerTestId="add-season"
                >
                  {addSeasonForm}
                </FormDialog>
              ) : undefined
            }
          />
        </Suspense>
      </div>
    </main>
  );
}

async function SeasonsSection({
  tournamentName,
  orgName,
  tournamentId,
  canCreateSeason,
  addSeasonForm,
  addSeason,
}: {
  tournamentId: string;
  tournamentName: string;
  orgName: string;
  canCreateSeason: boolean;
  addSeasonForm: ReactNode;
  /** The page's one create door, in the identity band. */
  addSeason?: ReactNode;
}) {
  const seasons = await tournamentSeasons(tournamentId);
  const today = nowWallClock().slice(0, 10);

  if (seasons.length === 0) {
    return (
      <>
        <IdentityBand name={tournamentName} meta={orgName} figures={[]} action={addSeason} />
        <p className="tg-what">{whatThisIs(tournamentName, orgName, 0)}</p>
        <Card>
          <EmptyState
            headingLevel={2}
            title="No seasons yet"
            description={
              canCreateSeason
                ? "Start with this year's season — dates, sport and teams come next."
                : "This tournament has no editions yet. Ask an owner to add a season."
            }
            {...(canCreateSeason
              ? {
                  action: (
                    <FormDialog
                      title={`New season in ${tournamentName}`}
                      triggerLabel="Add the first season"
                      size="lg"
                      triggerTestId="add-first-season"
                    >
                      {addSeasonForm}
                    </FormDialog>
                  ),
                }
              : {})}
          />
        </Card>
      </>
    );
  }

  const [latest, ...earlier] = seasons as [SeasonRow, ...SeasonRow[]];
  const matches = seasons.reduce((sum, season) => sum + season.counts.matches, 0);
  const firstYear = seasons
    .map((season) => season.startsOn?.slice(0, 4))
    .filter((year): year is string => year !== undefined)
    .sort()[0];
  const sport = sportPackFor(latest.sport).label;
  const meta = [orgName, sport, firstYear !== undefined ? `since ${firstYear}` : null]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <>
      <IdentityBand
        name={tournamentName}
        meta={meta}
        figures={[
          [formatCount(seasons.length), seasons.length === 1 ? "Season" : "Seasons"],
          [formatCount(latest.counts.teams), latest.counts.teams === 1 ? "Team" : "Teams"],
          [formatCount(latest.counts.approved ?? 0), "Players"],
          [formatCount(matches), matches === 1 ? "Match" : "Matches"],
        ]}
        action={addSeason}
      />
      {!canCreateSeason ? (
        <p className="tg-cannot" data-testid="tournament-cannot-create">
          Ask an owner to add a season.
        </p>
      ) : null}

      <div className="tx-detail">
        <section className="tx-editions-col" aria-labelledby="tg-seasons-title">
          <header className="tx-section-head">
            <h2 id="tg-seasons-title">Editions</h2>
            <p>Newest first</p>
          </header>
          <div data-testid="tournament-seasons" className="tx-editions-stack">
            <LatestEdition season={latest} today={today} doors={canCreateSeason} />
            {earlier.length > 0 ? (
              <section className="tx-earlier" aria-label="Earlier seasons">
                {earlier.map((season) => (
                  <Link
                    key={season.id}
                    href={`/seasons/${season.slug}`}
                    className="tx-edition"
                    data-testid="tg-season"
                  >
                    <span className="tx-edition-id">
                      <strong>{season.name}</strong>
                      <span>
                        {[dateRange(season.startsOn, season.endsOn), season.location]
                          .filter((part) => part !== null)
                          .join(" · ") || "Dates to be set"}
                      </span>
                    </span>
                    <SeasonRoad season={season} size="sm" />
                    <StagePill stage={seasonStage(season, today)} />
                  </Link>
                ))}
              </section>
            ) : null}
            {canCreateSeason ? (
              <article className="tx-next-edition">
                <span className="tx-start-glyph" aria-hidden>
                  <IconPlus size={20} />
                </span>
                <div>
                  <h3>The next edition</h3>
                  <p>
                    When {tournamentName} comes back, start its new season here. It opens its own
                    registration, auction and fixtures.
                  </p>
                </div>
              </article>
            ) : null}
          </div>
        </section>
        <SoFar season={latest} />
      </div>
    </>
  );
}

/** Who this tournament is, and what it amounts to — the band the page opens on. */
function IdentityBand({
  name,
  meta,
  figures,
  action,
}: {
  name: string;
  meta: string;
  figures: readonly (readonly [string, string])[];
  action?: ReactNode;
}) {
  return (
    <section
      className="tx-band"
      aria-label={`${name} at a glance`}
      data-testid="tournament-figures"
    >
      <span className="tx-crest" data-size="xl" aria-hidden>
        {initialsOf(name)}
      </span>
      <div className="tx-band-id">
        {/* The identity bar owns the page's one h1 (its title); this is the
            band's own line, not a second heading. */}
        <p className="tx-band-name">{name}</p>
        <p className="tx-band-meta">{meta}</p>
      </div>
      {figures.length > 0 ? (
        <dl className="tx-band-figures">
          {figures.map(([value, label]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {action !== undefined ? <div className="tx-band-go">{action}</div> : null}
    </section>
  );
}

/**
 * The newest edition, opened up: its road, where it stands, its next step,
 * and its four desks one click away — Players, Teams, Auction, Schedule. Doors
 * only for someone who manages the tournament; anyone else reads the figures.
 */
function LatestEdition({
  season,
  today,
  doors,
}: {
  season: SeasonRow;
  today: string;
  doors: boolean;
}) {
  const base = `/seasons/${season.slug}`;
  const stage = seasonStage(season, today);
  const step = nextStep(season, today);
  const live = season.counts.live ?? 0;
  const desks = [
    {
      key: "players",
      title: "Players",
      meta:
        season.counts.pending > 0
          ? `${formatCount(season.counts.pending)} waiting for review`
          : `${formatCount(season.counts.approved ?? 0)} approved`,
      href: `${base}/registrations`,
    },
    {
      key: "teams",
      title: "Teams",
      meta: `${formatCount(season.counts.teams)} ${season.counts.teams === 1 ? "team" : "teams"}`,
      href: `${base}/teams`,
    },
    {
      key: "auction",
      title: "Auction",
      meta: season.counts.auctionDone === true ? "Done — squads and prices" : "Not run yet",
      href: `${base}/auction`,
    },
    {
      key: "schedule",
      title: "Schedule",
      meta:
        season.counts.matches > 0
          ? `${formatCount(season.counts.played ?? 0)} of ${formatCount(season.counts.matches)} played`
          : "No matches yet",
      href: `${base}/fixtures`,
    },
  ];
  return (
    <article className="tx-latest" data-testid="tournament-latest">
      <header className="tx-latest-head">
        <div className="tx-latest-id">
          <span className="tx-latest-title">
            <Link href={base} className="tx-latest-name">
              {season.name}
            </Link>
            {season.running ? (
              <span className="tx-pill" data-tone="running">
                Now running
              </span>
            ) : (
              <StagePill stage={stage} />
            )}
          </span>
          <span className="tx-latest-when">
            {[dateRange(season.startsOn, season.endsOn), season.location]
              .filter((part) => part !== null)
              .join(" · ") || "Dates to be set"}
          </span>
        </div>
        <Link href={base} className={buttonClassName({ variant: "secondary", size: "sm" })}>
          Open season
          <IconArrowRight size={16} aria-hidden />
        </Link>
      </header>
      <div className="tx-now-road">
        <SeasonRoad season={season} />
        <span className="tx-stage-word">
          {STAGE_LABEL[stage]}
          {live > 0 ? ` · ${formatCount(live)} playing now` : ""}
        </span>
        {step !== null && doors ? (
          <Link
            href={step.href}
            className={buttonClassName({ variant: step.urgent ? "primary" : "ghost", size: "sm" })}
          >
            {step.label}
          </Link>
        ) : null}
      </div>
      <ul className="tx-desks">
        {desks.map((desk) => (
          <li key={desk.key}>
            {doors ? (
              <Link href={desk.href} className="tx-desk">
                <strong>{desk.title}</strong>
                <span>{desk.meta}</span>
              </Link>
            ) : (
              <span className="tx-desk">
                <strong>{desk.title}</strong>
                <span>{desk.meta}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * THE LATEST EDITION SO FAR: the top of its table and the match being played
 * (or the next one). The page used to end its right column on a list of desk
 * links that repeated the season card beside it.
 */
async function SoFar({ season }: { season: SeasonRow }) {
  const view = await standingsView(season.slug);
  if (view === null) {
    return null;
  }
  const { standings } = view;
  const teams = new Map(view.teams.map((team) => [team.id, team]));
  const rows = standings.rows.slice(0, 5);
  // One line per match: the table's `next` is per team, so a match appears
  // once for each side — keep the first of each.
  const seen = new Set<string>();
  const nextMatches = standings.rows
    .map((row) => ({ team: row.teamName, next: view.next[row.teamId] }))
    .filter(
      (entry): entry is { team: string; next: NonNullable<typeof entry.next> } =>
        entry.next !== undefined,
    )
    .filter((entry) => {
      if (seen.has(entry.next.fixtureId)) return false;
      seen.add(entry.next.fixtureId);
      return true;
    })
    .sort(
      (a, b) =>
        Number(b.next.live) - Number(a.next.live) ||
        (a.next.kickoffAt ?? "9999").localeCompare(b.next.kickoffAt ?? "9999"),
    )
    .slice(0, 3);
  const played = standings.recorded > 0;
  return (
    <aside className="tx-sofar" aria-labelledby="tx-sofar-title" data-testid="tournament-so-far">
      <header className="tx-section-head">
        <h2 id="tx-sofar-title">{season.name} so far</h2>
      </header>
      <div className="tx-sofar-card">
        <h3 className="tx-label">Table</h3>
        {played && rows.length > 0 ? (
          <ol className="tx-table">
            {rows.map((row, index) => (
              <li key={row.teamId} data-lead={index === 0 ? "true" : undefined}>
                <span className="tx-table-pos">{index + 1}</span>
                <span className="tx-crest" data-size="sm" aria-hidden>
                  {teams.get(row.teamId)?.shortName ?? initialsOf(row.teamName)}
                </span>
                <span className="tx-table-name">{row.teamName}</span>
                <span className="tx-table-pts">
                  {row.points} {row.points === 1 ? "pt" : "pts"}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="tx-sofar-empty">The table fills as results come in.</p>
        )}
        <Link href={`/seasons/${season.slug}/standings`} className="tx-more">
          Full table
          <IconArrowRight size={14} aria-hidden />
        </Link>
        {nextMatches.length > 0 ? (
          <>
            <h3 className="tx-label">
              {nextMatches[0]?.next.live === true ? "Playing now" : "Next up"}
            </h3>
            <ul className="tx-sofar-matches">
              {nextMatches.map((entry) => (
                <li key={entry.next.fixtureId} data-live={entry.next.live ? "true" : undefined}>
                  <Link
                    href={`/seasons/${season.slug}/fixtures?match=${entry.next.fixtureId}`}
                    className="tx-sofar-match"
                  >
                    <span className="tx-sofar-teams">
                      {entry.team}
                      {entry.next.opponent !== null ? ` v ${entry.next.opponent}` : ""}
                    </span>
                    <span className="tx-sofar-when">
                      {entry.next.live
                        ? "Playing now"
                        : entry.next.kickoffAt !== null
                          ? `${wallDay(entry.next.kickoffAt.slice(0, 10)).label}, ${formatWallTime(entry.next.kickoffAt)}`
                          : "Date to be set"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </aside>
  );
}
