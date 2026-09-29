"use client";

import { addDays } from "@desiauction/core";
import {
  Button,
  ButtonLink,
  buttonClassName,
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconBolt,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconPin,
  IconPlus,
  IconSearch,
  IconSpark,
  Notice,
  Pill,
  PopoverMenu,
  SectionCard,
  useToast,
} from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useSportTerms } from "../../../../components/sport-terms";
import { formatKickoff, formatWallTime } from "../../../../lib/format-date";
import { buildFilterQuery, useFilterQuery } from "../../../../lib/use-filter-query";
import { useHydrated } from "../../../../lib/use-hydrated";
import {
  exportFixturesAction,
  fixtureLifecycleAction,
  publishAllAction,
  scheduleAllAction,
  type ScheduleView,
} from "../../../../server/competition/fixture-actions";
import { FixtureStatusPill, awaitsResult } from "../_tabs/fixture-status";
import { RoundRobinPreview } from "../_tabs/round-robin-preview";
import { TeamCrest, teamInitials } from "../_tabs/team-crest";
import { ScheduleViews } from "../sibling-link";
import { MatchPanel } from "./match-panel";
import { GenerateForm, PlanDialogs, bulkOutcome, type PlanDialog } from "./plan-tools";
import {
  groupByDay,
  isLobby,
  isScored,
  lineupSummary,
  primaryScore,
  relativeDay,
  resultSentence,
  rowStep,
  wallDay,
} from "./schedule-model";

/**
 * THE MATCHES SCREEN (2026-09-27) — the Schedule tab's one screen, where List,
 * Calendar, Match day and Lineups used to be four.
 *
 * It reads the way an organizer's day does: a strip of seven days around today on
 * top, the matches below grouped by day with today among them, and on every
 * row the ONE thing that match is waiting for — Start, Enter score, Set
 * lineups — or its result. Tapping a match opens it (a side panel; a sheet on a
 * phone) with both lineups and the score, where "Save result and finish match"
 * is one step rather than a trip to two other tabs.
 *
 * The machinery — generate, import, export, discard — waits behind "Plan";
 * the publishing steps sit in one strip that names what is still private.
 */

type Row = ScheduleView["rows"][number];

export interface ScheduleFilters {
  date: string;
  team: string;
  ground: string;
  q: string;
  match: string;
}

const CONFLICTS_SHOWN = 20;

