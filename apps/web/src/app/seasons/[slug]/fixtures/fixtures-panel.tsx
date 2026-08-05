"use client";

import { FIXTURE_CSV_HEADER } from "@desiauction/core";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Select,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createFixtureAction,
  discardDraftsAction,
  exportFixturesAction,
  fixtureImportCommitAction,
  fixtureImportPreviewAction,
  fixtureLifecycleAction,
  fixtureTimelineAction,
  generateFixturesAction,
  previewGenerationAction,
  publishAllAction,
  rescheduleFixtureAction,
  scheduleAllAction,
  type BulkFixtureResult,
  type FixtureDashboard,
  type FixtureImportPreview,
  type FixtureLifecycleAction,
} from "../../../../server/competition/fixture-actions";
import { formatDateTime, formatKickoff, formatWallDate } from "../../../../lib/format-date";
import type { FixtureTimelineEntry } from "../../../../server/competition/fixtures";

type Snapshot = FixtureDashboard["page"]["rows"][number];
type GeneratePreview = Awaited<ReturnType<typeof previewGenerationAction>>;

const FIXTURE_TONE = {
  draft: "neutral",
  scheduled: "info",
  published: "success",
  in_progress: "warning",
  completed: "neutral",
  cancelled: "danger",
} as const;

const STATUS_FILTERS = [
  "",
  "draft",
  "scheduled",
  "published",
  "in_progress",
  "completed",
  "cancelled",
];
const SORTS = ["kickoff", "kickoff_desc", "number", "round"];

// At 240 fixtures the conflict panel ran 3565px of a 6431px page. Bound it.
const CONFLICTS_SHOWN = 20;

// The single next lifecycle step per status (one gate at a time, doc 44 pattern).
const NEXT_ACTION: Partial<
  Record<Snapshot["status"], { action: FixtureLifecycleAction; label: string }>
> = {
  draft: { action: "schedule", label: "Schedule" },
  scheduled: { action: "publish", label: "Publish" },
  published: { action: "start", label: "Start" },
  in_progress: { action: "complete", label: "Complete" },
};

