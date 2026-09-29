"use client";

import { FIXTURE_CSV_HEADER, dailyKickoffs, planRoundRobin } from "@desiauction/core";
import { Button, Dialog, Field, IconAlert, IconSpark, Select, useToast } from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { useSportTerms } from "../../../../components/sport-terms";
import { formatWallDate } from "../../../../lib/format-date";
import {
  createFixtureAction,
  createLobbyAction,
  discardDraftsAction,
  fixtureImportCommitAction,
  fixtureImportPreviewAction,
  generateFixturesAction,
  previewGenerationAction,
  type BulkFixtureResult,
  type FixtureImportPreview,
  type ScheduleView,
} from "../../../../server/competition/fixture-actions";
import { release } from "../../../../lib/release";

/**
 * THE PLAN TOOLS — everything that makes or unmakes many matches at once:
 * the round-robin generator, a match by hand, a CSV import and discarding the
 * drafts. They live behind the Matches screen's "Plan" menu (the generator
 * sits inline while the schedule is empty), so the screen itself is about the
 * matches, not the machinery.
 */

type GeneratePreview = Awaited<ReturnType<typeof previewGenerationAction>>;
type Teams = ScheduleView["teams"];
type Grounds = NonNullable<ScheduleView["grounds"]>;

/** Run an action; toast what happened; refresh on success. */
function useAct() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const act = async <T extends { ok: boolean; error?: string }>(
    fn: () => Promise<T>,
    done?: string | ((result: T) => { title: string; tone: "success" | "info" | "danger" }),
  ): Promise<T> => {
    setBusy(true);
    const result = await release(fn(), () => {
      setBusy(false);
    });
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
  return { act, busy };
}

/** "3 of 240 scheduled, 237 skipped" — what actually happened, every time. */
export const bulkOutcome =
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

/* ---- The round-robin generator ------------------------------------------ */

export function GenerateForm({
  slug,
  orgSlug,
  teams,
  grounds,
  seasonStartsOn,
  seasonEndsOn,
  primary,
  onGenerated,
}: {
  slug: string;
  orgSlug: string;
  teams: Teams;
  grounds: Grounds;
  seasonStartsOn: string | null;
  seasonEndsOn: string | null;
  /** The page's one primary action while the schedule is empty. */
  primary: boolean;
  onGenerated?: () => void;
}) {
  const terms = useSportTerms();
  const { act, busy } = useAct();
  const toast = useToast();
  const [plan, setPlan] = useState<Extract<GeneratePreview, { ok: true }> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [genRounds, setGenRounds] = useState("1");
  // Starts on the season's first day: an empty date disabled "Generate" with
  // nothing on screen saying why.
  const [genStart, setGenStart] = useState(seasonStartsOn ?? "");
  const [genTimes, setGenTimes] = useState("18:00");
  const [genDuration, setGenDuration] = useState("180");
  // HOW MANY MATCHES A DAY. "fit" works the kickoffs out from the playing day;
  // "custom" takes typed times. Either way the planner packs each day.
  const [genMode, setGenMode] = useState<"fit" | "custom">("fit");
  const [genFirst, setGenFirst] = useState("09:00");
  const [genLastEnd, setGenLastEnd] = useState("21:00");
  const [genBreak, setGenBreak] = useState("15");
  const [genPerTeam, setGenPerTeam] = useState("1");
  // One ground is the only answer, so it starts ticked.
  const [genGrounds, setGenGrounds] = useState<Set<string>>(
    () => new Set(grounds.length === 1 && grounds[0] !== undefined ? [grounds[0].id] : []),
  );

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
    if (genStart === "" || genGrounds.size === 0 || kickoffTimes.length === 0) {
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
    setPreviewing(true);
    const result = await release(previewGenerationAction(slug, generateInput()), () => {
      setPreviewing(false);
    });
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
        onGenerated?.();
        return {
          title: `${String(result.created ?? 0)} fixtures generated as drafts.`,
          tone: "success" as const,
        };
      },
    );

  const blocked =
    teams.length < 2 || grounds.length === 0 ? (
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

  return (
    <div className="fx-generate">
      {blocked}
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
          <>
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
            {/* Why a second ground can sit empty: the generator fills each
                day's slots in order, so with few teams and one match per team
                a day every match fits on the first ground. */}
            {genGrounds.size > 1 ? (
              <p className="st-note">
                Matches go to the first free {terms.ground.toLowerCase()} at each kickoff time. With
                one match per team a day, a small league can fit on one — allow more matches per
                team per day to use both.
              </p>
            ) : null}
          </>
        )}
      </fieldset>
      <div className="fx-generate-go">
        <Button
          variant={primary ? "primary" : "secondary"}
          onClick={() => void askToGenerate()}
          loading={previewing}
          disabled={genStart === "" || genGrounds.size === 0 || kickoffTimes.length === 0}
          aria-describedby="generate-why"
          data-testid="generate-fixtures"
        >
          <IconSpark size={16} aria-hidden />
          Generate
        </Button>
        {/* A disabled button always says why. */}
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
      {/* 240 fixtures used to be written blind — no count, no date range, no
          confirmation. A league asked to start 1 March silently ended 28 June. */}
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
            <Button onClick={() => void generate()} loading={busy} data-testid="confirm-generate">
              Generate {plan.preview.count} fixtures
            </Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

