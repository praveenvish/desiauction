"use client";

import { FIXTURE_CSV_HEADER, dailyKickoffs, planRoundRobin } from "@desiauction/core";
import { useSportTerms } from "../../../../components/sport-terms";
import {
  Button,
  ButtonLink,
  CardGrid,
  Dialog,
  Field,
  Notice,
  IconAlert,
  IconArrowRight,
  IconBolt,
  IconCalendar,
  IconCheckCircle,
  IconClock,
  IconDownload,
  IconKebab,
  IconLayers,
  IconPin,
  IconPlus,
  IconSearch,
  IconSpark,
  IconTrophy,
  IconUpload,
  Pill,
  PopoverMenu,
  SectionCard,
  Select,
  StatCard,
  StatGrid,
  TeamChip,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";

import {
  createFixtureAction,
  createLobbyAction,
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
import {
  formatDateTime,
  formatKickoff,
  formatWallDate,
  formatWallTime,
} from "../../../../lib/format-date";
import { FixtureStatusPill } from "../_tabs/fixture-status";
import { ScheduleViews } from "../sibling-link";
import { TeamCrest } from "../_tabs/team-crest";
import { ResultsCard } from "./results-card";
import type { FixtureTimelineEntry } from "../../../../server/competition/fixtures";
import { useHydrated } from "../../../../lib/use-hydrated";

type Snapshot = FixtureDashboard["page"]["rows"][number];
type GeneratePreview = Awaited<ReturnType<typeof previewGenerationAction>>;

/** Status chips over the schedule — each a count, each a filter. */
const STATUS_CHIPS: {
  status: Snapshot["status"];
  label: string;
  key: keyof FixtureDashboard["stats"];
  testId?: string;
  managerOnly?: boolean;
}[] = [
  { status: "draft", label: "Draft", key: "draft", testId: "stat-draft", managerOnly: true },
  {
    status: "scheduled",
    label: "Scheduled",
    key: "scheduled",
    testId: "stat-scheduled",
    managerOnly: true,
  },
  { status: "published", label: "Published", key: "published", testId: "stat-published" },
  { status: "in_progress", label: "Live", key: "inProgress" },
  { status: "completed", label: "Completed", key: "completed" },
  { status: "cancelled", label: "Cancelled", key: "cancelled", testId: "stat-cancelled" },
];

const SORTS: { value: string; label: string }[] = [
  { value: "kickoff", label: "Kickoff, soonest" },
  { value: "kickoff_desc", label: "Kickoff, latest" },
  { value: "number", label: "Fixture number" },
  { value: "round", label: "Round" },
];

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
  results,
  canManage,
  filters,
  scoreFields,
  fixtureShape,
  next,
  seasonStartsOn = null,
  seasonEndsOn = null,
}: {
  next: FixtureDashboard["next"];
  /** The season's own dates — the generator's default start and its limits. */
  seasonStartsOn?: string | null;
  seasonEndsOn?: string | null;
  slug: string;
  orgSlug: string;
  isPublic: boolean;
  stats: FixtureDashboard["stats"];
  page: FixtureDashboard["page"];
  teams: FixtureDashboard["teams"];
  scoreFields: FixtureDashboard["scoreFields"];
  fixtureShape: FixtureDashboard["fixtureShape"];
  grounds?: FixtureDashboard["grounds"];
  conflicts?: FixtureDashboard["conflicts"];
  results: FixtureDashboard["results"];
  canManage: boolean;
  filters: { status: string; team: string; ground: string; q: string; sort: string };
}) {
  const terms = useSportTerms();
  /*
   * ONE MATCH, MANY SQUADS. A battle royale season has no home and no away, so
   * three things change and nothing else does: a fixture row says how many
   * squads dropped in rather than "A vs B", the create form picks a set instead
   * of a pair, and there is no round robin to generate — a schedule of lobbies
   * is a list of dates, not a pairing problem.
   */
  const isLobby = fixtureShape === "lobby";
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
  const hydrated = useHydrated();

  // Generate wizard state. `plan` holds the dry run awaiting confirmation.
  const [plan, setPlan] = useState<Extract<GeneratePreview, { ok: true }> | null>(null);
  const [genRounds, setGenRounds] = useState("1");
  // Starts on the season's first day: an empty date disabled "Generate" with
  // nothing on screen saying why.
  const [genStart, setGenStart] = useState(seasonStartsOn ?? "");
  const [genTimes, setGenTimes] = useState("18:00");
  const [genDuration, setGenDuration] = useState("180");
  // HOW MANY MATCHES A DAY. "fit" works the kickoffs out from the playing day
  // (first match, last finish, match length + break); "custom" takes typed
  // times. Either way the planner packs each day — a round no longer forces a
  // new day, so a 4-team league is not three days by construction.
  const [genMode, setGenMode] = useState<"fit" | "custom">("fit");
  const [genFirst, setGenFirst] = useState("09:00");
  const [genLastEnd, setGenLastEnd] = useState("21:00");
  const [genBreak, setGenBreak] = useState("15");
  const [genPerTeam, setGenPerTeam] = useState("1");
  // One ground is the only answer, so it starts ticked.
  const [genGrounds, setGenGrounds] = useState<Set<string>>(
    () => new Set(grounds.length === 1 && grounds[0] !== undefined ? [grounds[0].id] : []),
  );

  // Manual fixture state.
  const [manHome, setManHome] = useState("");
  const [manAway, setManAway] = useState("");
  const [manGround, setManGround] = useState("");
  const [manKickoff, setManKickoff] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manSquads, setManSquads] = useState<ReadonlySet<string>>(new Set<string>());
  const [importOpen, setImportOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

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

  const durationMinutes = Number.parseInt(genDuration, 10);
  const kickoffTimes =
    genMode === "fit"
      ? dailyKickoffs(genFirst, genLastEnd, durationMinutes, Number.parseInt(genBreak, 10) || 0)
      : genTimes
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t !== "");
  const maxPerTeamPerDay = genPerTeam === "any" ? null : Number.parseInt(genPerTeam, 10);
  const generateInput = () => ({
    rounds: genRounds === "2" ? (2 as const) : (1 as const),
    startDate: genStart,
    kickoffTimes,
    groundIds: [...genGrounds],
    durationMinutes,
    pack: true,
    maxPerTeamPerDay,
  });

  /*
   * THE LIVE ANSWER to "how many a day, and how many days?" — the same planner
   * the server runs, over the same team order (name, then id), so what this
   * says is what "Generate" will do.
   */
  const capacity = useMemo(() => {
    if (isLobby || genStart === "" || genGrounds.size === 0 || kickoffTimes.length === 0) {
      return null;
    }
    const teamIds = [...teams]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((team) => team.id);
    const planned = planRoundRobin({
      teamIds,
      rounds: genRounds === "2" ? 2 : 1,
      startDate: genStart,
      kickoffTimes,
      groundIds: [...genGrounds],
      durationMinutes,
      pack: true,
      maxPerTeamPerDay,
    });
    if (!planned.ok) {
      return null;
    }
    const dates = [...new Set(planned.fixtures.map((f) => f.kickoffAt.slice(0, 10)))].sort();
    const last = dates[dates.length - 1] ?? genStart;
    return {
      matches: planned.fixtures.length,
      days: dates.length,
      first: dates[0] ?? genStart,
      last,
      pastSeason: seasonEndsOn !== null && last > seasonEndsOn,
    };
    // `kickoffTimes` is derived each render; its inputs are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLobby,
    teams,
    genRounds,
    genStart,
    genGrounds,
    genMode,
    genTimes,
    genFirst,
    genLastEnd,
    genBreak,
    genDuration,
    genPerTeam,
    seasonEndsOn,
  ]);

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

  const createLobby = () =>
    act(async () => {
      const result = await createLobbyAction(slug, {
        teamIds: [...manSquads],
        ...(manGround !== "" ? { groundId: manGround } : {}),
        ...(manKickoff !== "" ? { kickoffAt: manKickoff } : {}),
        durationMinutes: Number.parseInt(genDuration, 10) || 180,
      });
      if (result.ok) {
        setManSquads(new Set<string>());
        setManGround("");
        setManKickoff("");
        setManualOpen(false);
      }
      return result;
    }, "Lobby created");

  const toggleSquad = (teamId: string) => {
    setManSquads((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

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

  const teamById = new Map(teams.map((team) => [team.id, team]));
  // With nothing to come, the card shows the last match played on this page.
  const latest = [...page.rows]
    .filter((row) => row.status === "completed" && row.kickoffAt !== null)
    .sort((a, b) => (b.kickoffAt ?? "").localeCompare(a.kickoffAt ?? ""))[0];
  const live = stats.total - stats.cancelled;
  const upcoming = stats.scheduled + stats.published;
  const filtered =
    filters.status !== "" || filters.team !== "" || filters.ground !== "" || filters.q !== "";
  /*
   * ONE primary action on the page: the next bulk step the schedule is waiting
   * for. Generate while there is nothing; schedule while drafts sit; publish
   * while scheduled matches are still private. Everything else is secondary.
   */
  const primary: "generate" | "schedule" | "publish" | "add" | null = !canManage
    ? null
    : live === 0 && !isLobby
      ? "generate"
      : stats.draft > 0
        ? "schedule"
        : stats.scheduled > 0
          ? "publish"
          : "add";
  const noun = isLobby ? "lobby" : "fixture";
  /*
   * NOTHING TO SHOW, AND ONE THING IN THE WAY. With no grounds the season
   * cannot have a match at all, and the page used to say so in one small amber
   * line under four tiles of zeroes, seven zero filter chips, a search box and
   * an Export CSV for nothing. The blocker now leads, alone; the instruments
   * that describe a schedule wait until there is one.
   */
  const empty = stats.total === 0 && !filtered;
  const needsGround = canManage && !isLobby && grounds.length === 0 && stats.total === 0;

  /* ---- The generate form: inline while the schedule is empty, else a dialog -- */
  const generateBlocked =
    // No grounds and nothing scheduled: the notice at the top of the page
    // carries that blocker and its door, so it is not said twice here.
    !isLobby && (teams.length < 2 || (grounds.length === 0 && !needsGround)) ? (
      <div className="fx-blocked" data-testid="generate-blocked">
        <IconAlert size={18} aria-hidden />
        <p className="st-note">
          {teams.length < 2
            ? `This season has ${teams.length === 0 ? "no" : "one"} team. Every team needs someone to play — add at least two.`
            : "This club has no active grounds yet, so there is nowhere to play."}{" "}
          {teams.length < 2 ? (
            <Link href={`/seasons/${slug}/teams`}>Add teams</Link>
          ) : (
            <Link href={`/org/${orgSlug}/venues`}>Add a venue and its grounds</Link>
          )}
        </p>
      </div>
    ) : null;

  const generateForm = isLobby ? null : (
    <div className="fx-generate">
      {generateBlocked}
      <div className="fx-form-grid">
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
          {...(seasonStartsOn !== null ? { min: seasonStartsOn } : {})}
          {...(seasonEndsOn !== null ? { max: seasonEndsOn } : {})}
          onChange={(event) => {
            setGenStart(event.target.value);
          }}
        />
        <Field
          label="Match length (min)"
          name="duration"
          inputMode="numeric"
          value={genDuration}
          onChange={(event) => {
            setGenDuration(event.target.value);
          }}
        />
        <Select
          label="Matches per team per day"
          name="perTeam"
          value={genPerTeam}
          onChange={(event) => {
            setGenPerTeam(event.target.value);
          }}
        >
          <option value="1">1 match</option>
          <option value="2">Up to 2</option>
          <option value="3">Up to 3</option>
          <option value="any">No limit</option>
        </Select>
      </div>
      <fieldset className="fx-times">
        <legend>Match times</legend>
        <div className="fx-mode" role="radiogroup" aria-label="How to set match times">
          <label className="fx-mode-option" data-checked={genMode === "fit" ? "true" : undefined}>
            <input
              type="radio"
              name="genMode"
              checked={genMode === "fit"}
              onChange={() => {
                setGenMode("fit");
              }}
            />
            Fit matches into the day
          </label>
          <label
            className="fx-mode-option"
            data-checked={genMode === "custom" ? "true" : undefined}
          >
            <input
              type="radio"
              name="genMode"
              checked={genMode === "custom"}
              onChange={() => {
                setGenMode("custom");
              }}
            />
            My own kickoff times
          </label>
        </div>
        {genMode === "fit" ? (
          <div className="fx-form-grid">
            <Field
              label="First match at"
              name="firstKickoff"
              type="time"
              value={genFirst}
              onChange={(event) => {
                setGenFirst(event.target.value);
              }}
            />
            <Field
              label="Last match ends by"
              name="lastEnd"
              type="time"
              value={genLastEnd}
              onChange={(event) => {
                setGenLastEnd(event.target.value);
              }}
            />
            <Field
              label="Break between matches (min)"
              name="breakMinutes"
              inputMode="numeric"
              value={genBreak}
              onChange={(event) => {
                setGenBreak(event.target.value);
              }}
            />
          </div>
        ) : (
          <div className="fx-form-grid">
            <Field
              label="Kickoff times"
              name="kickoffTimes"
              value={genTimes}
              onChange={(event) => {
                setGenTimes(event.target.value);
              }}
              placeholder="10:00, 14:00, 18:00"
            />
          </div>
        )}
        <p className="fx-capacity" data-testid="generate-capacity" aria-live="polite">
          {kickoffTimes.length === 0
            ? genMode === "fit"
              ? "Not even one match fits between those times — start earlier, finish later or shorten the match."
              : "Enter at least one kickoff time (HH:MM)."
            : `${String(kickoffTimes.length)} match${kickoffTimes.length === 1 ? "" : "es"} a day on each ${terms.ground.toLowerCase()}: ${kickoffTimes.join(", ")}.`}
          {capacity !== null ? (
            <>
              {" "}
              <strong data-past-season={capacity.pastSeason ? "true" : undefined}>
                {capacity.matches} matches → {capacity.days} day{capacity.days === 1 ? "" : "s"}
                {capacity.days > 1
                  ? ` (${formatWallDate(capacity.first)} – ${formatWallDate(capacity.last)})`
                  : ` (${formatWallDate(capacity.first)})`}
                .
              </strong>
              {capacity.pastSeason && seasonEndsOn !== null
                ? ` That runs past the season's last day (${formatWallDate(seasonEndsOn)}) — allow more matches per team per day, add a ${terms.ground.toLowerCase()}, lengthen the day, or extend the season.`
                : null}
            </>
          ) : null}
        </p>
      </fieldset>
      <fieldset className="fx-grounds">
        <legend>{terms.ground}s</legend>
        {grounds.length === 0 ? (
          <p className="st-note">
            No active grounds yet — <Link href={`/org/${orgSlug}/venues`}>add a venue</Link> and its
            grounds first.
          </p>
        ) : (
          <div className="fx-ground-list">
            {grounds.map((ground) => (
              <label key={ground.id} className="fx-ground">
                <input
                  type="checkbox"
                  checked={genGrounds.has(ground.id)}
                  onChange={() => {
                    setGenGrounds((prev) => {
                      const nextSet = new Set(prev);
                      if (nextSet.has(ground.id)) {
                        nextSet.delete(ground.id);
                      } else {
                        nextSet.add(ground.id);
                      }
                      return nextSet;
                    });
                  }}
                />
                <span>
                  {ground.venueName} · {ground.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="fx-generate-go">
        <Button
          variant={primary === "generate" ? "primary" : "secondary"}
          onClick={() => void askToGenerate()}
          loading={busy}
          disabled={genStart === "" || genGrounds.size === 0 || kickoffTimes.length === 0}
          aria-describedby="generate-why"
          data-testid="generate-fixtures"
        >
          <IconSpark size={16} aria-hidden />
          Generate
        </Button>
        {/* A disabled button always says why — this one used to sit greyed
            out with nothing on screen explaining it. */}
        <p className="st-note" id="generate-why" data-testid="generate-why">
          {genStart === "" && genGrounds.size === 0
            ? `Pick a start date and tick at least one ${terms.ground.toLowerCase()} to generate.`
            : genStart === ""
              ? "Pick a start date to generate."
              : genGrounds.size === 0
                ? `Tick at least one ${terms.ground.toLowerCase()} to generate.`
                : seasonStartsOn !== null && seasonEndsOn !== null
                  ? `The season runs ${formatWallDate(seasonStartsOn)} – ${formatWallDate(seasonEndsOn)}. Fixtures land as drafts, so nothing is public until you publish.`
                  : "Generated fixtures land as drafts, so nothing is public until you publish."}
        </p>
      </div>
    </div>
  );
  /* ---- Bulk steps -------------------------------------------------------- */
  const bulkSteps = (
    <div className="fx-steps">
      <Button
        variant={primary === "schedule" ? "primary" : "secondary"}
        size="sm"
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
        variant={primary === "publish" ? "primary" : "secondary"}
        size="sm"
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
          size="sm"
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
  );

  const privateNote = isPublic ? null : (
    <p className="st-note" data-testid="private-season-note">
      This season is private, so a published schedule is still visible only to members. Make it
      public from the season settings to give it a public page.
    </p>
  );

  /* ---- Next match ---------------------------------------------------------- */
  const NEXT_TITLE = {
    live: "Being played now",
    upcoming: "Next match",
    overdue: "Waiting to be played",
  } as const;
  const nextCard =
    next !== null ? (
      <SectionCard
        icon={
          next.state === "live" ? (
            <IconBolt />
          ) : next.state === "overdue" ? (
            <IconAlert />
          ) : (
            <IconClock />
          )
        }
        tone={next.state === "live" ? "red" : next.state === "overdue" ? "amber" : "gold"}
        title={NEXT_TITLE[next.state]}
        description={
          next.state === "overdue"
            ? "Its kickoff has passed. Start or complete it on Match day, or move it."
            : next.fixture.round !== null
              ? `Round ${String(next.fixture.round)} · ${next.fixture.number}`
              : next.fixture.number
        }
        action={<FixtureStatusPill status={next.fixture.status} />}
        data-testid="next-match"
      >
        <NextMatch fixture={next.fixture} teamById={teamById} ground={terms.ground} />
      </SectionCard>
    ) : latest !== undefined ? (
      <SectionCard
        icon={<IconTrophy />}
        concept="results"
        title="Latest result"
        description={
          latest.round !== null ? `Round ${String(latest.round)} · ${latest.number}` : latest.number
        }
        action={<FixtureStatusPill status={latest.status} />}
        data-testid="next-match"
      >
        <NextMatch
          fixture={latest}
          teamById={teamById}
          ground={terms.ground}
          result={results[latest.id]}
        />
      </SectionCard>
    ) : (
      <SectionCard
        icon={<IconClock />}
        title="Next match"
        description={
          live === 0
            ? "Nothing is on the schedule yet."
            : "No match is coming up — everything scheduled has been played."
        }
        data-testid="next-match"
      />
    );

  /* ---- Tools for the organizer --------------------------------------------- */
  const toolsCard =
    canManage && (live > 0 || isLobby) ? (
      <SectionCard
        icon={<IconLayers />}
        tone="blue"
        title={isLobby ? "Schedule lobbies" : "Schedule tools"}
        description={
          isLobby
            ? "Every match is one lobby of many squads — add each lobby, then schedule and publish the lot."
            : "Move drafts to scheduled, then publish the schedule to your players and owners."
        }
        data-testid="generate-panel"
      >
        <div className="fx-tools">
          <dl className="fx-pipeline">
            <div>
              <dt>Draft</dt>
              <dd>{stats.draft}</dd>
            </div>
            <div>
              <dt>Scheduled</dt>
              <dd>{stats.scheduled}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{stats.published + stats.inProgress + stats.completed}</dd>
            </div>
          </dl>
          {bulkSteps}
          {privateNote}
        </div>
      </SectionCard>
    ) : null;

  return (
    <>
      {/* ONE ROW: the four faces of the Schedule tab (List | Calendar | Match
          day | Table — it was a "Table →" band plus two more buttons), what
          is here, and a match by hand. */}
      <div className="st-head fx-head">
        <ScheduleViews slug={slug} active="list" />
        <p className="st-head-lede">
          {stats.total > 0 ? (
            <>
              <strong>
                {stats.total} {isLobby ? "lobb" : "fixture"}
                {isLobby ? (stats.total === 1 ? "y" : "ies") : stats.total === 1 ? "" : "s"}
              </strong>
              {stats.rounds > 0
                ? ` across ${String(stats.rounds)} round${stats.rounds === 1 ? "" : "s"}`
                : ""}
            </>
          ) : canManage ? (
            isLobby ? (
              "No lobbies yet — add the first one by hand."
            ) : needsGround ? (
              "No fixtures yet — add a ground, then generate the schedule."
            ) : (
              "No fixtures yet — generate a round robin or add a match by hand."
            )
          ) : (
            "The organizer hasn't published any matches yet."
          )}
        </p>
        <div className="st-actions">
          {/* The generator's door once there is a schedule: it opens the same
              form as a dialog. While the schedule is empty the form sits
              inline below; with no ground it waits behind the notice. */}
          {canManage && !isLobby && primary !== "generate" && grounds.length > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              data-testid="open-generate-fixtures"
              onClick={() => {
                setGenerateOpen(true);
              }}
            >
              <IconSpark size={16} aria-hidden />
              Generate fixtures
            </Button>
          ) : null}
          {canManage ? (
            <Button
              size="sm"
              variant={primary === "add" ? "primary" : "secondary"}
              data-testid="open-add-fixture"
              onClick={() => {
                setManualOpen(true);
              }}
            >
              <IconPlus size={16} aria-hidden />
              Add {noun}
            </Button>
          ) : null}
        </div>
      </div>

      {needsGround ? (
        <Notice
          tone="warning"
          icon={<IconPin size={20} />}
          title="Add a ground first — matches are scheduled onto grounds"
          action={
            <ButtonLink href={`/org/${orgSlug}/venues`} size="sm" data-testid="add-venues-link">
              Add a venue
              <IconArrowRight size={16} aria-hidden />
            </ButtonLink>
          }
          testId="fixtures-needs-ground"
        >
          Once one exists, the round-robin generator opens right here. Grounds belong to the club,
          so one added now is there for every season after this.
        </Notice>
      ) : null}

      {/* The wrapper stays whatever is inside it: it is also the page's
          hydration mark (`data-hydrated`), which the suites wait on. */}
      <div data-testid="stat-row" data-hydrated={hydrated ? "true" : "false"}>
        {empty ? null : (
          <StatGrid>
            <StatCard
              icon={<IconCalendar />}
              concept="fixtures"
              value={stats.total}
              label={isLobby ? "Lobbies" : "Matches"}
              hint={
                stats.rounds > 0
                  ? `${String(stats.rounds)} round${stats.rounds === 1 ? "" : "s"}`
                  : stats.total === 0
                    ? "None scheduled yet"
                    : "No rounds"
              }
              testId="stat-total"
            />
            <StatCard
              icon={<IconCheckCircle />}
              tone="green"
              value={stats.completed}
              label="Played"
              hint={live > 0 ? `of ${String(live)} on the schedule` : "None yet"}
              {...(live > 0 ? { progress: (stats.completed / live) * 100 } : {})}
              testId="stat-completed"
            />
            <StatCard
              icon={<IconClock />}
              concept="season"
              value={upcoming}
              label="To play"
              hint={
                next !== null && next.state === "upcoming" && next.fixture.kickoffAt !== null
                  ? `Next ${formatWallDate(next.fixture.kickoffAt.slice(0, 10))}`
                  : next !== null && next.state === "overdue"
                    ? "Kickoffs have passed"
                    : upcoming > 0
                      ? "Nothing dated ahead"
                      : "Nothing to play"
              }
              testId="stat-upcoming"
            />
            <StatCard
              icon={<IconPin />}
              concept="venue"
              value={stats.venues}
              label={stats.venues === 1 ? "Venue" : "Venues"}
              hint={`${String(stats.grounds)} ${terms.ground.toLowerCase()}${stats.grounds === 1 ? "" : "s"} in use`}
              testId="stat-venues"
            />
          </StatGrid>
        )}
      </div>

      {conflicts.length > 0 ? (
        <SectionCard
          icon={<IconAlert />}
          tone="red"
          title="Conflicts"
          description={`${String(conflicts.length)} clash${conflicts.length === 1 ? "" : "es"} in this season's schedule.${
            conflicts.length > CONFLICTS_SHOWN
              ? ` Showing the first ${String(CONFLICTS_SHOWN)}.`
              : ""
          }`}
          data-testid="conflict-panel"
        >
          {/* Unbounded, this panel ran 3565px of a 6431px page at 240 fixtures. */}
          <ul className="st-rows fx-conflicts">
            {conflicts.slice(0, CONFLICTS_SHOWN).map((entry, index) => (
              <li key={index} data-testid="conflict-item">
                <Pill tone={entry.severity === "blocking" ? "red" : "amber"}>
                  {entry.type.replace(/_/g, " ")}
                </Pill>
                {/* The fixture numbers were always in the payload; now they are
                    on the screen, so "which two?" has an answer. */}
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
        </SectionCard>
      ) : null}

      {/* With no ground the generator cannot run, so it waits behind the
          "Add a ground first" notice instead of a ~500px form with a pale,
          disabled button. */}
      {primary === "generate" && needsGround ? null : primary === "generate" ? (
        <SectionCard
          icon={<IconSpark />}
          title="Generate fixtures"
          description="Every team plays every other team. Home and away are shared out evenly."
          data-testid="generate-panel"
        >
          {generateForm}
          {privateNote}
        </SectionCard>
      ) : toolsCard !== null ? (
        <div className="st-grid">
          <CardGrid weight="wide-left">
            {nextCard}
            {toolsCard}
          </CardGrid>
        </div>
      ) : live > 0 || next !== null ? (
        nextCard
      ) : null}

      {/* 240 fixtures used to be written blind — no count, no date range, no
          confirmation. A league asked to start 1 March silently ended 28 June,
          discoverable only on page 10. */}
      {canManage && !isLobby && primary !== "generate" ? (
        <Dialog
          open={generateOpen}
          onClose={() => {
            setGenerateOpen(false);
          }}
          title="Generate a round robin"
          size="wide"
          footer={
            <Button
              variant="ghost"
              onClick={() => {
                setGenerateOpen(false);
              }}
            >
              Close
            </Button>
          }
        >
          <p className="st-note fx-dialog-lede">
            A round robin is generated over an empty schedule. Discard the drafts, or cancel the
            matches already set, before generating again.
          </p>
          {generateForm}
        </Dialog>
      ) : null}

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
            <div data-testid="generate-preview" className="fx-dialog-body">
              <p>
                <strong>{plan.preview.count}</strong> fixtures across{" "}
                <strong>{plan.preview.rounds}</strong> round
                {plan.preview.rounds === 1 ? "" : "s"}, for {plan.preview.teams} teams.
              </p>
              <p>
                First match {formatWallDate(plan.preview.firstDate)}; last match{" "}
                {formatWallDate(plan.preview.lastDate)}.
              </p>
              <p className="st-note">
                They land as drafts, so nothing is public yet — and you can discard them all in one
                click if the dates are wrong.
              </p>
              <Button
                onClick={() => {
                  setGenerateOpen(false);
                  void generate();
                }}
                loading={busy}
                data-testid="confirm-generate"
              >
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
          <div className="fx-dialog-body">
            <p>
              Every draft fixture is cancelled and its slot released. Scheduled, published and
              played fixtures are untouched. This is how you start a generation over.
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
          </div>
        </Dialog>
      ) : null}

      {canManage ? (
        <Dialog
          open={manualOpen}
          onClose={() => {
            setManualOpen(false);
          }}
          title={isLobby ? "Add a lobby" : "Add a fixture"}
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
            {isLobby ? (
              /* A checklist, not two selects. The squads in a lobby are a set —
                 the same squad cannot enter twice and there is no first or
                 second slot — and a set is chosen by ticking it. */
              <fieldset className="ground-picker" data-testid="squad-picker">
                <legend>Squads in this lobby</legend>
                {teams.length < 2 ? (
                  <p className="competitions-hint">
                    A lobby needs at least two squads.{" "}
                    <Link href={`/seasons/${slug}/teams`}>Add teams</Link>
                  </p>
                ) : (
                  teams.map((team) => (
                    <label key={team.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={manSquads.has(team.id)}
                        onChange={() => {
                          toggleSquad(team.id);
                        }}
                        data-testid={`squad-${team.id}`}
                      />
                      {team.name}
                    </label>
                  ))
                )}
                <p className="competitions-hint" data-testid="squad-count">
                  {manSquads.size} squad{manSquads.size === 1 ? "" : "s"} selected
                </p>
              </fieldset>
            ) : (
              <>
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
              </>
            )}
            <Select
              label={terms.ground}
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
              onClick={() => void (isLobby ? createLobby() : createManual())}
              loading={busy}
              disabled={
                isLobby
                  ? manSquads.size < 2
                  : manHome === "" || manAway === "" || manHome === manAway
              }
              data-testid="add-fixture"
            >
              Add {isLobby ? "lobby" : "fixture"}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {/* The worklist nothing else surfaces: matches that were played and never
          scored. A season quietly accumulates them, and the table's "6 of 20
          results in" is the symptom rather than the place to fix it. */}
      <ResultsCard
        slug={slug}
        fixtures={page.rows}
        results={results}
        scoreFields={scoreFields}
        canManage={canManage}
      />

      <SectionCard
        icon={<IconCalendar />}
        title="Schedule"
        description={
          // Empty and unfiltered, the page head already says so (round 2 counted
          // three "nothing yet" lines on one screen); the card doesn't repeat it.
          page.total === 0
            ? filtered
              ? "No match fits these filters."
              : undefined
            : `${String(page.total)} match${page.total === 1 ? "" : "es"}${filtered ? " match these filters" : ""} · grouped by round`
        }
        flush
        action={
          canManage ? (
            <>
              {/* Nothing to export from an empty schedule. */}
              {empty ? null : (
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="export-csv"
                  onClick={() => void doExport()}
                >
                  <IconDownload size={16} aria-hidden />
                  Export CSV
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                data-testid="open-import"
                onClick={() => {
                  setImportOpen(true);
                }}
              >
                <IconUpload size={16} aria-hidden />
                Import
              </Button>
            </>
          ) : undefined
        }
        data-testid="schedule-card"
      >
        {/* Seven chips reading 0 and a search box over nothing are furniture;
            they arrive with the first match. */}
        {empty ? null : (
          <>
            <ul className="st-chips" aria-label="Filter by status">
              <li>
                <button
                  type="button"
                  className="st-chip"
                  aria-pressed={filters.status === ""}
                  onClick={() => {
                    pushQuery({ status: "", page: "1" });
                  }}
                >
                  All <span className="st-chip-count">{stats.total}</span>
                </button>
              </li>
              {STATUS_CHIPS.filter((chip) => canManage || chip.managerOnly !== true).map((chip) => (
                <li key={chip.status}>
                  <button
                    type="button"
                    className="st-chip"
                    aria-pressed={filters.status === chip.status}
                    onClick={() => {
                      pushQuery({
                        status: filters.status === chip.status ? "" : chip.status,
                        page: "1",
                      });
                    }}
                    data-testid={chip.testId}
                  >
                    {chip.label} <span className="st-chip-count">{stats[chip.key]}</span>
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="st-toolbar"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                pushQuery({ q: search, page: "1" });
              }}
            >
              <label className="st-search">
                <IconSearch size={18} aria-hidden />
                <span className="st-sr">Search by fixture number</span>
                <input
                  name="q"
                  type="search"
                  placeholder="Fixture number"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                />
                <button type="submit" data-testid="search-submit">
                  Search
                </button>
              </label>
              <select
                className="st-select"
                aria-label="Team"
                name="team"
                value={filters.team}
                data-active={filters.team !== "" ? "true" : undefined}
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
              </select>
              {grounds.length > 0 ? (
                <select
                  className="st-select"
                  aria-label={terms.ground}
                  name="ground"
                  value={filters.ground}
                  data-active={filters.ground !== "" ? "true" : undefined}
                  onChange={(event) => {
                    pushQuery({ ground: event.target.value, page: "1" });
                  }}
                >
                  <option value="">All {terms.ground.toLowerCase()}s</option>
                  {grounds.map((ground) => (
                    <option key={ground.id} value={ground.id}>
                      {ground.venueName} · {ground.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <select
                className="st-select"
                aria-label="Sort"
                name="sort"
                value={filters.sort}
                onChange={(event) => {
                  pushQuery({ sort: event.target.value, page: "1" });
                }}
              >
                {SORTS.map((sort) => (
                  <option key={sort.value} value={sort.value}>
                    {sort.label}
                  </option>
                ))}
              </select>
            </form>
          </>
        )}
        <div className="st-table-wrap">
          <table className="st-table fx-table" data-stack="" data-testid="fixtures-table">
            <caption>
              This season&apos;s fixtures, grouped by round — {page.total} match
              {page.total === 1 ? "" : "es"} matching the current filters.
            </caption>
            {/* An empty schedule draws no column heads over its one sentence. */}
            {page.total === 0 ? null : (
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Fixture</th>
                  <th scope="col">Kickoff</th>
                  <th scope="col">{terms.ground}</th>
                  <th scope="col">Status</th>
                  <th scope="col">Result</th>
                  {canManage ? (
                    <th scope="col">
                      <VisuallyHidden>Actions</VisuallyHidden>
                    </th>
                  ) : null}
                </tr>
              </thead>
            )}
            <tbody>
              {rounds.map(({ round, rows, when }) => (
                <Fragment key={String(round)}>
                  <tr data-group="">
                    <th scope="rowgroup" colSpan={canManage ? 7 : 6}>
                      {round !== null ? `Round ${String(round)}` : "Unscheduled"}
                      {when !== null ? <span className="st-group-when">{when}</span> : null}
                    </th>
                  </tr>
                  {rows.map((fixture) => (
                    <FixtureRow
                      key={fixture.id}
                      fixture={fixture}
                      result={results[fixture.id]}
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
                  <td colSpan={canManage ? 7 : 6} data-span="full" className="fx-none">
                    {/* Same DA-35 rule the registration desk follows: blaming
                        filters nobody applied is a dead end — a season with no
                        fixtures yet gets its actual next step instead. */}
                    {filtered
                      ? "No fixtures match these filters."
                      : canManage
                        ? isLobby
                          ? "No lobbies yet — add the first one with “Add lobby”."
                          : "Generated and hand-added matches land here, grouped by round."
                        : "No fixtures yet. The organizer hasn't scheduled any matches."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* No pager for one page (it was "Page 1 of 1 · 0 total"). */}
        {totalPages <= 1 ? null : (
          <div className="st-pager">
            <span data-testid="page-indicator">
              Page {page.page} of {totalPages} · {page.total} total
            </span>
            <span className="st-actions fx-pager-actions">
              <Button
                size="sm"
                variant="secondary"
                disabled={page.page <= 1}
                onClick={() => {
                  pushQuery({ page: String(page.page - 1) });
                }}
                data-testid="page-prev"
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page.page >= totalPages}
                onClick={() => {
                  pushQuery({ page: String(page.page + 1) });
                }}
                data-testid="page-next"
              >
                Next
              </Button>
            </span>
          </div>
        )}
      </SectionCard>

      {expanded !== null ? (
        <SectionCard
          icon={<IconClock />}
          tone="neutral"
          title="Fixture timeline"
          description="Every change to this match, oldest first."
          data-testid="fixture-timeline"
        >
          <ol className="st-rows fx-timeline">
            {timeline.map((entry, index) => (
              <li key={index}>
                <Pill tone="neutral">{entry.action.replace("fixture.", "")}</Pill>
                <span className="st-note">{formatDateTime(entry.at)}</span>
                {isMove(entry.meta) ? (
                  <span className="st-note">
                    {entry.meta.fromKickoff} → {entry.meta.toKickoff}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </SectionCard>
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

/** One side of the next match: its crest and its name. */
function Side({
  id,
  name,
  short,
  color,
  teamById,
}: {
  id: string | null;
  name: string | null;
  short: string | null;
  color: string | null;
  teamById: ReadonlyMap<string, FixtureDashboard["teams"][number]>;
}) {
  const team = id !== null ? teamById.get(id) : undefined;
  const label = name ?? "To be decided";
  return (
    <span className="fx-side">
      <TeamCrest
        name={label}
        short={short}
        color={color}
        logoUrl={team?.logoUrl ?? null}
        size="xl"
      />
      <span className="fx-side-name">{label}</span>
    </span>
  );
}

function NextMatch({
  fixture,
  teamById,
  ground,
  result,
}: {
  fixture: Snapshot;
  teamById: ReadonlyMap<string, FixtureDashboard["teams"][number]>;
  ground: string;
  /** A played match shows its score where the "vs" would be. */
  result?: FixtureDashboard["results"][string] | undefined;
}) {
  const lobby = fixture.homeTeamId === null;
  return (
    <div className="fx-next">
      {lobby ? (
        <div className="fx-faceoff" data-lobby="true">
          <span className="fx-lobby-count">
            <strong>{fixture.squadCount}</strong> squads in this lobby
          </span>
        </div>
      ) : (
        <div className="fx-faceoff">
          <Side
            id={fixture.homeTeamId}
            name={fixture.homeTeamName}
            short={fixture.homeTeamShort}
            color={fixture.homeTeamColor}
            teamById={teamById}
          />
          {result !== undefined ? (
            <span className="fx-final">
              <strong>
                {scoreOf(result.score?.home)} – {scoreOf(result.score?.away)}
              </strong>
              <span>{sentence(result.outcome)}</span>
            </span>
          ) : (
            <>
              <span className="fx-vs-big" aria-hidden>
                vs
              </span>
              <span className="st-sr"> versus </span>
            </>
          )}
          <Side
            id={fixture.awayTeamId}
            name={fixture.awayTeamName}
            short={fixture.awayTeamShort}
            color={fixture.awayTeamColor}
            teamById={teamById}
          />
        </div>
      )}
      <ul className="fx-next-facts">
        <li>
          <IconCalendar size={16} aria-hidden />
          {fixture.kickoffAt !== null
            ? formatWallDate(fixture.kickoffAt.slice(0, 10))
            : "Date to be set"}
        </li>
        {fixture.kickoffAt !== null ? (
          <li>
            <IconClock size={16} aria-hidden />
            {formatWallTime(fixture.kickoffAt)}
          </li>
        ) : null}
        <li>
          <IconPin size={16} aria-hidden />
          <span className="st-sr">{ground}: </span>
          {fixture.groundName !== null
            ? `${fixture.groundName}${fixture.venueName !== null ? ` · ${fixture.venueName}` : ""}`
            : `${ground} to be set`}
        </li>
      </ul>
    </div>
  );
}

/**
 * The scoreline in one line — the PRIMARY component only (runs, goals), the
 * way a result reads when somebody asks who won. An em dash for a component
 * that was never recorded, because zero is a real score.
 */
function scoreOf(side: Record<string, number> | undefined): string {
  const first = side === undefined ? undefined : Object.values(side)[0];
  return first === undefined ? "—" : String(first);
}

/** "home_win" → "Home win". */
function sentence(outcome: string): string {
  const words = outcome.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
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
  result,
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
  result: FixtureDashboard["results"][string] | undefined;
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
  const terms = useSportTerms();
  const next = NEXT_ACTION[fixture.status];
  const movable = fixture.status === "scheduled" || fixture.status === "published";
  const cancellable = fixture.status !== "completed" && fixture.status !== "cancelled";
  const lobby = fixture.homeTeamId === null;
  return (
    <>
      {/* On a phone the table stacks and every cell names itself from its
          `data-label` — without them this read as a number, two team names, a
          time, a place and a word, with nothing saying which was which. */}
      <tr data-testid={`fixture-${fixture.number}`} data-status={fixture.status}>
        <td data-label="" className="st-mono fx-num">
          {fixture.number}
        </td>
        <td data-label="" data-span="full">
          {/* A LOBBY has no home and no away, so it cannot be read as "A vs B".
              It is named by its size — the thing an organizer actually checks
              on a battle royale schedule is whether the right number of squads
              is in it — and by how far the scoring has got, because a lobby
              writes no result row and this is the only place that shows. */}
          {lobby ? (
            <span className="fx-teams" data-testid={`lobby-${fixture.number}`}>
              <TeamChip color={null}>{fixture.squadCount} squads</TeamChip>
            </span>
          ) : (
            <span className="fx-teams">
              <TeamChip color={fixture.homeTeamColor}>
                {fixture.homeTeamShort ?? fixture.homeTeamName}
              </TeamChip>
              <span className="fx-vs">vs</span>
              <TeamChip color={fixture.awayTeamColor}>
                {fixture.awayTeamShort ?? fixture.awayTeamName}
              </TeamChip>
            </span>
          )}
        </td>
        <td data-label="Kickoff" className="fx-when">
          {fixture.kickoffAt !== null ? formatKickoff(fixture.kickoffAt) : "—"}
        </td>
        <td data-label={terms.ground}>
          <span className="fx-place">
            {fixture.groundName ?? "—"}
            {fixture.venueName !== null ? (
              <span className="st-sub">{fixture.venueName}</span>
            ) : null}
          </span>
        </td>
        <td data-label="Status">
          <FixtureStatusPill status={fixture.status} />
        </td>
        <td data-label="Result" className="fx-result">
          {lobby ? (
            fixture.placedCount > 0 ? (
              <span className="st-note">
                {fixture.placedCount === fixture.squadCount
                  ? "all placed"
                  : `${String(fixture.placedCount)} of ${String(fixture.squadCount)} placed`}
              </span>
            ) : (
              <span className="st-muted">—</span>
            )
          ) : result !== undefined ? (
            <span className="fx-score">
              <strong>
                {scoreOf(result.score?.home)} – {scoreOf(result.score?.away)}
              </strong>
              <span className="st-sub">{sentence(result.outcome)}</span>
            </span>
          ) : (
            <span className="st-muted">—</span>
          )}
        </td>
        {canManage ? (
          <td data-label="" data-span="full">
            <div className="st-row-actions">
              {next !== undefined ? (
                <Button
                  size="sm"
                  variant="secondary"
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
              <PopoverMenu
                label={`More for ${fixture.number}`}
                trigger={<IconKebab width={18} height={18} />}
                triggerClassName="st-kebab"
                items={[
                  { key: "details", label: "History", onSelect: onDetails },
                  ...(cancellable
                    ? [
                        {
                          key: "cancel",
                          label: "Cancel match",
                          danger: true,
                          onSelect: () => {
                            if (!busy) onLifecycle("cancel");
                          },
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </td>
        ) : null}
      </tr>
      {moving ? (
        <tr data-testid={`move-row-${fixture.number}`} className="fx-move-row">
          <td colSpan={canManage ? 7 : 6} data-span="full">
            <div className="fx-move">
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
