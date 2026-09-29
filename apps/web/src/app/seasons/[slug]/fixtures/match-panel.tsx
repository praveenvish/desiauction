"use client";

import {
  Button,
  Field,
  IconCalendar,
  IconCheck,
  IconClock,
  IconClose,
  IconKebab,
  IconPin,
  Pill,
  PopoverMenu,
  Select,
  useToast,
} from "@desiauction/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { useSportTerms } from "../../../../components/sport-terms";
import { formatDateTime, formatWallDate, formatWallTime } from "../../../../lib/format-date";
import {
  fixtureLifecycleAction,
  fixtureTimelineAction,
  rescheduleFixtureAction,
  type ScheduleView,
} from "../../../../server/competition/fixture-actions";
import type { FixtureTimelineEntry } from "../../../../server/competition/fixtures";
import { FixtureStatusPill, awaitsResult } from "../_tabs/fixture-status";
import { TeamCrest } from "../_tabs/team-crest";
import { LineupSideEditor } from "../lineups/lineup-side-editor";
import { DuelResultForm, LobbyResultForm, type NextOwed } from "./result-form";
import { isLobby, primaryScore, resultSentence, type ModelResult } from "./schedule-model";

/**
 * ONE MATCH, OPEN — the side panel on a laptop, a bottom sheet on a phone.
 *
 * Everything that happens to a single match lives here: its next step, its two
 * lineups, its score (and finishing it, in the same click), moving it, its
 * history and cancelling it. The page renders the panel for the `?match=` in
 * the address and for nothing else, so each control exists once on the page.
 *
 * The frame is the notifications panel's: an <aside> beside the list, or —
 * under 1100px — a native modal <dialog> (focus trap, Escape, backdrop). The
 * server renders the aside; a phone upgrades to the dialog after hydration.
 * Closing is navigation, like opening, so Back works.
 */

const PHONE = "(max-width: 1099px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

function MatchSheet({
  id,
  title,
  eyebrow,
  closeHref,
  children,
}: {
  id: string;
  title: string;
  eyebrow: ReactNode;
  closeHref: string;
  children: ReactNode;
}) {
  const phone = usePhone();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = useRef<string | null>(null);
  const titleId = `mx-panel-title-${id}`;

  useEffect(() => {
    const node = dialogRef.current;
    if (phone && node !== null && !node.open) {
      node.showModal();
    }
  }, [phone]);

  // Another match chosen from the list: the reader lands on its name. The
  // first render is left alone — a shared link should not steal the focus.
  useEffect(() => {
    if (shown.current !== null && shown.current !== id) {
      headingRef.current?.focus({ preventScroll: phone });
    }
    shown.current = id;
  }, [id, phone]);

  const close = () => {
    router.push(closeHref, { scroll: false });
  };

  const body = (
    <>
      {phone ? <span className="mx-sheet-grip" aria-hidden /> : null}
      <header className="mx-panel-head">
        <div className="mx-panel-titles">
          <span className="mx-eyebrow">{eyebrow}</span>
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="mx-panel-title">
            {title}
          </h2>
        </div>
        <Link
          href={closeHref}
          scroll={false}
          className="mx-panel-close"
          aria-label={`Close ${title}`}
          data-testid="match-panel-close"
        >
          <IconClose size={20} />
        </Link>
      </header>
      {children}
    </>
  );

  if (phone) {
    return (
      // A modal <dialog> closes on Escape natively (→ onClose); the click
      // handler only catches the backdrop.
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
      <dialog
        ref={dialogRef}
        className="mx-panel mx-sheet"
        aria-labelledby={titleId}
        data-testid="match-panel"
        onClose={close}
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
      >
        {body}
      </dialog>
    );
  }
  return (
    <aside className="mx-panel" aria-labelledby={titleId} data-testid="match-panel">
      {body}
    </aside>
  );
}

type Selected = NonNullable<ScheduleView["selected"]>;
type Grounds = NonNullable<ScheduleView["grounds"]>;

const NEXT_STEP = {
  draft: { action: "schedule", label: "Schedule this match" },
  scheduled: { action: "publish", label: "Publish this match" },
  published: { action: "start", label: "Start the match" },
} as const;