export function SchedulePanel({
  slug,
  view,
  filters,
}: {
  slug: string;
  view: ScheduleView;
  /** RAW params as of this render ("" = absent). */
  filters: ScheduleFilters;
}) {
  const terms = useSportTerms();
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const [dialog, setDialog] = useState<PlanDialog>(null);
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [bulkPending, startBulk] = useTransition();
  const { commit, search, setSearch } = useFilterQuery({ ...filters });

  const { stats, viewer, fixtureShape, results, today } = view;
  const canManage = viewer.canManage;
  const lobbySeason = fixtureShape === "lobby";
  const grounds = view.grounds ?? [];
  const outstanding = view.outstanding ?? [];
  // What is owed a result, oldest first: played-and-unscored, then the week's
  // matches whose day passed with none.
  const owedRows = [
    ...outstanding,
    ...view.rows.filter(
      (row) => awaitsResult(row, today) && !outstanding.some((owed) => owed.id === row.id),
    ),
  ].sort((a, b) => (a.kickoffAt ?? "").localeCompare(b.kickoffAt ?? ""));
  // Being played NOW: a match left open from an earlier day awaits a result.
  const liveNow = Math.max(
    0,
    stats.inProgress -
      view.rows.filter((row) => row.status === "in_progress" && awaitsResult(row, today)).length,
  );
  const noun = lobbySeason ? "lobby" : "match";
  const nouns = lobbySeason ? "lobbies" : "matches";
  const total = stats.total - stats.cancelled;
  const empty = stats.total === 0;
  const needsGround = canManage && !lobbySeason && grounds.length === 0 && empty;

  const href = (patch: Partial<ScheduleFilters>) => {
    const qs = buildFilterQuery({ ...filters }, patch);
    return qs === "" ? `/seasons/${slug}/fixtures` : `/seasons/${slug}/fixtures?${qs}`;
  };
  const matchHref = (id: string) => href({ match: id });
  const closeHref = href({ match: "" });

  const lifecycle = async (fixture: Row, action: "schedule" | "publish" | "start") => {
    setPendingRow(fixture.id);
    const outcome = await fixtureLifecycleAction(slug, fixture.id, action);
    setPendingRow(null);
    if (!outcome.ok) {
      toast({ tone: "danger", title: outcome.error ?? "That didn't work." });
      return;
    }
    if (action === "start") {
      // Straight to the match that just started: its score is the next thing.
      router.push(matchHref(fixture.id), { scroll: false });
    } else {
      router.refresh();
    }
  };

  const bulk = (run: () => Promise<{ ok: boolean; error?: string }>, done: typeof schedOutcome) => {
    startBulk(async () => {
      const outcome = await run();
      if (outcome.ok) {
        toast(done(outcome));
        router.refresh();
      } else {
        toast({ tone: "danger", title: outcome.error ?? "That didn't work." });
      }
    });
  };
  const schedOutcome = bulkOutcome("scheduled", "drafts", "There are no drafts to schedule.");
  const pubOutcome = bulkOutcome(
    "published",
    "matches",
    "There is nothing to publish — no match is scheduled yet.",
  );

  const doExport = async () => {
    const outcome = await exportFixturesAction(slug);
    if (!outcome.ok) {
      toast({ title: outcome.error, tone: "danger" });
      return;
    }
    const blob = new Blob([outcome.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = outcome.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  /* ---- The head: the two faces, what is here, and the two doors ------------ */
  const next = view.next;
  const lede = empty ? (
    canManage ? (
      lobbySeason ? (
        "No lobbies yet — add the first one."
      ) : needsGround ? null : (
        "No matches yet — generate a round robin or add a match by hand."
      )
    ) : (
      "The organizer hasn't published any matches yet."
    )
  ) : (
    <>
      <strong data-testid="stat-total">
        {total} {total === 1 ? noun : nouns}
      </strong>
      {` · ${String(stats.completed)} played`}
      {liveNow > 0 ? <span className="mx-live-word"> · {liveNow} playing now</span> : null}
      {next !== null && next.state === "upcoming" && next.fixture.kickoffAt !== null
        ? ` · next ${wallDay(next.fixture.kickoffAt.slice(0, 10)).label}, ${formatWallTime(next.fixture.kickoffAt)}`
        : ""}
    </>
  );

  const planItems = [
    ...(!lobbySeason && grounds.length > 0 && !empty
      ? [
          {
            key: "generate",
            label: "Generate a round robin",
            onSelect: () => {
              setDialog("generate");
            },
            testId: "open-generate-fixtures",
          },
        ]
      : []),
    {
      key: "import",
      label: "Import from CSV",
      onSelect: () => {
        setDialog("import");
      },
      testId: "open-import",
    },
    ...(!empty
      ? [
          {
            key: "export",
            label: "Export CSV",
            onSelect: () => void doExport(),
            testId: "export-csv",
          },
        ]
      : []),
    { key: "venues", label: `${terms.ground}s and venues`, href: `/org/${view.orgSlug}/venues` },
    ...(stats.draft > 0
      ? [
          {
            key: "discard",
            label: `Discard ${String(stats.draft)} draft${stats.draft === 1 ? "" : "s"}`,
            danger: true,
            onSelect: () => {
              setDialog("discard");
            },
            testId: "discard-drafts",
          },
        ]
      : []),
  ];

  const head = (
    <div className="st-head fx-head">
      <ScheduleViews slug={slug} active="matches" />
      {lede !== null ? <p className="st-head-lede">{lede}</p> : null}
      {canManage ? (
        <div className="st-actions">
          <PopoverMenu
            label="Plan the schedule"
            trigger={
              <>
                <IconSpark size={16} aria-hidden />
                Plan
              </>
            }
            triggerClassName="mx-plan-trigger"
            items={planItems}
          />
          <Button
            size="sm"
            variant="secondary"
            data-testid="open-add-fixture"
            onClick={() => {
              setDialog("add");
            }}
          >
            <IconPlus size={16} aria-hidden />
            Add<span className="mx-wide-only"> {noun}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );

  /* ---- Nothing yet: one statement and its door ------------------------------ */
  const emptyBody = !empty ? null : needsGround ? (
    <>
      <Notice
        tone="warning"
        icon={<IconPin size={20} />}
        title="Add a ground first — matches are scheduled onto grounds"
        action={
          <ButtonLink href={`/org/${view.orgSlug}/venues`} size="sm" data-testid="add-venues-link">
            Add a venue
            <IconArrowRight size={16} aria-hidden />
          </ButtonLink>
        }
        testId="fixtures-needs-ground"
      >
        Once one exists, the round-robin generator opens right here. Grounds belong to the club, so
        one added now is there for every season after this.
      </Notice>
      <RoundRobinPreview teams={view.teams} />
    </>
  ) : canManage && !lobbySeason ? (
    <SectionCard
      icon={<IconSpark />}
      title="Generate fixtures"
      description="Every team plays every other team. Home and away are shared out evenly."
      data-testid="generate-panel"
    >
      <GenerateForm
        slug={slug}
        orgSlug={view.orgSlug}
        teams={view.teams}
        grounds={grounds}
        seasonStartsOn={view.competition.startsOn}
        seasonEndsOn={view.competition.endsOn}
        primary
      />
    </SectionCard>
  ) : canManage ? (
    <SectionCard
      icon={<IconCalendar />}
      tone="blue"
      title="Schedule lobbies"
      description="Every match is one lobby of many squads — add each lobby, then schedule and publish them."
      data-testid="generate-panel"
    >
      <Button
        onClick={() => {
          setDialog("add");
        }}
      >
        <IconPlus size={16} aria-hidden />
        Add a lobby
      </Button>
    </SectionCard>
  ) : (
    <SectionCard title="Matches" hideHeader>
      <EmptyState
        icon={<IconCalendar />}
        title="No matches yet"
        headingLevel={3}
        description="The organizer hasn't published any matches yet."
      />
    </SectionCard>
  );

  /* ---- Publishing: what is still private, and the one step that fixes it ---- */
  const played = stats.inProgress + stats.completed;
  /*
   * What still needs a result: played-and-unscored, plus the week's matches
   * whose day passed with none. "All played matches scored" was green beside
   * a match left in progress two days (census 8) — it is said only when true.
   */
  const needResult = new Set([
    ...outstanding.map((fixture) => fixture.id),
    ...view.rows.filter((row) => awaitsResult(row, today)).map((row) => row.id),
  ]).size;
  const pipeline =
    canManage && !empty ? (
      <section
        className="mx-pipeline"
        aria-label="Publishing"
        data-testid="generate-panel"
        data-settled={stats.draft + stats.scheduled === 0 ? "true" : undefined}
      >
        <ol className="mx-steps">
          <li data-on={stats.draft > 0 ? "true" : undefined}>
            <span className="mx-step-count" data-testid="stat-draft">
              {stats.draft}
            </span>
            Draft
          </li>
          <li data-on={stats.scheduled > 0 ? "true" : undefined}>
            <span className="mx-step-count" data-testid="stat-scheduled">
              {stats.scheduled}
            </span>
            Scheduled
          </li>
          <li data-done={stats.draft + stats.scheduled === 0 ? "true" : undefined}>
            <span className="mx-step-count" data-testid="stat-published">
              {stats.published + played}
            </span>
            Published
          </li>
        </ol>
        <p className="mx-pipeline-say">
          {stats.draft > 0
            ? `${String(stats.draft)} draft${stats.draft === 1 ? " is" : "s are"} yours alone until scheduled and published.`
            : stats.scheduled > 0
              ? `${String(stats.scheduled)} scheduled ${stats.scheduled === 1 ? noun : nouns} ${stats.scheduled === 1 ? "is" : "are"} not public yet.`
              : view.competition.visibility === "public"
                ? "Everything is published."
                : "Published to members — this season is private, so it has no public page."}
        </p>
        <div className="mx-pipeline-go">
          {stats.draft > 0 ? (
            <Button
              size="sm"
              loading={bulkPending}
              onClick={() => {
                bulk(() => scheduleAllAction(slug), schedOutcome);
              }}
              data-testid="schedule-all"
            >
              Schedule all drafts
            </Button>
          ) : stats.scheduled > 0 ? (
            <Button
              size="sm"
              loading={bulkPending}
              onClick={() => {
                bulk(() => publishAllAction(slug), pubOutcome);
              }}
              data-testid="publish-all"
            >
              Publish schedule
            </Button>
          ) : null}
          {/* Only the all-clear: when results are owed, the notice below says
              so with the matches to open — the pill repeated it (census 11). */}
          {played > 0 && needResult === 0 && liveNow === 0 ? (
            <Pill tone="green" dot testId="results-outstanding">
              All played matches scored
            </Pill>
          ) : null}
        </div>
      </section>
    ) : null;

  /* ---- What needs attention outside this week ------------------------------- */
  const inView = new Set([...view.rows, ...view.undated].map((row) => row.id));
  const attention = (
    <>
      {next !== null && next.state !== "upcoming" && !inView.has(next.fixture.id) ? (
        <Notice
          tone={next.state === "live" ? "danger" : "warning"}
          icon={next.state === "live" ? <IconBolt size={20} /> : <IconAlert size={20} />}
          title={
            next.state === "live"
              ? `Playing now: ${describe(next.fixture)}`
              : `${describe(next.fixture)} — its kickoff has passed`
          }
          action={
            <Link
              href={matchHref(next.fixture.id)}
              scroll={false}
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              Open
              <IconArrowRight size={16} aria-hidden />
            </Link>
          }
          testId="next-match"
        >
          {next.state === "live"
            ? "It is not among the days you are looking at."
            : "Start it, move it or cancel it."}
        </Notice>
      ) : null}
      {/*
        THE RESULTS DESK (census 10). Every "Enter results" button in the
        product lands here, and the page opened on a week strip — the owed
        matches sat in their day groups, two of them offering "Start". The
        owed ones now lead: played-and-unscored plus every match whose day
        passed with no result, each a door to its score.
      */}
      {canManage && owedRows.length > 0 ? (
        <Notice
          tone="warning"
          icon={<IconAlert size={20} />}
          title={`${String(owedRows.length)} ${owedRows.length === 1 ? noun : nouns} ${owedRows.length === 1 ? "needs" : "need"} a result`}
          testId="results-owed"
        >
          <span className="mx-owed">
            The table is built from results, so {owedRows.length === 1 ? "it is" : "these are"} not
            in it yet.{" "}
            {owedRows.slice(0, 6).map((fixture) => (
              <Link
                key={fixture.id}
                href={matchHref(fixture.id)}
                scroll={false}
                className="mx-owed-link"
                data-testid={`owed-${fixture.number}`}
              >
                {owedLabel(fixture)}
              </Link>
            ))}
          </span>
        </Notice>
      ) : null}
      {canManage && (view.conflicts ?? []).length > 0 ? (
        <details className="mx-conflicts" data-testid="conflict-panel">
          <summary>
            <IconAlert size={18} aria-hidden />
            {view.conflicts?.length} clash{view.conflicts?.length === 1 ? "" : "es"} in the schedule
          </summary>
          <ul className="st-rows fx-conflicts">
            {(view.conflicts ?? []).slice(0, CONFLICTS_SHOWN).map((entry, index) => (
              <li key={index} data-testid="conflict-item">
                <Pill tone={entry.severity === "blocking" ? "red" : "amber"}>
                  {entry.type.replace(/_/g, " ")}
                </Pill>
                <span className="fx-conflict-text">
                  <strong className="conflict-fixtures">
                    {entry.fixtures.map((f) => f.number).join(" · ")}
                  </strong>{" "}
                  {entry.detail}
                  {entry.fixtures.map((f) => (
                    <span className="fx-conflict-line" key={f.id}>
                      {f.number} — {f.teams}
                      {f.kickoffAt !== null ? `, ${formatKickoff(f.kickoffAt)}` : ""}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );

  /* ---- The toolbar and the week ---------------------------------------------- */
  const toolbar = (
    <form
      className="st-toolbar mx-toolbar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        commit({ q: search, match: "" });
      }}
    >
      <label className="st-search">
        <IconSearch size={18} aria-hidden />
        <span className="st-sr">Find a {noun} by number</span>
        <input
          name="q"
          type="search"
          placeholder={`${lobbySeason ? "Lobby" : "Match"} no.`}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </label>
      {!lobbySeason ? (
        <select
          className="st-select"
          aria-label="Team"
          name="team"
          value={filters.team}
          data-active={filters.team !== "" ? "true" : undefined}
          onChange={(event) => {
            commit({ team: event.target.value });
          }}
        >
          <option value="">All teams</option>
          {view.teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      ) : null}
      {grounds.length > 1 ? (
        <select
          className="st-select"
          aria-label={terms.ground}
          name="ground"
          value={filters.ground}
          data-active={filters.ground !== "" ? "true" : undefined}
          onChange={(event) => {
            commit({ ground: event.target.value });
          }}
        >
          <option value="">All {terms.ground.toLowerCase()}s</option>
          {grounds.map((ground) => (
            <option key={ground.id} value={ground.id}>
              {ground.name}
            </option>
          ))}
        </select>
      ) : null}
    </form>
  );

  const week = view.week;
  const thisWeek = week.days.some((day) => day.date === today);
  const strip = (
    <nav className="mx-week" aria-label="Days">
      {week.earlier !== null ? (
        <Link
          href={href({ date: week.earlier, match: "" })}
          scroll={false}
          className="mx-week-step"
          aria-label="Earlier matches"
          data-testid="week-earlier"
        >
          <IconChevronLeft size={18} />
        </Link>
      ) : (
        <span className="mx-week-step" aria-hidden data-off="true">
          <IconChevronLeft size={18} />
        </span>
      )}
      <ol className="mx-days">
        {week.days.map((day) => {
          const isToday = day.date === today;
          const parts = wallDay(day.date);
          const label = isToday ? "Today" : parts.weekday;
          const dateLine = parts.date;
          const count =
            day.count === 0 ? "—" : `${String(day.count)} ${day.count === 1 ? noun : nouns}`;
          const liveHere = day.date < today ? 0 : day.live;
          const body = (
            <>
              <span className="mx-day-name">{label}</span>
              <span className="mx-day-date">{dateLine}</span>
              {/* A past day is never "live": a match left open there awaits a
                  result (its row says so), it is not being played. */}
              <span className="mx-day-count" data-live={liveHere > 0 ? "true" : undefined}>
                {liveHere > 0 ? `${String(liveHere)} live` : count}
              </span>
            </>
          );
          return (
            <li key={day.date}>
              {day.count > 0 ? (
                <a
                  href={`#day-${day.date}`}
                  className="mx-day"
                  data-today={isToday ? "true" : undefined}
                  aria-current={isToday ? "date" : undefined}
                >
                  {body}
                </a>
              ) : (
                <span
                  className="mx-day"
                  data-empty="true"
                  data-today={isToday ? "true" : undefined}
                >
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {week.later !== null ? (
        <Link
          href={href({ date: week.later, match: "" })}
          scroll={false}
          className="mx-week-step"
          aria-label="Later matches"
          data-testid="week-later"
        >
          <IconChevronRight size={18} />
        </Link>
      ) : (
        <span className="mx-week-step" aria-hidden data-off="true">
          <IconChevronRight size={18} />
        </span>
      )}
      {!thisWeek ? (
        <Link
          href={href({ date: addDays(today, -2), match: "" })}
          scroll={false}
          className="mx-this-week"
          data-testid="week-today"
        >
          Today
        </Link>
      ) : null}
    </nav>
  );

  const renderRow = (fixture: Row, withDate: boolean) => (
    <MatchRow
      key={fixture.id}
      fixture={fixture}
      result={results[fixture.id]}
      withDate={withDate}
      canManage={canManage}
      today={today}
      lineups={view.lineups?.[fixture.id]}
      selected={filters.match === fixture.id}
      href={matchHref(fixture.id)}
      pending={pendingRow === fixture.id}
      onLifecycle={(action) => void lifecycle(fixture, action)}
    />
  );

  const days = groupByDay(view.rows);
  const list = (
    <div className="mx-list" data-testid="fixtures-table">
      {view.mode === "search" ? (
        <p className="mx-search-say">
          {view.rows.length === 0
            ? `No ${noun} is numbered like “${filters.q}”.`
            : `${String(view.rows.length)}${view.truncated ? "+" : ""} ${view.rows.length === 1 ? noun : nouns} numbered like “${filters.q}”.`}{" "}
          <Link href={href({ q: "" })} scroll={false}>
            Back to the days
          </Link>
        </p>
      ) : days.length === 0 && view.undated.length === 0 ? (
        <p className="mx-none">
          {filters.team !== "" || filters.ground !== ""
            ? `No ${noun} fits these filters on these days.`
            : `No ${nouns} on these days.`}
          {week.later !== null ? (
            <>
              {" "}
              <Link href={href({ date: week.later })} scroll={false}>
                Next {noun} day
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {days.map((day) => {
        const rel = relativeDay(day.date, today);
        // The year only when it is not this one — a finished season from last
        // year reads "Sat, 14 Feb 2026", not a February still to come.
        const full = wallDay(
          day.date,
          view.mode === "search" || day.date.slice(0, 4) !== today.slice(0, 4),
        ).label;
        // A past day's open match awaits a result; it is not being played.
        const liveCount =
          day.date < today ? 0 : day.rows.filter((row) => row.status === "in_progress").length;
        return (
          <section
            key={day.date}
            id={`day-${day.date}`}
            className="mx-daygroup"
            data-today={rel === "Today" ? "true" : undefined}
            data-testid={`day-${day.date}`}
            aria-labelledby={`day-head-${day.date}`}
          >
            <header className="mx-daygroup-head">
              <h2 id={`day-head-${day.date}`}>{rel !== null ? `${rel} · ${full}` : full}</h2>
              <span>
                {day.rows.length} {day.rows.length === 1 ? noun : nouns}
                {liveCount > 0 ? ` · ${String(liveCount)} playing now` : ""}
              </span>
            </header>
            <ul className="mx-rows">{day.rows.map((row) => renderRow(row, false))}</ul>
          </section>
        );
      })}
      {view.undated.length > 0 ? (
        <section
          className="mx-daygroup"
          aria-labelledby="day-head-undated"
          data-testid="day-undated"
        >
          <header className="mx-daygroup-head">
            <h2 id="day-head-undated">Not dated yet</h2>
            <span>
              {view.undated.length} {view.undated.length === 1 ? noun : nouns}
            </span>
          </header>
          <ul className="mx-rows">{view.undated.map((row) => renderRow(row, false))}</ul>
        </section>
      ) : null}
    </div>
  );

  const selected = view.selected;

  return (
    // The wrapper is also the page's hydration mark (`data-hydrated`), which
    // the suites wait on before they click.
    <div className="mx" data-testid="stat-row" data-hydrated={hydrated ? "true" : "false"}>
      {head}
      {emptyBody}
      {pipeline}
      {attention}
      {empty ? null : (
        <div className="mx-layout" data-open={selected !== null ? "true" : undefined}>
          <div className="mx-main">
            <div className="mx-controls">
              {view.mode === "week" ? strip : null}
              {toolbar}
            </div>
            {list}
          </div>
          {selected !== null ? (
            <MatchPanel
              key={selected.fixture.id}
              slug={slug}
              selected={selected}
              result={results[selected.fixture.id]}
              scoreFields={view.scoreFields}
              grounds={grounds}
              canManage={canManage}
              closeHref={closeHref}
              today={today}
              nextOwed={(() => {
                const after = owedRows.find((row) => row.id !== selected.fixture.id);
                return after === undefined
                  ? null
                  : { href: matchHref(after.id), label: owedLabel(after) };
              })()}
            />
          ) : null}
        </div>
      )}
      {canManage ? (
        <PlanDialogs
          open={dialog}
          onClose={() => {
            setDialog(null);
          }}
          slug={slug}
          orgSlug={view.orgSlug}
          teams={view.teams}
          grounds={grounds}
          isLobby={lobbySeason}
          drafts={stats.draft}
          canGenerate={!lobbySeason && !empty && grounds.length > 0}
          seasonStartsOn={view.competition.startsOn}
          seasonEndsOn={view.competition.endsOn}
        />
      ) : null}
    </div>
  );
}

/** "F004 · Thane Tuskers v Pune Panthers" — a match named in a sentence. */
/** "Mon 28 Sep · Mumbai Mavericks v Thane Tuskers" — the day, not the match code. */
function owedLabel(fixture: Row): string {
  const day = fixture.kickoffAt?.slice(0, 10) ?? null;
  const when = day === null ? "Undated" : `${wallDay(day).weekday} ${wallDay(day).date}`;
  return isLobby(fixture)
    ? `${when} · lobby of ${String(fixture.squadCount)}`
    : `${when} · ${fixture.homeTeamName ?? "TBA"} v ${fixture.awayTeamName ?? "TBA"}`;
}

function describe(fixture: Row): string {
  return isLobby(fixture)
    ? `${fixture.number} · lobby of ${String(fixture.squadCount)}`
    : `${fixture.number} · ${fixture.homeTeamName ?? "TBA"} v ${fixture.awayTeamName ?? "TBA"}`;
}

function shortOf(name: string | null, short: string | null): string {
  return teamInitials(name ?? "?", short);
}

function MatchRow({
  fixture,
  result,
  withDate,
  canManage,
  today,
  lineups,
  selected,
  href,
  pending,
  onLifecycle,
}: {
  fixture: Row;
  result: ScheduleView["results"][string] | undefined;
  withDate: boolean;
  canManage: boolean;
  today: string;
  lineups: { home: number | null; away: number | null } | undefined;
  selected: boolean;
  href: string;
  pending: boolean;
  onLifecycle: (action: "schedule" | "publish" | "start") => void;
}) {
  const terms = useSportTerms();
  const lobby = isLobby(fixture);
  const scored = isScored(fixture, result === undefined ? {} : { [fixture.id]: result });
  const step = canManage ? rowStep(fixture, { scored, lineups, today }) : null;
  const homeWon = result?.outcome === "home_win";
  const awayWon = result?.outcome === "away_win";
  const showScore = !lobby && result !== undefined;

  const side = (which: "home" | "away") => {
    const name = (which === "home" ? fixture.homeTeamName : fixture.awayTeamName) ?? "TBA";
    const won = which === "home" ? homeWon : awayWon;
    return (
      <span className="mx-side" data-won={won ? "true" : undefined}>
        <TeamCrest
          name={name}
          short={which === "home" ? fixture.homeTeamShort : fixture.awayTeamShort}
          color={which === "home" ? fixture.homeTeamColor : fixture.awayTeamColor}
        />
        <span className="mx-side-name">{name}</span>
        {showScore ? (
          <span className="mx-side-score">
            {primaryScore(which === "home" ? result.score?.home : result.score?.away)}
          </span>
        ) : null}
      </span>
    );
  };

  const sub =
    fixture.status === "cancelled" ? (
      <span className="mx-sub">
        Cancelled{fixture.cancelReason !== null ? ` — ${fixture.cancelReason}` : ""}
      </span>
    ) : lobby ? (
      <span className="mx-sub">
        {fixture.placedCount > 0
          ? fixture.placedCount === fixture.squadCount
            ? "Every squad placed"
            : `${String(fixture.placedCount)} of ${String(fixture.squadCount)} placed`
          : `${String(fixture.squadCount)} squads`}
      </span>
    ) : result !== undefined ? (
      <span className="mx-sub" data-tone="result">
        {resultSentence(result.outcome, fixture.homeTeamName, fixture.awayTeamName)}
      </span>
    ) : awaitsResult(fixture, today) ? (
      <span className="mx-sub" data-tone="due">
        Its day has passed — enter the score
      </span>
    ) : canManage && lineups !== undefined && fixture.status !== "completed" ? (
      <span className="mx-sub">
        {lineupSummary(
          lineups,
          shortOf(fixture.homeTeamName, fixture.homeTeamShort),
          shortOf(fixture.awayTeamName, fixture.awayTeamShort),
        )}
      </span>
    ) : null;

  return (
    <li
      className="mx-row"
      data-testid={`fixture-${fixture.number}`}
      data-status={fixture.status}
      data-selected={selected ? "true" : undefined}
    >
      <Link
        href={href}
        scroll={false}
        className="mx-row-link"
        aria-current={selected ? "true" : undefined}
      >
        <span className="mx-when">
          {fixture.kickoffAt !== null ? (
            <>
              <span className="st-sr">{formatKickoff(fixture.kickoffAt)}</span>
              <span className="mx-time" aria-hidden>
                {withDate ? formatKickoff(fixture.kickoffAt) : formatWallTime(fixture.kickoffAt)}
              </span>
            </>
          ) : (
            <span className="mx-time">Date to be set</span>
          )}
          <span className="mx-ground">
            <span className="st-sr">{terms.ground}: </span>
            {fixture.groundName ?? `No ${terms.ground.toLowerCase()} yet`}
          </span>
          <span className="mx-num">{fixture.number}</span>
        </span>
        <span className="mx-sides">
          {lobby ? (
            <span className="mx-side" data-testid={`lobby-${fixture.number}`}>
              <span className="mx-lobby-mark" aria-hidden>
                {fixture.squadCount}
              </span>
              <span className="mx-side-name">Lobby · {fixture.squadCount} squads</span>
            </span>
          ) : (
            <>
              {side("home")}
              <span className="st-sr"> versus </span>
              {side("away")}
            </>
          )}
          {sub}
        </span>
      </Link>
      <span className="mx-state">
        <FixtureStatusPill status={fixture.status} overdue={awaitsResult(fixture, today)} />
      </span>
      {canManage ? (
        <span className="mx-act">
          {step === null ? null : step.kind === "lifecycle" ? (
            <Button
              size="sm"
              // An owed score is the row's urgent act, as "Enter score" on a
              // match in progress already is.
              variant={awaitsResult(fixture, today) ? "primary" : "secondary"}
              loading={pending}
              onClick={() => {
                onLifecycle(step.action);
              }}
              data-testid={`${step.action}-${fixture.number}`}
            >
              {step.label}
            </Button>
          ) : (
            <Link
              href={href}
              scroll={false}
              className={buttonClassName({
                variant: step.kind === "score" && step.urgent ? "primary" : "secondary",
                size: "sm",
              })}
              data-testid={`${step.kind === "score" ? "record" : "lineups"}-${fixture.number}`}
            >
              {step.label}
            </Link>
          )}
        </span>
      ) : null}
    </li>
  );
}