/* ---- The dialogs behind "Plan" and "Add match" -------------------------- */

export type PlanDialog = "generate" | "add" | "import" | "discard" | null;

export function PlanDialogs({
  open,
  onClose,
  slug,
  orgSlug,
  teams,
  grounds,
  isLobby,
  drafts,
  canGenerate,
  seasonStartsOn,
  seasonEndsOn,
}: {
  /**
   * While the schedule is empty the generator sits inline on the page; a
   * second copy in a closed dialog would put every one of its labels on the
   * page twice (a closed <dialog> keeps its contents in the DOM).
   */
  canGenerate: boolean;
  open: PlanDialog;
  onClose: () => void;
  slug: string;
  orgSlug: string;
  teams: Teams;
  grounds: Grounds;
  isLobby: boolean;
  drafts: number;
  seasonStartsOn: string | null;
  seasonEndsOn: string | null;
}) {
  const terms = useSportTerms();
  const { act, busy } = useAct();
  const [preview, setPreview] = useState<FixtureImportPreview | null>(null);
  const csvRef = useRef<HTMLTextAreaElement>(null);
  const [manHome, setManHome] = useState("");
  const [manAway, setManAway] = useState("");
  const [manGround, setManGround] = useState("");
  const [manKickoff, setManKickoff] = useState("");
  const [manSquads, setManSquads] = useState<ReadonlySet<string>>(new Set<string>());

  const createManual = () =>
    act(async () => {
      const result = await createFixtureAction(slug, {
        homeTeamId: manHome,
        awayTeamId: manAway,
        ...(manGround !== "" ? { groundId: manGround } : {}),
        ...(manKickoff !== "" ? { kickoffAt: manKickoff } : {}),
        durationMinutes: 180,
      });
      if (result.ok) {
        setManHome("");
        setManAway("");
        setManGround("");
        setManKickoff("");
        onClose();
      }
      return result;
    }, "Fixture created");

  const createLobby = () =>
    act(async () => {
      const result = await createLobbyAction(slug, {
        teamIds: [...manSquads],
        ...(manGround !== "" ? { groundId: manGround } : {}),
        ...(manKickoff !== "" ? { kickoffAt: manKickoff } : {}),
        durationMinutes: 180,
      });
      if (result.ok) {
        setManSquads(new Set<string>());
        setManGround("");
        setManKickoff("");
        onClose();
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
        onClose();
      }
      return result;
    }, "Fixtures imported");

  const closeButton = (label: string) => (
    <Button variant="ghost" onClick={onClose}>
      {label}
    </Button>
  );

  return (
    <>
      {isLobby || !canGenerate ? null : (
        <Dialog
          open={open === "generate"}
          onClose={onClose}
          title="Generate a round robin"
          size="wide"
          footer={closeButton("Close")}
        >
          <p className="st-note fx-dialog-lede">
            A round robin is generated over an empty schedule. Discard the drafts, or cancel the
            matches already set, before generating again.
          </p>
          <GenerateForm
            slug={slug}
            orgSlug={orgSlug}
            teams={teams}
            grounds={grounds}
            seasonStartsOn={seasonStartsOn}
            seasonEndsOn={seasonEndsOn}
            primary={false}
            onGenerated={onClose}
          />
        </Dialog>
      )}

      <Dialog
        open={open === "discard"}
        onClose={onClose}
        title={`Discard ${String(drafts)} drafts?`}
        footer={closeButton("Keep them")}
      >
        <div className="fx-dialog-body">
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
                    onClose();
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

      <Dialog
        open={open === "add"}
        onClose={onClose}
        title={isLobby ? "Add a lobby" : "Add a match"}
        size="wide"
        footer={closeButton("Cancel")}
      >
        <div className="fixtures-manual-form" data-testid="manual-panel">
          {isLobby ? (
            /* A checklist, not two selects: the squads in a lobby are a set. */
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
              isLobby ? manSquads.size < 2 : manHome === "" || manAway === "" || manHome === manAway
            }
            data-testid="add-fixture"
          >
            Add {isLobby ? "lobby" : "match"}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={open === "import"}
        onClose={onClose}
        title="Import fixtures"
        size="wide"
        footer={closeButton("Close")}
      >
        <div className="io-panel" data-testid="io-panel">
          <label className="io-file" htmlFor="fixture-csv-input">
            <span>Paste a CSV — columns: {FIXTURE_CSV_HEADER}</span>
          </label>
          {/* A preview describes the text it was run against; editing clears it. */}
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
    </>
  );
}