export function MatchPanel({
  slug,
  selected,
  result,
  scoreFields,
  grounds,
  canManage,
  closeHref,
  nextOwed = null,
  today,
}: {
  slug: string;
  selected: Selected;
  result: ModelResult | undefined;
  scoreFields: ScheduleView["scoreFields"];
  grounds: Grounds;
  canManage: boolean;
  closeHref: string;
  /** The next match owed a result — opened after this one's result is saved. */
  nextOwed?: NextOwed | null;
  today: string;
}) {
  const terms = useSportTerms();
  const router = useRouter();
  const toast = useToast();
  const { fixture, sides, announce } = selected;
  const lobby = isLobby(fixture);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveKickoff, setMoveKickoff] = useState(fixture.kickoffAt ?? "");
  const [moveGround, setMoveGround] = useState(fixture.groundId ?? "");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [history, setHistory] = useState<FixtureTimelineEntry[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const title = lobby
    ? `Lobby · ${String(fixture.squadCount)} squads`
    : `${fixture.homeTeamName ?? "TBA"} v ${fixture.awayTeamName ?? "TBA"}`;
  const baseStep = canManage ? NEXT_STEP[fixture.status as keyof typeof NEXT_STEP] : undefined;
  // Its day has passed and nobody started it: what is owed is the score, and
  // starting is how the score form opens.
  const step =
    baseStep !== undefined && baseStep.action === "start" && awaitsResult(fixture, today)
      ? { action: "start" as const, label: "Enter the score" }
      : baseStep;
  const movable = fixture.status === "scheduled" || fixture.status === "published";
  const cancellable = fixture.status !== "completed" && fixture.status !== "cancelled";
  const played = fixture.status === "in_progress" || fixture.status === "completed";

  const lifecycle = async (action: "schedule" | "publish" | "start" | "complete" | "cancel") => {
    setBusy(true);
    const outcome = await fixtureLifecycleAction(slug, fixture.id, action);
    setBusy(false);
    if (!outcome.ok) {
      toast({ tone: "danger", title: outcome.error ?? "That didn't work." });
      return;
    }
    setConfirmCancel(false);
    router.refresh();
  };

  const move = async () => {
    setBusy(true);
    const outcome = await rescheduleFixtureAction(slug, fixture.id, {
      ...(moveKickoff !== "" ? { kickoffAt: moveKickoff } : {}),
      ...(moveGround !== "" ? { groundId: moveGround } : {}),
    });
    setBusy(false);
    if (!outcome.ok) {
      toast({ tone: "danger", title: outcome.error ?? "That didn't work." });
      return;
    }
    toast({ tone: "success", title: "Match moved" });
    setMoving(false);
    router.refresh();
  };

  const openHistory = async () => {
    setHistory(await fixtureTimelineAction(slug, fixture.id));
  };

  const where =
    fixture.groundName !== null
      ? `${fixture.groundName}${fixture.venueName !== null ? ` · ${fixture.venueName}` : ""}`
      : `${terms.ground} to be set`;

  /* LINEUPS — who took the field. A lobby's squads are its lineup. The
     organizer gets both sides; a team's owner gets their own side only (the
     server sends nothing else) and picks it here (founder, 2026-09-29). */
  const lineupsSection =
    !lobby && sides !== undefined && sides.length > 0 ? (
      <section className="mx-section" aria-labelledby={`lineups-${fixture.id}`}>
        <h3 className="mx-label" id={`lineups-${fixture.id}`}>
          {canManage ? "Lineups" : "Your lineup"}
        </h3>
        <ul className="mx-lineups">
          {sides.map((side) => {
            const named = side.players.filter((player) => player.played).length;
            const open = editing === side.teamId;
            return (
              <li key={side.teamId} data-testid={`lineup-side-${side.teamId}`}>
                <div className="mx-lineup-row">
                  <TeamCrest name={side.teamName} color={side.teamColor} />
                  <span className="mx-lineup-name">{side.teamName}</span>
                  <span className="mx-lineup-state" data-set={side.recorded ? "true" : undefined}>
                    {side.recorded ? (
                      <>
                        <IconCheck size={14} aria-hidden />
                        {named} named
                      </>
                    ) : (
                      "Not set"
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant={open ? "ghost" : "secondary"}
                    aria-expanded={open}
                    onClick={() => {
                      setEditing(open ? null : side.teamId);
                    }}
                    data-testid={`edit-lineup-${side.teamId}`}
                  >
                    {open ? "Done" : side.recorded ? "Edit" : "Set"}
                  </Button>
                </div>
                {open ? (
                  <div className="mx-lineup-editor">
                    <LineupSideEditor
                      slug={slug}
                      fixtureId={fixture.id}
                      side={side}
                      announce={announce?.[side.teamId]}
                      onSaved={() => {
                        router.refresh();
                      }}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    ) : null;

  return (
    <MatchSheet
      id={fixture.id}
      title={title}
      closeHref={closeHref}
      eyebrow={
        <>
          <FixtureStatusPill status={fixture.status} overdue={awaitsResult(fixture, today)} />
          <span className="st-mono">{fixture.number}</span>
        </>
      }
    >
      <ul className="mx-facts">
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
          <span className="st-sr">{terms.ground}: </span>
          {where}
        </li>
      </ul>

      {/* The result, read-only, for whoever cannot record it. */}
      {!canManage && result !== undefined && !lobby ? (
        <section className="mx-section" aria-label="Result">
          <p className="mx-final">
            <strong className="st-num">
              {primaryScore(result.score?.home)} – {primaryScore(result.score?.away)}
            </strong>
            <span>
              {resultSentence(result.outcome, fixture.homeTeamName, fixture.awayTeamName)}
            </span>
          </p>
        </section>
      ) : null}

      {fixture.status === "cancelled" ? (
        <section className="mx-section">
          <p className="st-note">
            This match was cancelled
            {fixture.cancelReason !== null ? ` — ${fixture.cancelReason}` : ""}.
          </p>
        </section>
      ) : null}

      {canManage ? null : lineupsSection}

      {canManage ? (
        <>
          {step !== undefined ? (
            <section className="mx-section mx-step">
              <Button
                size="touch"
                loading={busy}
                onClick={() => void lifecycle(step.action)}
                data-testid={`panel-${step.action}`}
              >
                {step.label}
              </Button>
              {fixture.status === "draft" ? (
                <p className="st-note">
                  A draft is yours alone until it is scheduled and published.
                </p>
              ) : fixture.status === "scheduled" ? (
                <p className="st-note">Scheduled matches are not public until published.</p>
              ) : null}
            </section>
          ) : null}

          {lineupsSection}

          {/* THE SCORE — only once the match is under way. */}
          {played ? (
            <section className="mx-section" aria-labelledby={`result-${fixture.id}`}>
              <h3 className="mx-label" id={`result-${fixture.id}`}>
                {lobby ? "Placings" : "Result"}
              </h3>
              {lobby ? (
                <LobbyResultForm
                  key={`${fixture.id}:${fixture.status}`}
                  slug={slug}
                  fixture={fixture}
                  scoreFields={scoreFields}
                  next={nextOwed}
                />
              ) : (
                <DuelResultForm
                  key={`${fixture.id}:${fixture.status}:${result?.outcome ?? ""}`}
                  slug={slug}
                  fixture={fixture}
                  result={result}
                  scoreFields={scoreFields}
                  next={nextOwed}
                />
              )}
            </section>
          ) : null}

          {moving ? (
            <section className="mx-section" data-testid={`move-row-${fixture.number}`}>
              <h3 className="mx-label">Move this match</h3>
              <div className="mx-move">
                <Field
                  label="New kickoff"
                  name="moveKickoff"
                  type="datetime-local"
                  value={moveKickoff}
                  onChange={(event) => {
                    setMoveKickoff(event.target.value);
                  }}
                />
                <Select
                  label="New ground"
                  name="moveGround"
                  value={moveGround}
                  onChange={(event) => {
                    setMoveGround(event.target.value);
                  }}
                >
                  <option value="">Keep the current ground</option>
                  {grounds.map((ground) => (
                    <option key={ground.id} value={ground.id}>
                      {ground.venueName} · {ground.name}
                    </option>
                  ))}
                </Select>
                <div className="mx-inline-go">
                  <Button
                    size="sm"
                    onClick={() => void move()}
                    loading={busy}
                    data-testid={`confirm-move-${fixture.number}`}
                  >
                    Confirm move
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setMoving(false);
                    }}
                  >
                    Keep it
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          {confirmCancel ? (
            <section className="mx-section mx-danger" role="alert">
              <p>
                <strong>Cancel this match?</strong> Everyone following the schedule sees it as off.
                It cannot be restarted — add a new match to replay it.
              </p>
              <div className="mx-inline-go">
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy}
                  onClick={() => void lifecycle("cancel")}
                  data-testid="confirm-cancel-match"
                >
                  Cancel match
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setConfirmCancel(false);
                  }}
                >
                  Keep it
                </Button>
              </div>
            </section>
          ) : null}

          {history !== null ? (
            <section className="mx-section" data-testid="fixture-timeline">
              <h3 className="mx-label">History</h3>
              <ol className="mx-history">
                {history.map((entry, index) => (
                  <li key={index}>
                    <Pill tone="neutral">{entry.action.replace("fixture.", "")}</Pill>
                    <span className="st-note">{formatDateTime(entry.at)}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <footer className="mx-panel-foot">
            {movable ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setMoving(true);
                }}
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
                {
                  key: "history",
                  label: "History",
                  onSelect: () => void openHistory(),
                  testId: `history-${fixture.number}`,
                },
                ...(fixture.status === "in_progress"
                  ? [
                      {
                        key: "complete",
                        label: "Finish without a result",
                        onSelect: () => void lifecycle("complete"),
                        testId: `complete-${fixture.number}`,
                      },
                    ]
                  : []),
                ...(cancellable
                  ? [
                      {
                        key: "cancel",
                        label: "Cancel match",
                        danger: true,
                        onSelect: () => {
                          setConfirmCancel(true);
                        },
                        testId: `cancel-${fixture.number}`,
                      },
                    ]
                  : []),
              ]}
            />
          </footer>
        </>
      ) : null}
    </MatchSheet>
  );
}
