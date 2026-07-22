"use client";

import { FIXTURE_CSV_HEADER } from "@desiauction/core";
import { Badge, Button, Card, Field, Select, useToast, VisuallyHidden } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createFixtureAction,
  exportFixturesAction,
  fixtureImportCommitAction,
  fixtureImportPreviewAction,
  fixtureLifecycleAction,
  fixtureTimelineAction,
  generateFixturesAction,
  publishAllAction,
  rescheduleFixtureAction,
  scheduleAllAction,
  type FixtureDashboard,
  type FixtureImportPreview,
  type FixtureLifecycleAction,
} from "../../../../server/competition/fixture-actions";
import { formatDateTime } from "../../../../lib/format-date";
import type { FixtureTimelineEntry } from "../../../../server/competition/fixtures";

type Snapshot = FixtureDashboard["page"]["rows"][number];

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
  stats,
  page,
  teams,
  grounds,
  conflicts,
  canManage,
  filters,
}: {
  slug: string;
  stats: FixtureDashboard["stats"];
  page: FixtureDashboard["page"];
  teams: FixtureDashboard["teams"];
  grounds: FixtureDashboard["grounds"];
  conflicts: FixtureDashboard["conflicts"];
  canManage: boolean;
  filters: { status: string; team: string; ground: string; q: string; sort: string };
}) {
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

  // Generate wizard state.
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

  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));

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
      router.push(`/competitions/${slug}/fixtures?${next.toString()}`);
    },
    [router, slug, filters],
  );

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (result.ok) {
      if (done !== undefined) {
        toast({ title: done, tone: "success" });
      }
      router.refresh();
    } else {
      toast({ title: result.error ?? "That didn't work.", tone: "danger" });
    }
  };

  const generate = () =>
    act(
      () =>
        generateFixturesAction(slug, {
          rounds: genRounds === "2" ? 2 : 1,
          startDate: genStart,
          kickoffTimes: genTimes
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t !== ""),
          groundIds: [...genGrounds],
          durationMinutes: Number.parseInt(genDuration, 10),
        }),
      "Fixtures generated",
    );

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
      </div>

      {conflicts.length > 0 ? (
        <Card data-testid="conflict-panel">
          <h2>Conflicts</h2>
          <ul className="conflict-list">
            {conflicts.map((entry, index) => (
              <li key={index} data-testid="conflict-item">
                <Badge tone={entry.severity === "blocking" ? "danger" : "warning"}>
                  {entry.type.replace(/_/g, " ")}
                </Badge>
                <span>{entry.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {canManage ? (
        <Card data-testid="generate-panel">
          <h2>Generate fixtures</h2>
          <p className="competitions-hint">
            Deterministic round robin over this competition&apos;s teams — same inputs, same
            schedule, every time. Generated fixtures land as drafts.
          </p>
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
                No active grounds. Create a venue and grounds from your organization page first.
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
              onClick={() => void generate()}
              loading={busy}
              disabled={genStart === "" || genGrounds.size === 0}
              data-testid="generate-fixtures"
            >
              Generate
            </Button>
            <Button
              variant="secondary"
              onClick={() => void act(() => scheduleAllAction(slug), "Drafts scheduled")}
              loading={busy}
              data-testid="schedule-all"
            >
              Schedule all drafts
            </Button>
            <Button
              variant="secondary"
              onClick={() => void act(() => publishAllAction(slug), "Schedule published")}
              loading={busy}
              data-testid="publish-all"
            >
              Publish schedule
            </Button>
          </div>
        </Card>
      ) : null}

      {canManage ? (
        <Card data-testid="manual-panel">
          <h2>Add a fixture</h2>
          <div className="date-row">
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
        </Card>
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
        <div className="table-scroll">
          <table className="reg-table" data-testid="fixtures-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Round</th>
                <th>Fixture</th>
                <th>Kickoff</th>
                <th>Ground</th>
                <th>Status</th>
                {canManage ? (
                  <th>
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((fixture) => (
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
              {page.rows.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="dash-hint">
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
        <Card data-testid="io-panel">
          <h2>Import / export</h2>
          <label className="io-file" htmlFor="fixture-csv-input">
            <span>Import CSV — columns: {FIXTURE_CSV_HEADER}</span>
          </label>
          <textarea
            id="fixture-csv-input"
            ref={csvRef}
            className="csv-input"
            data-testid="import-textarea"
            rows={4}
            placeholder="Paste CSV rows here"
            defaultValue=""
          />
          <div className="io-row">
            <Button onClick={() => void runPreview()} data-testid="import-preview-btn">
              Preview
            </Button>
            <Button variant="ghost" onClick={() => void doExport()} data-testid="export-csv">
              Export CSV
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
        </Card>
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
  grounds: FixtureDashboard["grounds"];
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
      <tr data-testid={`fixture-${fixture.number}`}>
        <td className="reg-number">{fixture.number}</td>
        <td>{fixture.round ?? "—"}</td>
        <td>
          <span className="registration-name">
            {fixture.homeTeamName} vs {fixture.awayTeamName}
          </span>
        </td>
        <td>{fixture.kickoffAt !== null ? fixture.kickoffAt.replace("T", " ") : "—"}</td>
        <td>
          {fixture.groundName ?? "—"}
          {fixture.venueName !== null ? (
            <span className="registration-phone">{fixture.venueName}</span>
          ) : null}
        </td>
        <td>
          <Badge tone={FIXTURE_TONE[fixture.status]}>{fixture.status.replace(/_/g, " ")}</Badge>
        </td>
        {canManage ? (
          <td className="reg-actions">
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
          <td colSpan={canManage ? 7 : 6}>
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
