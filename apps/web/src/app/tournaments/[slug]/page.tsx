import { sportPackFor } from "@desiauction/core";
import {
  ButtonLink,
  Card,
  EmptyState,
  IconArrowRight,
  IconChevronRight,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";
import { enabledSports } from "../../../server/competition/sports";
import { notFound } from "next/navigation";
import { cache, Suspense, type CSSProperties, type ReactNode } from "react";

import { FormDialog } from "../../../components/form-dialog";
import { PageTitle } from "../../../components/shell/page-title";
import { formatWallTime } from "../../../lib/format-date";
import { seasonSoFarView, type SeasonSoFarView } from "../../../server/competition/fixture-actions";
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
import { STAGE_ORDER, initialsOf, nextStep, seasonStage, type StageKey } from "../season-stage";
import { StagePill } from "../tournament-card";
import { TournamentsSkeleton } from "../tournament-accordion";
import { relativeDay, wallDay } from "../../seasons/[slug]/fixtures/schedule-model";
import { resultSentence } from "../../reports/reports-model";
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
    ? { title: "Tournament" }
    : {
        title: header.tournament.name,
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
                  variant="secondary"
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
        <IdentityBand name={tournamentName} meta={orgName} action={addSeason} />
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
  const firstYear = seasons
    .map((season) => season.startsOn?.slice(0, 4))
    .filter((year): year is string => year !== undefined)
    .sort()[0];
  const sport = sportPackFor(latest.sport).label;
  // Who the tournament is, in one line. The band's four figure tiles went:
  // they repeated the edition card's own desks (43 players, 3 teams, 3 of 7)
  // one inch below them (census 2026-09-28).
  const meta = [
    orgName,
    sport,
    firstYear !== undefined ? `since ${firstYear}` : null,
    seasons.length === 1 ? "1 edition" : `${formatCount(seasons.length)} editions`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <>
      <IdentityBand name={tournamentName} meta={meta} />
      {!canCreateSeason ? (
        <p className="tg-cannot" data-testid="tournament-cannot-create">
          Ask an owner to add a season.
        </p>
      ) : null}

      <div data-testid="tournament-seasons" className="tx-editions-stack">
        <LatestEdition season={latest} today={today} doors={canCreateSeason} />
        {earlier.length > 0 ? (
          <section className="tx-earlier" aria-labelledby="tx-earlier-title">
            <h2 id="tx-earlier-title" className="tx-label">
              Earlier editions
            </h2>
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
        {/* The page's one create door. It sat in the band as the biggest
            button on a phone while a season was being played; it lives where
            the next edition would go. */}
        {addSeason !== undefined ? (
          <article className="tx-next-edition">
            <div>
              <h2>The next edition</h2>
              <p>
                When {tournamentName} comes back, it starts here — its own registration, auction and
                matches.
              </p>
            </div>
            <div className="tx-next-go">{addSeason}</div>
          </article>
        ) : null}
      </div>
    </>
  );
}

/** Who this tournament is — the band the page opens on. */
function IdentityBand({ name, meta, action }: { name: string; meta: string; action?: ReactNode }) {
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
      {action !== undefined ? <div className="tx-band-go">{action}</div> : null}
    </section>
  );
}

/**
 * THE ROAD, IN WORDS. The card drew five unlabelled ticks — all five ticked
 * on a season three matches into seven, because the journey marks "Fixtures"
 * done once any exist. The card's road is the season's STAGE, the one
 * `seasonStage` decides for every surface, with the matches step filling as
 * they are played.
 */
const ROAD: readonly { key: StageKey; label: string }[] = [
  { key: "setup", label: "Setup" },
  { key: "registration", label: "Registration" },
  { key: "auction", label: "Auction" },
  { key: "season", label: "Matches" },
  { key: "finished", label: "Finished" },
];

function StageRoad({ stage, played, total }: { stage: StageKey; played: number; total: number }) {
  const at = STAGE_ORDER.indexOf(stage);
  return (
    <ol className="tx-stage-road" aria-label="Where the season is">
      {ROAD.map((step, index) => {
        const state =
          index < at || stage === "finished" ? "done" : index === at ? "current" : "todo";
        const fill =
          state === "done"
            ? 100
            : state === "current" && step.key === "season" && total > 0
              ? Math.round((played / total) * 100)
              : 0;
        return (
          <li
            key={step.key}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span
              className="tx-stage-bar"
              style={{ "--fill": `${String(fill)}%` } as CSSProperties}
            />
            <span className="tx-stage-label">
              {step.label}
              {state === "current" && step.key === "season" && total > 0
                ? ` · ${formatCount(played)} of ${formatCount(total)}`
                : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The newest edition, told ONCE (2026-09-28): its name and one status, the
 * road in words, the next step naming the match it is about, then the table
 * beside the matches, and its four desks as one quiet row of links. The page
 * used to split this across two columns and say "running" three ways.
 */
async function LatestEdition({
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
  const matches = season.counts.matches;
  const played = season.counts.played ?? 0;
  const soFar =
    stage === "season" || stage === "finished" ? await seasonSoFarView(season.slug) : null;
  const liveMatch = soFar?.play.liveMatches[0];
  const desks = [
    {
      key: "players",
      title: "Players",
      meta:
        season.counts.pending > 0
          ? `${formatCount(season.counts.pending)} to review`
          : `${formatCount(season.counts.approved ?? 0)} approved`,
      href: `${base}/registrations`,
    },
    { key: "teams", title: "Teams", meta: formatCount(season.counts.teams), href: `${base}/teams` },
    {
      key: "auction",
      title: "Auction",
      meta: season.counts.auctionDone === true ? "done" : "not run yet",
      href: `${base}/auction`,
    },
    {
      key: "schedule",
      title: "Schedule",
      meta: matches > 0 ? `${formatCount(played)} of ${formatCount(matches)}` : "no matches yet",
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
            {live > 0 ? (
              <span className="tx-pill" data-tone="live">
                Match day · {formatCount(live)} live
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
        <ButtonLink href={base} variant="secondary" size="sm" className="tx-latest-open">
          Open season
          <IconArrowRight size={16} aria-hidden />
        </ButtonLink>
      </header>

      <StageRoad stage={stage} played={played} total={matches} />

      {step !== null && doors ? (
        <div
          className="tx-next"
          data-live={live > 0 ? "true" : undefined}
          data-testid="tournament-next"
        >
          <div className="tx-next-text">
            <strong>
              {liveMatch !== undefined
                ? `${liveMatch.homeName ?? "A lobby"}${liveMatch.awayName !== null ? ` v ${liveMatch.awayName}` : ""} ${live > 1 ? `and ${formatCount(live - 1)} more are` : "is"} being played`
                : step.why}
            </strong>
            {liveMatch !== undefined ? (
              <span>
                {[liveMatch.groundName, "enter the score when it ends — the table moves with it"]
                  .filter((part) => part !== null)
                  .join(" · ")}
              </span>
            ) : null}
          </div>
          <ButtonLink href={step.href} variant={step.urgent ? "primary" : "secondary"} size="sm">
            {liveMatch !== undefined ? "Enter the score" : step.label}
          </ButtonLink>
        </div>
      ) : null}

      {soFar !== null ? <SoFar slug={season.slug} view={soFar} today={today} /> : null}

      <nav className="tx-desks" aria-label={`${season.name} desks`}>
        {desks.map((desk) =>
          doors ? (
            <Link key={desk.key} href={desk.href} className="tx-desk">
              <strong>{desk.title}</strong>
              <span>{desk.meta}</span>
              <IconChevronRight size={14} aria-hidden />
            </Link>
          ) : (
            <span key={desk.key} className="tx-desk">
              <strong>{desk.title}</strong>
              <span>{desk.meta}</span>
            </span>
          ),
        )}
      </nav>
    </article>
  );
}

/** The table beside the matches: the next ones to come, then the latest results. */
function SoFar({ slug, view, today }: { slug: string; view: SeasonSoFarView; today: string }) {
  const { play, form } = view;
  const results = play.recent.slice(0, 2);
  // Owed results lead (census 9: the list showed two results and nothing of
  // the three matches whose day passed unscored).
  // Every owed match, up to three — "3 matches need a result" sat over a list
  // that showed two (census 10).
  const due = play.awaitingMatches.slice(0, 3);
  const upcoming = play.upcoming.slice(0, Math.max(1, 4 - results.length - due.length));
  return (
    <div className="tx-sofar" data-testid="tournament-so-far">
      {play.table !== null ? (
        <section className="tx-sofar-part" aria-labelledby="tx-table-title">
          <header className="tx-sofar-head">
            <h2 id="tx-table-title" className="tx-label">
              Table
            </h2>
            <Link href={`/seasons/${slug}/standings`} className="tx-more">
              Full table
              <IconArrowRight size={14} aria-hidden />
            </Link>
          </header>
          {play.played > 0 ? (
            <table className="tx-table">
              <thead>
                <tr>
                  <th scope="col">
                    <VisuallyHidden>Position</VisuallyHidden>
                  </th>
                  <th scope="col">
                    <VisuallyHidden>Team</VisuallyHidden>
                  </th>
                  <th scope="col" className="tx-table-form">
                    Form
                  </th>
                  <th scope="col">
                    <abbr title="Played">P</abbr>
                  </th>
                  <th scope="col">
                    <abbr title="Won">W</abbr>
                  </th>
                  <th scope="col">
                    <abbr title="Lost">L</abbr>
                  </th>
                  <th scope="col">Pts</th>
                </tr>
              </thead>
              <tbody>
                {play.table.slice(0, 6).map((row, index) => (
                  <tr key={row.teamId} data-lead={index === 0 ? "true" : undefined}>
                    <td className="tx-table-pos">{index + 1}</td>
                    <th scope="row">
                      <span
                        className="tx-table-dot"
                        style={
                          row.color === null
                            ? undefined
                            : ({ "--team-color": row.color } as CSSProperties)
                        }
                        aria-hidden
                      />
                      {row.name}
                    </th>
                    <td className="tx-table-form">
                      <span className="tx-form">
                        {(form[row.teamId] ?? []).slice(-3).map((letter, at) => (
                          <span key={at} data-result={letter}>
                            {letter}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>{row.played}</td>
                    <td>{row.won}</td>
                    <td>{row.lost}</td>
                    <td className="tx-table-pts">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="tx-sofar-empty">The table fills as results come in.</p>
          )}
        </section>
      ) : null}
      <section className="tx-sofar-part" aria-labelledby="tx-matches-title">
        <header className="tx-sofar-head">
          <h2 id="tx-matches-title" className="tx-label">
            Matches
          </h2>
          <Link href={`/seasons/${slug}/fixtures`} className="tx-more">
            Schedule
            <IconArrowRight size={14} aria-hidden />
          </Link>
        </header>
        {upcoming.length + results.length + due.length > 0 ? (
          <ul className="tx-lines">
            {due.map((match) => (
              <li key={match.fixtureId} data-state="due">
                <span className="tx-line-when">{dayWord(match.kickoffAt, today)}</span>
                <Link
                  href={`/seasons/${slug}/fixtures?match=${match.fixtureId}`}
                  className="tx-line-body"
                >
                  <span>
                    <strong>{match.homeName ?? "Lobby"}</strong>
                    {match.awayName !== null ? (
                      <>
                        {" "}
                        v <strong>{match.awayName}</strong>
                      </>
                    ) : null}
                  </span>
                  <span className="tx-line-meta">Result due</span>
                </Link>
              </li>
            ))}
            {upcoming.map((match) => (
              <li key={match.fixtureId} data-state="next">
                <span className="tx-line-when">{dayWord(match.kickoffAt, today)}</span>
                <Link
                  href={`/seasons/${slug}/fixtures?match=${match.fixtureId}`}
                  className="tx-line-body"
                >
                  <span>
                    <strong>{match.homeName ?? "Lobby"}</strong>
                    {match.awayName !== null ? (
                      <>
                        {" "}
                        v <strong>{match.awayName}</strong>
                      </>
                    ) : null}
                  </span>
                  <span className="tx-line-meta">
                    {[
                      match.kickoffAt !== null && match.kickoffAt.length > 10
                        ? formatWallTime(match.kickoffAt.replace(" ", "T").slice(0, 16))
                        : null,
                      match.groundName,
                    ]
                      .filter((part): part is string => part !== null && part !== "")
                      .join(" · ") || "Time to be set"}
                  </span>
                </Link>
              </li>
            ))}
            {results.map((match) => {
              const said = resultSentence(match);
              return (
                <li key={match.fixtureId} data-state="done">
                  <span className="tx-line-when">{dayWord(match.kickoffAt, today)}</span>
                  <Link
                    href={`/seasons/${slug}/fixtures?match=${match.fixtureId}`}
                    className="tx-line-body"
                  >
                    <span>
                      {said.lead !== null ? <strong>{said.lead}</strong> : null}
                      {said.rest}
                    </span>
                  </Link>
                </li>
              );
            })}
            {/* The table counts every result; the list shows the latest two,
                and says there are more (census 15: 2 listed, 3 counted). */}
            {play.played > results.length ? (
              <li data-state="more">
                <Link href={`/seasons/${slug}/fixtures`} className="tx-more">
                  {String(play.played - results.length)} more{" "}
                  {play.played - results.length === 1 ? "result" : "results"}
                  <IconArrowRight size={14} aria-hidden />
                </Link>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="tx-sofar-empty">No matches to come.</p>
        )}
      </section>
    </div>
  );
}

/** "Today", "Tomorrow", else "4 Oct". */
function dayWord(kickoffAt: string | null, today: string): string {
  if (kickoffAt === null) return "TBA";
  const day = kickoffAt.slice(0, 10);
  return relativeDay(day, today) ?? wallDay(day).date;
}