export function FixturesPanel({
  slug,
  orgSlug,
  isPublic,
  stats,
  page,
  teams,
  grounds: groundsProp,
  conflicts: conflictsProp,
  canManage,
  filters,
}: {
  slug: string;
  orgSlug: string;
  isPublic: boolean;
  stats: FixtureDashboard["stats"];
  page: FixtureDashboard["page"];
  teams: FixtureDashboard["teams"];
  grounds?: FixtureDashboard["grounds"];
  conflicts?: FixtureDashboard["conflicts"];
  canManage: boolean;
  filters: { status: string; team: string; ground: string; q: string; sort: string };
}) {
  // Both arrive undefined without fixture.manage — the server omits the keys
  // rather than trusting this component to hide them.
  const grounds = groundsProp ?? [];
  const conflicts = conflictsProp ?? [];
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(filters.q);
  const [moving, setMoving] = useState<string | null>(null);
  const [moveKickoff, setMoveKickoff] = useState("");
  const [moveGround, setMoveGround] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<FixtureTimelineEntry[]>([]);
  const [preview, setPreview] = useState<FixtureImportPreview | null>(null);
  const csvRef = useRef<HTMLTextAreaElement>(null);
  // Hydration marker (M-IP3-2 pattern): handlers are live once this flips.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Generate wizard state. `plan` holds the dry run awaiting confirmation.
  const [plan, setPlan] = useState<Extract<GeneratePreview, { ok: true }> | null>(null);
  const [genRounds, setGenRounds] = useState("1");
  const [genStart, setGenStart] = useState("");
  const [genTimes, setGenTimes] = useState("18:00");
  const [genDuration, setGenDuration] = useState("180");
  const [genGrounds, setGenGrounds] = useState<Set<string>>(new Set());

  // Manual fixture state.
  const [manHome, setManHome] = useState("");
  const [manAway, setManAway] = useState("");
  const [manGround, setManGround] = useState("");
  const [manKickoff, setManKickoff] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));

  // The schedule reads by round, the way a fixture list is actually published.
  // Map preserves insertion order, so rounds appear in the server's sort order.
  //
  // The round header used to read "Week {round}" — the round number printed a
  // second time, in a costume. The generator puts each round on a CONSECUTIVE
  // DAY, so rounds 1, 2 and 3 were 1, 2 and 3 August: three days inside one
  // calendar week, labelled three different weeks. It now shows when the round
  // is actually played, derived from its own fixtures.
  const rounds = useMemo(() => {
    const groups = new Map<number | null, Snapshot[]>();
    for (const row of page.rows) {
      const list = groups.get(row.round) ?? [];
      list.push(row);
      groups.set(row.round, list);
    }
    return [...groups.entries()].map(([round, rows]) => {
      const dates = [
        ...new Set(rows.map((r) => r.kickoffAt?.slice(0, 10)).filter((d) => d !== undefined)),
      ].sort();
      const first = dates[0];
      const last = dates[dates.length - 1];
      const when =
        first === undefined || last === undefined
          ? null
          : first === last
            ? formatWallDate(first)
            : `${formatWallDate(first)} – ${formatWallDate(last)}`;
      return { round, rows, when };
    });
  }, [page.rows]);

  const pushQuery = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams();
      const merged = {
        status: filters.status,
        team: filters.team,
        ground: filters.ground,
        q: filters.q,
        sort: filters.sort,
        ...patch,
      };
      for (const [key, value] of Object.entries(merged)) {
        if (value !== "" && !(key === "sort" && value === "kickoff")) {
          next.set(key, value);
        }
      }
      router.push(`/seasons/${slug}/fixtures?${next.toString()}`);
    },
    [router, slug, filters],
  );

  /**
   * `done` may be a sentence or a function of the result. Bulk actions must use
   * the function form: "Schedule published" fired on `ok` alone, so publishing
   * ZERO fixtures reported success in green while the `applied`/`skipped` counts
   * sat unread in the very same object.
   */
  const act = async <T extends { ok: boolean; error?: string }>(
    fn: () => Promise<T>,
    done?: string | ((result: T) => { title: string; tone: "success" | "info" | "danger" }),
  ) => {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (result.ok) {
      if (typeof done === "function") {
        toast(done(result));
      } else if (done !== undefined) {
        toast({ title: done, tone: "success" });
      }
      router.refresh();
    } else {
      toast({ title: result.error ?? "That didn't work.", tone: "danger" });
    }
    return result;
  };

  const generateInput = () => ({
    rounds: genRounds === "2" ? (2 as const) : (1 as const),
    startDate: genStart,
    kickoffTimes: genTimes
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== ""),
    groundIds: [...genGrounds],
    durationMinutes: Number.parseInt(genDuration, 10),
  });

  const askToGenerate = async () => {
    setBusy(true);
    const result = await previewGenerationAction(slug, generateInput());
    setBusy(false);
    if (!result.ok) {
      toast({ title: result.error, tone: "danger" });
      return;
    }
    setPlan(result);
  };

  const generate = () =>
    act(
      () => generateFixturesAction(slug, generateInput()),
      (result) => {
        setPlan(null);
        return {
          title: `${String(result.created ?? 0)} fixtures generated as drafts.`,
          tone: "success" as const,
        };
      },
    );

  /** "3 of 240 scheduled, 237 skipped" — what actually happened, every time. */
  const bulkOutcome =
    (verb: string, noun: string, nothing: string) =>
    (result: BulkFixtureResult): { title: string; tone: "success" | "info" } => {
      const applied = result.applied ?? 0;
      const skipped = result.skipped ?? 0;
      if (applied === 0 && skipped === 0) {
        return { title: nothing, tone: "info" };
      }
      if (applied === 0) {
        return { title: `Nothing ${verb} — ${String(skipped)} ${noun} skipped.`, tone: "info" };
      }
      return {
        title:
          skipped === 0
            ? `${String(applied)} ${noun} ${verb}.`
            : `${String(applied)} ${noun} ${verb}, ${String(skipped)} skipped.`,
        tone: "success",
      };
    };

  const createManual = () =>
    act(async () => {
      const result = await createFixtureAction(slug, {
        homeTeamId: manHome,
        awayTeamId: manAway,
        ...(manGround !== "" ? { groundId: manGround } : {}),
        ...(manKickoff !== "" ? { kickoffAt: manKickoff } : {}),
        durationMinutes: Number.parseInt(genDuration, 10) || 180,
      });
      if (result.ok) {
        setManHome("");
        setManAway("");
        setManGround("");
        setManKickoff("");
        setManualOpen(false);
      }
      return result;
    }, "Fixture created");

  const lifecycle = (fixtureId: string, action: FixtureLifecycleAction) =>
    act(() => fixtureLifecycleAction(slug, fixtureId, action));

  const move = (fixtureId: string) =>
    act(async () => {
      const result = await rescheduleFixtureAction(slug, fixtureId, {
        ...(moveKickoff !== "" ? { kickoffAt: moveKickoff } : {}),
        ...(moveGround !== "" ? { groundId: moveGround } : {}),
      });
      if (result.ok) {
        setMoving(null);
        setMoveKickoff("");
        setMoveGround("");
      }
      return result;
    }, "Fixture moved");

  const openDetails = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    setTimeline(await fixtureTimelineAction(slug, id));
  };

  const doExport = async () => {
    const result = await exportFixturesAction(slug);
    if (!result.ok) {
      toast({ title: result.error, tone: "danger" });
      return;
    }
    const blob = new Blob([result.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const runPreview = async () => {
    const text = csvRef.current?.value ?? "";
    if (text.trim() === "") {
      return;
    }
    setPreview(await fixtureImportPreviewAction(slug, text));
  };

  const commitImport = () =>
    act(async () => {
      const result = await fixtureImportCommitAction(slug, csvRef.current?.value ?? "");
      if (result.ok) {
        setPreview(null);
        if (csvRef.current) {
          csvRef.current.value = "";
        }
        setImportOpen(false);
      }
      return result;
    }, "Fixtures imported");

  return (
    <>
      <div className="stat-row" data-testid="stat-row" data-hydrated={hydrated ? "true" : "false"}>
        <StatTile label="Total" value={stats.total} testId="stat-total" />
        <StatTile label="Draft" value={stats.draft} testId="stat-draft" />
        <StatTile label="Scheduled" value={stats.scheduled} testId="stat-scheduled" />
        <StatTile label="Published" value={stats.published} testId="stat-published" />
        <StatTile label="Completed" value={stats.completed} testId="stat-completed" />
        <StatTile label="Cancelled" value={stats.cancelled} testId="stat-cancelled" />
      </div>

      {conflicts.length > 0 ? (
        <Card data-testid="conflict-panel">
          <h2>Conflicts</h2>
          <p className="competitions-hint">
            {conflicts.length} clash{conflicts.length === 1 ? "" : "es"} in this season&apos;s
            schedule.
            {conflicts.length > CONFLICTS_SHOWN
              ? ` Showing the first ${String(CONFLICTS_SHOWN)}.`
              : ""}
          </p>
          {/* Unbounded, this panel ran 3565px of a 6431px page at 240 fixtures. */}
          <ul className="conflict-list">
            {conflicts.slice(0, CONFLICTS_SHOWN).map((entry, index) => (
              <li key={index} data-testid="conflict-item">
                <Badge tone={entry.severity === "blocking" ? "danger" : "warning"}>
                  {entry.type.replace(/_/g, " ")}
                </Badge>
                {/* The fixture numbers were always in the payload; now they are
                    on the screen, so "which two?" has an answer. */}
                <span>
                  <strong className="conflict-fixtures">
                    {entry.fixtures.map((f) => f.number).join(" · ")}
                  </strong>{" "}
                  {entry.detail}
                  {entry.fixtures.map((f) => (
                    <span className="conflict-fixture-line" key={f.id}>
                      {f.number} — {f.teams}
                      {f.kickoffAt !== null ? `, ${formatKickoff(f.kickoffAt)}` : ""}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canManage ? (
        <Card data-testid="generate-panel">
          <div className="teams-head">
            <div className="teams-head-title">
              <h2>Generate fixtures</h2>
            </div>
            <Button
              size="sm"
              variant="secondary"
              data-testid="open-add-fixture"
              onClick={() => {
                setManualOpen(true);
              }}
            >
              + Add one fixture
            </Button>
          </div>
          <p className="competitions-hint">
            Deterministic round robin over this season&apos;s teams — same inputs, same schedule,
            every time. Generated fixtures land as drafts, and home and away are shared out evenly.
          </p>
          {/* The blocked activation path, stated BEFORE the form rather than as
              one unlinked sentence buried inside it. An org with no venues can
              never generate, and "your organization page" was not a link. */}
          {teams.length < 2 || grounds.length === 0 ? (
            <div className="dash-hint" data-testid="generate-blocked">
              <p>
                {teams.length < 2
                  ? `This season has ${teams.length === 0 ? "no" : "one"} team. A round robin needs at least two.`
                  : "This organization has no active grounds yet, so there is nowhere to play."}
              </p>
              {teams.length < 2 ? (
                <Link href={`/seasons/${slug}/teams`}>Add teams</Link>
              ) : (
                <Link href={`/org/${orgSlug}/venues`} data-testid="add-venues-link">
                  Add a venue and its grounds
                </Link>
              )}
            </div>
          ) : null}
          <div className="date-row">
            <Select
              label="Rounds"
              name="rounds"
              value={genRounds}
              onChange={(event) => {
                setGenRounds(event.target.value);
              }}
            >
              <option value="1">Single round robin</option>
              <option value="2">Double round robin</option>
            </Select>
            <Field
              label="Start date"
              name="startDate"
              type="date"
              value={genStart}
              onChange={(event) => {
                setGenStart(event.target.value);
              }}
            />
            <Field
              label="Kickoff times"
              name="kickoffTimes"
              value={genTimes}
              onChange={(event) => {
                setGenTimes(event.target.value);
              }}
              placeholder="18:00,20:00"
            />
            <Field
              label="Duration (min)"
              name="duration"
              value={genDuration}
              onChange={(event) => {
                setGenDuration(event.target.value);
              }}
            />
          </div>
          <fieldset className="ground-picker">
            <legend>Grounds</legend>
            {grounds.length === 0 ? (
              <p className="competitions-hint">
                No active grounds yet — <Link href={`/org/${orgSlug}/venues`}>add a venue</Link> and
                its grounds first.
              </p>
            ) : (
              grounds.map((ground) => (
                <label key={ground.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={genGrounds.has(ground.id)}
                    onChange={() => {
                      setGenGrounds((prev) => {
                        const next = new Set(prev);
                        if (next.has(ground.id)) {
                          next.delete(ground.id);
                        } else {
                          next.add(ground.id);
                        }
                        return next;
                      });
                    }}
                  />
                  {ground.venueName} · {ground.name}
                </label>
              ))
            )}
          </fieldset>
          <div className="date-row">
            <Button
              onClick={() => void askToGenerate()}
              loading={busy}
              disabled={genStart === "" || genGrounds.size === 0}
              data-testid="generate-fixtures"
            >
              Generate
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void act(
                  () => scheduleAllAction(slug),
                  bulkOutcome("scheduled", "drafts", "There are no drafts to schedule."),
                )
              }
              loading={busy}
              data-testid="schedule-all"
            >
              Schedule all drafts
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void act(
                  () => publishAllAction(slug),
                  bulkOutcome(
                    "published",
                    "fixtures",
                    "There is nothing to publish — no fixture is scheduled yet.",
                  ),
                )
              }
              loading={busy}
              data-testid="publish-all"
            >
              Publish schedule
            </Button>
            {stats.draft > 0 ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setDiscardOpen(true);
                }}
                loading={busy}
                data-testid="discard-drafts"
              >
                Discard {stats.draft} draft{stats.draft === 1 ? "" : "s"}
              </Button>
            ) : null}
          </div>
          {isPublic ? null : (
            <p className="competitions-hint" data-testid="private-season-note">
              This season is private, so a published schedule is still visible only to members. Make
              it public from the season settings to give it a public page.
            </p>
          )}
        </Card>
      ) : null}

      {/* 240 fixtures used to be written blind — no count, no date range, no
          confirmation. A league asked to start 1 March silently ended 28 June,
          discoverable only on page 10. */}
      {canManage ? (
        <Dialog
          open={plan !== null}
          onClose={() => {
            setPlan(null);
          }}
          title="Generate this schedule?"
          footer={
            <Button
              variant="ghost"
              onClick={() => {
                setPlan(null);
              }}
            >
              Cancel
            </Button>
          }
        >
          {plan !== null ? (
            <div data-testid="generate-preview">
              <p>
                <strong>{plan.preview.count}</strong> fixtures across{" "}
                <strong>{plan.preview.rounds}</strong> round
                {plan.preview.rounds === 1 ? "" : "s"}, for {plan.preview.teams} teams.
              </p>
              <p>
                First match {formatWallDate(plan.preview.firstDate)}; last match{" "}
                {formatWallDate(plan.preview.lastDate)}.
              </p>
              <p className="competitions-hint">
                They land as drafts, so nothing is public yet — and you can discard them all in one
                click if the dates are wrong.
              </p>
              <Button onClick={() => void generate()} loading={busy} data-testid="confirm-generate">
                Generate {plan.preview.count} fixtures
              </Button>
            </div>
          ) : null}
        </Dialog>
      ) : null}

      {canManage ? (
        <Dialog
          open={discardOpen}
          onClose={() => {
            setDiscardOpen(false);
          }}
          title={`Discard ${String(stats.draft)} drafts?`}
          footer={
            <Button
              variant="ghost"
              onClick={() => {
                setDiscardOpen(false);
              }}
            >
              Keep them
            </Button>
          }
        >
          <p>
            Every draft fixture is cancelled and its slot released. Scheduled, published and played
            fixtures are untouched. This is how you start a generation over.
          </p>
          <Button
            onClick={() =>
              void act(
                async () => {
                  const result = await discardDraftsAction(slug);
                  if (result.ok) {
                    setDiscardOpen(false);
                  }
                  return result;
                },
                bulkOutcome("discarded", "drafts", "There are no drafts to discard."),
              )
            }
            loading={busy}
            data-testid="confirm-discard-drafts"
          >
            Discard the drafts
          </Button>
        </Dialog>
      ) : null}

      {canManage ? (
        <Dialog
          open={manualOpen}
          onClose={() => {
            setManualOpen(false);
          }}
          title="Add a fixture"
          size="wide"
          footer={
            <Button
              variant="ghost"
              onClick={() => {
                setManualOpen(false);
              }}
            >
              Cancel
            </Button>
          }
        >
          <div className="fixtures-manual-form" data-testid="manual-panel">
            <Select
              label="Home team"
              name="homeTeam"
              value={manHome}
              onChange={(event) => {
                setManHome(event.target.value);
              }}
            >
              <option value="">Choose…</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
            <Select
              label="Away team"
              name="awayTeam"
              value={manAway}
              onChange={(event) => {
                setManAway(event.target.value);
              }}
            >
              <option value="">Choose…</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
            <Select
              label="Ground"
              name="manualGround"
              value={manGround}
              onChange={(event) => {
                setManGround(event.target.value);
              }}
            >
              <option value="">Unassigned</option>
              {grounds.map((ground) => (
                <option key={ground.id} value={ground.id}>
                  {ground.venueName} · {ground.name}
                </option>
              ))}
            </Select>
            <Field
              label="Kickoff"
              name="manualKickoff"
              type="datetime-local"
              value={manKickoff}
              onChange={(event) => {
                setManKickoff(event.target.value);
              }}
            />
            <Button
              onClick={() => void createManual()}
              loading={busy}
              disabled={manHome === "" || manAway === "" || manHome === manAway}
              data-testid="add-fixture"
            >
              Add fixture
            </Button>
          </div>
        </Dialog>
      ) : null}

      <Card>
        <form
          className="filter-bar"
          onSubmit={(event) => {
            event.preventDefault();
            pushQuery({ q: search, page: "1" });
          }}
        >
          <Field
            label="Search"
            name="q"
            placeholder="fixture number"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          <Select
            label="Status"
            name="status"
            value={filters.status}
            onChange={(event) => {
              pushQuery({ status: event.target.value, page: "1" });
            }}
          >
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status === "" ? "All statuses" : status.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
          <Select
            label="Team"
            name="team"
            value={filters.team}
            onChange={(event) => {
              pushQuery({ team: event.target.value, page: "1" });
            }}
          >
            <option value="">All teams</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
          <Select
            label="Ground"
            name="ground"
            value={filters.ground}
            onChange={(event) => {
              pushQuery({ ground: event.target.value, page: "1" });
            }}
          >
            <option value="">All grounds</option>
            {grounds.map((ground) => (
              <option key={ground.id} value={ground.id}>
                {ground.venueName} · {ground.name}
              </option>
            ))}
          </Select>
          <Select
            label="Sort"
            name="sort"
            value={filters.sort}
            onChange={(event) => {
              pushQuery({ sort: event.target.value, page: "1" });
            }}
          >
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {sort.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
          <Button type="submit" data-testid="search-submit">
            Search
          </Button>
        </form>
      </Card>

      <Card>
        <div className="teams-head">
          <div className="teams-head-title">
            <h2>Schedule</h2>
          </div>
          {canManage ? (
            <div className="teams-head-tools">
              <Button
                size="sm"
                variant="secondary"
                data-testid="export-csv"
                onClick={() => void doExport()}
              >
                Export CSV
              </Button>
              <Button
                size="sm"
                data-testid="open-import"
                onClick={() => {
                  setImportOpen(true);
                }}
              >
                + Import fixtures
              </Button>
            </div>
          ) : null}
        </div>
        <div className="table-scroll">
          <table className="reg-table" data-testid="fixtures-table">
            <caption className="table-caption">
              This season&apos;s fixtures, grouped by round — {page.total} match
              {page.total === 1 ? "" : "es"} matching the current filters.
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Fixture</th>
                <th scope="col">Kickoff</th>
                <th scope="col">Ground</th>
                <th scope="col">Status</th>
                {canManage ? (
                  <th scope="col">
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rounds.map(({ round, rows, when }) => (
                <Fragment key={String(round)}>
                  <tr className="round-head">
                    <th scope="rowgroup" colSpan={canManage ? 6 : 5}>
                      <span className="round-head-label">
                        {round !== null ? `Round ${String(round)}` : "Unscheduled"}
                      </span>
                      {when !== null ? <span className="round-head-week">{when}</span> : null}
                    </th>
                  </tr>
                  {rows.map((fixture) => (
                    <FixtureRow
                      key={fixture.id}
                      fixture={fixture}
                      canManage={canManage}
                      busy={busy}
                      moving={moving === fixture.id}
                      grounds={grounds}
                      moveKickoff={moveKickoff}
                      moveGround={moveGround}
                      onMoveKickoff={setMoveKickoff}
                      onMoveGround={setMoveGround}
                      onLifecycle={(action) => void lifecycle(fixture.id, action)}
                      onOpenMove={() => {
                        setMoving(moving === fixture.id ? null : fixture.id);
                        setMoveKickoff(fixture.kickoffAt ?? "");
                        setMoveGround(fixture.groundId ?? "");
                      }}
                      onConfirmMove={() => void move(fixture.id)}
                      onDetails={() => void openDetails(fixture.id)}
                    />
                  ))}
                </Fragment>
              ))}
              {page.rows.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="dash-hint">
                    No fixtures match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="pager">
          <Button
            size="sm"
            variant="ghost"
            disabled={page.page <= 1}
            onClick={() => {
              pushQuery({ page: String(page.page - 1) });
            }}
            data-testid="page-prev"
          >
            Previous
          </Button>
          <span data-testid="page-indicator">
            Page {page.page} of {totalPages} · {page.total} total
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page.page >= totalPages}
            onClick={() => {
              pushQuery({ page: String(page.page + 1) });
            }}
            data-testid="page-next"
          >
            Next
          </Button>
        </div>
      </Card>

      {expanded !== null ? (
        <Card data-testid="fixture-timeline">
          <h2>Fixture timeline</h2>
          <ol className="timeline">
            {timeline.map((entry, index) => (
              <li key={index}>
                <Badge tone="neutral">{entry.action.replace("fixture.", "")}</Badge>
                <span className="timeline-at">{formatDateTime(entry.at)}</span>
                {isMove(entry.meta) ? (
                  <span className="timeline-note">
                    {entry.meta.fromKickoff} → {entry.meta.toKickoff}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {canManage ? (
        <Dialog
          open={importOpen}
          onClose={() => {
            setImportOpen(false);
          }}
          title="Import fixtures"
          size="wide"
          footer={
            <Button
              variant="ghost"
              onClick={() => {
                setImportOpen(false);
              }}
            >
              Close
            </Button>
          }
        >
          <div className="io-panel" data-testid="io-panel">
            <label className="io-file" htmlFor="fixture-csv-input">
              <span>Paste a CSV — columns: {FIXTURE_CSV_HEADER}</span>
            </label>
            {/* A preview describes the text it was run against. Editing the
                CSV after previewing left a stale "N valid row(s)" on screen
                above an Import button that would commit something else. */}
            <textarea
              id="fixture-csv-input"
              ref={csvRef}
              className="csv-input"
              data-testid="import-textarea"
              rows={5}
              placeholder="Paste CSV rows here"
              defaultValue=""
              onChange={() => {
                setPreview(null);
              }}
            />
            <div className="io-row">
              <Button onClick={() => void runPreview()} data-testid="import-preview-btn">
                Preview
              </Button>
            </div>
            {preview !== null ? (
              <div className="import-preview" data-testid="import-preview">
                <p>
                  {preview.validCount} valid row(s) · {preview.errors.length} error(s)
                </p>
                {preview.errors.length > 0 ? (
                  <ul className="import-errors">
                    {preview.errors.slice(0, 8).map((error, index) => (
                      <li key={index}>
                        Line {error.line}: {error.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Button
                  onClick={() => void commitImport()}
                  loading={busy}
                  disabled={preview.errors.length > 0 || preview.validCount === 0}
                  data-testid="import-commit"
                >
                  Import {preview.validCount} fixture(s)
                </Button>
              </div>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

function StatTile({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="stat-tile" data-testid={testId}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function isMove(meta: unknown): meta is { fromKickoff: string; toKickoff: string } {
  return (
    typeof meta === "object" &&
    meta !== null &&
    typeof (meta as { toKickoff?: unknown }).toKickoff === "string" &&
    (meta as { toKickoff: string }).toKickoff !== ""
  );
}

function FixtureRow({
  fixture,
  canManage,
  busy,
  moving,
  grounds,
  moveKickoff,
  moveGround,
  onMoveKickoff,
  onMoveGround,
  onLifecycle,
  onOpenMove,
  onConfirmMove,
  onDetails,
}: {
  fixture: Snapshot;
  canManage: boolean;
  busy: boolean;
  moving: boolean;
  grounds: NonNullable<FixtureDashboard["grounds"]>;
  moveKickoff: string;
  moveGround: string;
  onMoveKickoff: (value: string) => void;
  onMoveGround: (value: string) => void;
  onLifecycle: (action: FixtureLifecycleAction) => void;
  onOpenMove: () => void;
  onConfirmMove: () => void;
  onDetails: () => void;
}) {
  const next = NEXT_ACTION[fixture.status];
  const movable = fixture.status === "scheduled" || fixture.status === "published";
  const cancellable = fixture.status !== "completed" && fixture.status !== "cancelled";
  return (
    <>
      {/* `.reg-table` hides its `thead` below 1100px and restores the headings
          from `data-label` (seasons.css). The `<caption>` and `scope="col"`
          landed here earlier; the labels did not, so on a phone at the ground
          this read as a number, two team names, a time, a place and a word,
          with nothing saying which was the kickoff and which the ground. */}
      <tr data-testid={`fixture-${fixture.number}`}>
        <td data-label="#" className="reg-number">
          {fixture.number}
        </td>
        <td data-label="Fixture">
          <span className="registration-name">
            <span className="fx-team">
              <span
                className="fx-dot"
                style={{ background: fixture.homeTeamColor ?? "var(--accent)" }}
                aria-hidden
              />
              {fixture.homeTeamShort ?? fixture.homeTeamName}
            </span>
            <span className="fx-vs">vs</span>
            <span className="fx-team">
              <span
                className="fx-dot"
                style={{ background: fixture.awayTeamColor ?? "var(--accent)" }}
                aria-hidden
              />
              {fixture.awayTeamShort ?? fixture.awayTeamName}
            </span>
          </span>
        </td>
        <td data-label="Kickoff">
          {fixture.kickoffAt !== null ? formatKickoff(fixture.kickoffAt) : "—"}
        </td>
        <td data-label="Ground">
          {fixture.groundName ?? "—"}
          {fixture.venueName !== null ? (
            <span className="registration-phone">{fixture.venueName}</span>
          ) : null}
        </td>
        <td data-label="Status">
          <Badge tone={FIXTURE_TONE[fixture.status]}>{fixture.status.replace(/_/g, " ")}</Badge>
        </td>
        {canManage ? (
          <td data-label="" className="reg-actions">
            {next !== undefined ? (
              <Button
                size="sm"
                onClick={() => {
                  onLifecycle(next.action);
                }}
                loading={busy}
                data-testid={`${next.action}-${fixture.number}`}
              >
                {next.label}
              </Button>
            ) : null}
            {movable ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={onOpenMove}
                data-testid={`move-${fixture.number}`}
              >
                Move
              </Button>
            ) : null}
            {cancellable ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onLifecycle("cancel");
                }}
                loading={busy}
              >
                Cancel
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onDetails}>
              Details
            </Button>
          </td>
        ) : null}
      </tr>
      {moving ? (
        <tr data-testid={`move-row-${fixture.number}`}>
          <td colSpan={canManage ? 6 : 5}>
            <div className="date-row">
              <Field
                label="New kickoff"
                name="moveKickoff"
                type="datetime-local"
                value={moveKickoff}
                onChange={(event) => {
                  onMoveKickoff(event.target.value);
                }}
              />
              <Select
                label="New ground"
                name="moveGround"
                value={moveGround}
                onChange={(event) => {
                  onMoveGround(event.target.value);
                }}
              >
                <option value="">Keep the current ground</option>
                {grounds.map((ground) => (
                  <option key={ground.id} value={ground.id}>
                    {ground.venueName} · {ground.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                onClick={onConfirmMove}
                loading={busy}
                data-testid={`confirm-move-${fixture.number}`}
              >
                Confirm move
              </Button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
