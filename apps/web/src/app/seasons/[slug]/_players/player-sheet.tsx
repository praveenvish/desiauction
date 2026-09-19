"use client";

import { FEE_STATUSES, formatPaiseINR, paise } from "@desiauction/core";
import {
  Badge,
  Button,
  IconAlert,
  useToast,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  PlayerImage,
} from "@desiauction/ui";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { formatDateTime } from "../../../../lib/format-date";
import { personContact } from "../../../../lib/person-label";
import { isPreSigned, PRE_SIGNED_LABEL, preSignedKind } from "../../../../lib/pre-signed";
import {
  addNoteAction,
  markRegistrationAction,
  personHistoryAction,
  registrationTimelineAction,
  triageRegistrationAction,
  updateRegistrationDetailsAction,
  type TriageAction,
} from "../../../../server/competition/actions";
import type { PlayerDeskContext } from "../../../../server/competition/player-desk";
import type { RegistrationEditInput } from "../../../../server/competition/registration-edit";
import type { TimelineEntry } from "../../../../server/competition/registrations";
import { PlayerPhotoUploader } from "../registrations/player-photo-uploader";
import { SegmentSetting, SelectSetting, TextSetting } from "./fields";
import {
  canRestore,
  canTriage,
  EDITED_FIELD_LABEL,
  FEE_LABEL,
  PAST_TENSE,
  REASON_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  TIMELINE_VERB,
  type Row,
} from "./labels";
import type { Mutate } from "./use-mutate";

export type SheetTab = "details" | "squad" | "fee" | "activity";

const TABS: readonly { id: SheetTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "squad", label: "Squad" },
  { id: "fee", label: "Fee" },
  { id: "activity", label: "Activity" },
];

export interface PlayerSheetProps {
  slug: string;
  row: Row;
  desk: PlayerDeskContext;
  teams: readonly { id: string; name: string }[];
  mutate: Mutate;
  onClose: () => void;
  categoryFlagged?: boolean;
  /** "3 of 25" and the arrows — absent when the sheet has no list behind it. */
  position?: { index: number; total: number };
  onPrev?: () => void;
  onNext?: () => void;
  /** The decline dialog lives with the page (one dialog, two doors). */
  onDecline?: (row: Row) => void;
  /** A decision landed — the review flow moves to the next player. */
  onDecided?: (row: Row, action: TriageAction) => void;
  /** Where to open. Omitted: the tab the player's status makes most useful. */
  initialTab?: SheetTab;
  /** Review mode: a decision moves straight on to the next player waiting. */
  reviewing?: boolean;
  /** Outside review mode, the way into it — "Next to review: Rahul →". */
  nextToReview?: { name: string; left: number; go: () => void } | undefined;
}

/**
 * THE PLAYER SHEET — everything about one registration, where you clicked.
 *
 * It replaces a "Details" panel that rendered BELOW a 25-row table (DA-13 had to
 * scroll the page to find it), seven buttons on every row, and a round trip to
 * Excel for every correction. One click on a player opens this beside the
 * list; J and K walk the list without closing it; every field saves itself.
 *
 * Non-modal on purpose: the list stays live behind it, so clicking the next
 * name simply shows that player. On a phone it covers the screen instead.
 */
export function PlayerSheet({
  slug,
  row,
  desk,
  teams,
  mutate,
  onClose,
  categoryFlagged = false,
  position,
  onPrev,
  onNext,
  onDecline,
  onDecided,
  initialTab,
  reviewing = false,
  nextToReview,
}: PlayerSheetProps) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [tab, setTab] = useState<SheetTab>(
    initialTab ?? (row.status === "approved" ? "squad" : "details"),
  );
  const [deciding, setDeciding] = useState<TriageAction | null>(null);
  const toast = useToast();

  // Focus the heading when a different player arrives, so a screen reader
  // hears whose record this is and J/K work straight away.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [row.id]);

  // J / K walk the list, Escape closes — only when no field has the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable);
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key === "Escape" && !typing) {
        // A dialog opened over the sheet handles its own Escape.
        if (document.querySelector("dialog[open]") !== null) {
          return;
        }
        onClose();
      } else if (!typing && (event.key === "j" || event.key === "J") && onNext !== undefined) {
        event.preventDefault();
        onNext();
      } else if (!typing && (event.key === "k" || event.key === "K") && onPrev !== undefined) {
        event.preventDefault();
        onPrev();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, onNext, onPrev]);

  const decide = async (action: TriageAction) => {
    setDeciding(action);
    const nextStatus =
      action === "approve"
        ? "approved"
        : action === "waitlist"
          ? "waitlisted"
          : action === "restore"
            ? "submitted"
            : row.status;
    const result = await mutate(row, { status: nextStatus }, () =>
      triageRegistrationAction(slug, row.id, action),
    );
    setDeciding(null);
    if (result.ok) {
      toast({ title: decisionToast(row.name ?? row.number, action, result), tone: "success" });
      onDecided?.(row, action);
    }
    return result;
  };

  const pre = preSignedKind(row);
  return (
    <aside className="pd-sheet" aria-labelledby={titleId} data-testid="player-sheet">
      <div className="pd-sheet-bar">
        {position !== undefined ? (
          <div className="pd-sheet-nav">
            <button
              type="button"
              className="pd-icon-btn"
              aria-label="Previous player (K)"
              title="Previous player (K)"
              disabled={onPrev === undefined}
              onClick={onPrev}
              data-testid="sheet-prev"
            >
              <IconChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="pd-icon-btn"
              aria-label="Next player (J)"
              title="Next player (J)"
              disabled={onNext === undefined}
              onClick={onNext}
              data-testid="sheet-next"
            >
              <IconChevronRight size={18} />
            </button>
            <span className="pd-sheet-count">
              {position.index + 1} of {position.total}
            </span>
            {reviewing ? (
              <span className="pd-review-chip" data-testid="review-mode">
                Reviewing
              </span>
            ) : null}
          </div>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="pd-icon-btn"
          aria-label="Close"
          title="Close (Esc)"
          onClick={onClose}
          data-testid="sheet-close"
        >
          <IconClose size={18} />
        </button>
      </div>

      <div className="pd-sheet-scroll">
        <header className="pd-sheet-head">
          <PlayerImage
            name={row.name ?? "Player"}
            seed={row.personId}
            size="lg"
            {...(row.photoUrl !== null ? { src: row.photoUrl } : {})}
          />
          <div className="pd-sheet-id">
            <h2 id={titleId} ref={headingRef} tabIndex={-1} data-testid="details-subject">
              {row.name ?? "Unnamed player"}
            </h2>
            <p className="pd-sheet-meta">
              <span className="pd-mono">{row.number}</span>
              <span>{personContact(row)}</span>
              {row.age !== null ? <span>{row.age} yrs</span> : null}
            </p>
            <div className="pd-chips">
              <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
              {row.isIcon ? <Badge tone="success">Icon</Badge> : null}
              {row.isCaptain ? <Badge tone="info">Captain</Badge> : null}
              {row.isRetained ? <Badge tone="info">Retained</Badge> : null}
              {row.teamName !== null ? <span className="pd-team-chip">{row.teamName}</span> : null}
              {row.duplicateName ? <Badge tone="warning">possible duplicate</Badge> : null}
              {categoryFlagged ? <Badge tone="warning">check entry category</Badge> : null}
            </div>
          </div>
        </header>

        {row.status === "rejected" ? (
          <div className="pd-callout" data-tone="danger">
            {row.rejectionReason !== null ? (
              <p data-testid="details-reason">
                Declined — {REASON_LABEL[row.rejectionReason] ?? row.rejectionReason}. The player
                was told this reason.
              </p>
            ) : (
              <p data-testid="details-reason">Declined.</p>
            )}
            {/* The words behind the category, read back to the people who can
                act on them. Invariant 6: the player's own status page carries
                no such field, by construction. */}
            {row.rejectionNote !== null ? (
              <p data-testid="details-reason-note">
                <strong>Your note:</strong> {row.rejectionNote}{" "}
                <span className="pd-quiet">Organizers only — not shown to them.</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <DecisionBar
          row={row}
          deciding={deciding}
          onDecide={(action) => void decide(action)}
          {...(onDecline !== undefined
            ? {
                onDecline: () => {
                  onDecline(row);
                },
              }
            : {})}
          preSigned={pre}
        />

        {nextToReview !== undefined && !canTriage(row) ? (
          <button
            type="button"
            className="pd-next-review"
            onClick={nextToReview.go}
            data-testid="sheet-next-pending"
          >
            <span>
              Next to review: <strong>{nextToReview.name}</strong>
            </span>
            <span className="pd-quiet">
              {nextToReview.left} waiting <IconChevronRight size={14} className="icon-trail" />
            </span>
          </button>
        ) : null}

        {/* Tabs as buttons over one panel: the APG tab pattern with automatic
            activation, arrow keys included. */}
        <SheetTabs tab={tab} onTab={setTab} baseId={titleId} row={row} />

        <div
          className="pd-sheet-panel"
          role="tabpanel"
          id={`${titleId}-panel`}
          aria-labelledby={`${titleId}-tab-${tab}`}
        >
          {tab === "details" ? (
            <DetailsTab slug={slug} row={row} desk={desk} mutate={mutate} />
          ) : tab === "squad" ? (
            <SquadTab slug={slug} row={row} desk={desk} teams={teams} mutate={mutate} />
          ) : tab === "fee" ? (
            <FeeTab slug={slug} row={row} mutate={mutate} />
          ) : (
            <ActivityTab slug={slug} row={row} />
          )}
        </div>
      </div>
    </aside>
  );
}

function SheetTabs({
  tab: active,
  onTab,
  baseId,
  row,
}: {
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  baseId: string;
  row: Row;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- see Tabs in @desiauction/ui: focus belongs to the tabs, not the list
    <div
      className="pd-tabs"
      role="tablist"
      aria-label="Player sections"
      onKeyDown={(event) => {
        const index = TABS.findIndex((entry) => entry.id === active);
        let next: number | null = null;
        if (event.key === "ArrowRight") {
          next = (index + 1) % TABS.length;
        } else if (event.key === "ArrowLeft") {
          next = (index - 1 + TABS.length) % TABS.length;
        }
        if (next !== null) {
          event.preventDefault();
          const target = TABS[next];
          if (target !== undefined) {
            onTab(target.id);
            requestAnimationFrame(() => {
              document.getElementById(`${baseId}-tab-${target.id}`)?.focus();
            });
          }
        }
      }}
    >
      {TABS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          id={`${baseId}-tab-${entry.id}`}
          aria-selected={entry.id === active}
          aria-controls={`${baseId}-panel`}
          tabIndex={entry.id === active ? 0 : -1}
          className="pd-tab"
          data-testid={`sheet-tab-${entry.id}`}
          onClick={() => {
            onTab(entry.id);
          }}
        >
          {entry.label}
          {entry.id === "fee" && row.feeStatus !== "paid" ? (
            <span className="pd-tab-dot" aria-label={`— ${FEE_LABEL[row.feeStatus]}`} />
          ) : null}
          {entry.id === "squad" && isPreSigned(row) && row.teamId === null ? (
            <span className="pd-tab-dot" data-tone="danger" aria-label="— needs a team" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* --- The one thing to do next ------------------------------------------- */

function DecisionBar({
  row,
  deciding,
  onDecide,
  onDecline,
  preSigned,
}: {
  row: Row;
  deciding: TriageAction | null;
  onDecide: (action: TriageAction) => void;
  onDecline?: () => void;
  preSigned: ReturnType<typeof preSignedKind>;
}) {
  if (canTriage(row)) {
    return (
      <div className="pd-decision" data-testid="sheet-decision">
        <Button
          onClick={() => {
            onDecide("approve");
          }}
          loading={deciding === "approve"}
          disabled={deciding !== null}
          data-testid="sheet-approve"
        >
          Approve
        </Button>
        {row.status === "submitted" ? (
          <Button
            variant="secondary"
            onClick={() => {
              onDecide("waitlist");
            }}
            loading={deciding === "waitlist"}
            disabled={deciding !== null}
            data-testid="sheet-waitlist"
          >
            Waitlist
          </Button>
        ) : null}
        {onDecline !== undefined ? (
          <Button
            variant="ghost"
            onClick={onDecline}
            disabled={deciding !== null}
            data-testid="sheet-decline"
          >
            Decline…
          </Button>
        ) : null}
      </div>
    );
  }
  if (canRestore(row)) {
    return (
      <div className="pd-decision">
        <Button
          variant="secondary"
          onClick={() => {
            onDecide("restore");
          }}
          loading={deciding === "restore"}
          data-testid="sheet-restore"
        >
          Restore to review
        </Button>
      </div>
    );
  }
  if (row.status === "approved") {
    return (
      <p className="pd-decision-note" data-testid="sheet-outcome">
        {preSigned !== null
          ? row.teamId !== null
            ? `Pre-signed to ${row.teamName ?? "their team"} — skips the auction.`
            : `${PRE_SIGNED_LABEL[preSigned]} with no team — in no auction and no squad. Pick a team in Squad.`
          : row.teamId !== null
            ? `Approved · on ${row.teamName ?? "a team"}.`
            : "Approved · in the auction pool."}
      </p>
    );
  }
  return null;
}

/* --- Details ------------------------------------------------------------ */

function DetailsTab({
  slug,
  row,
  desk,
  mutate,
}: {
  slug: string;
  row: Row;
  desk: PlayerDeskContext;
  mutate: Mutate;
}) {
  const { field: save, raw } = useSaver(slug, row, mutate);
  const lockHint = desk.rosterLocked ? "Locked — the auction has started." : undefined;
  return (
    <div className="pd-form">
      <section className="pd-form-section">
        <h3>Photo</h3>
        <PlayerPhotoUploader
          slug={slug}
          registrationId={row.id}
          playerName={row.name ?? "Player"}
          {...(row.photoUrl !== null ? { currentUrl: row.photoUrl } : {})}
          key={row.id}
        />
      </section>

      <section className="pd-form-section">
        <h3>Player</h3>
        <div className="pd-grid">
          <TextSetting
            label="Name"
            value={row.name ?? ""}
            hint={
              row.typedName
                ? "The name this season shows."
                : "Changes the name this season shows — the player's own profile keeps theirs."
            }
            commit={save("name", (value) => ({ name: value.trim(), typedName: true }))}
            testId="edit-name"
          />
          <div className="pd-setting">
            <div className="pd-setting-head">
              <span>Contact</span>
            </div>
            <p className="pd-readonly">{personContact(row)}</p>
            <p className="pd-setting-hint">A number is who the player is — it can’t be edited.</p>
          </div>
          <TextSetting
            label="Date of birth"
            type="date"
            value={row.dateOfBirth ?? ""}
            commit={save("dateOfBirth")}
            testId="edit-dob"
          />
          <TextSetting
            label="Father’s name"
            value={row.fatherName ?? ""}
            commit={save("fatherName", (value) => ({ fatherName: value || null }))}
            hint="Kept on the record for ID checks — never exported."
          />
        </div>
      </section>

      <section className="pd-form-section">
        <h3>Playing</h3>
        <div className="pd-grid">
          <SelectSetting
            label="Role"
            value={row.role ?? ""}
            options={desk.roles.map((role) => ({ value: role.key, label: role.label }))}
            {...(desk.rolesRequired ? {} : { empty: "No particular role" })}
            disabled={desk.rosterLocked}
            {...(lockHint !== undefined ? { hint: lockHint } : {})}
            commit={save("role", (value) => ({ role: value || null }))}
            testId="edit-role"
          />
          <SelectSetting
            label="Base price band"
            value={row.basePriceBand ?? ""}
            options={desk.bands.map((band) => ({ value: band, label: `Band ${band}` }))}
            empty="Default band"
            disabled={desk.rosterLocked}
            {...(lockHint !== undefined ? { hint: lockHint } : {})}
            commit={save("basePriceBand", (value) => ({ basePriceBand: value || null }))}
            testId="edit-band"
          />
          {desk.attributes.map((attribute) => (
            <SelectSetting
              key={attribute.key}
              label={attribute.label}
              value={row.attributeValues[attribute.key] ?? ""}
              options={attribute.options.map((option) => ({
                value: option.key,
                label: option.label,
              }))}
              empty="Not specified"
              commit={(value) =>
                raw({ attributes: { [attribute.key]: value } }, "attributes", {
                  attributeValues: { ...row.attributeValues, [attribute.key]: value },
                })
              }
              testId={`edit-attr-${attribute.key}`}
            />
          ))}
        </div>
      </section>

      <section className="pd-form-section">
        <h3>Kit</h3>
        <div className="pd-grid">
          <TextSetting
            label="Name on jersey"
            value={row.jerseyName ?? ""}
            commit={save("jerseyName", (value) => ({ jerseyName: value || null }))}
            testId="edit-jersey-name"
          />
          <TextSetting
            label="Jersey number"
            value={row.jerseyNumber ?? ""}
            inputMode="numeric"
            commit={save("jerseyNumber", (value) => ({ jerseyNumber: value || null }))}
            testId="edit-jersey-number"
          />
          <TextSetting
            label="T-shirt size"
            value={row.tshirtSize ?? ""}
            placeholder="M, L, XL…"
            commit={save("tshirtSize", (value) => ({ tshirtSize: value || null }))}
          />
          <TextSetting
            label="Trouser size"
            value={row.trouserSize ?? ""}
            placeholder="32, 34…"
            commit={save("trouserSize", (value) => ({ trouserSize: value || null }))}
          />
        </div>
      </section>

      <section className="pd-form-section">
        <TextSetting
          label="Organizer note"
          value={row.note ?? ""}
          multiline
          wide
          placeholder="Anything the desk should remember — stays with the player."
          hint="Only organizers see this."
          commit={save("note", (value) => ({ note: value || null }))}
          testId="edit-note"
        />
      </section>
    </div>
  );
}

/**
 * One field → one partial update, applied to the row before the server answers.
 * The field component shows Saving/Saved; errors come back inline, not as toasts.
 */
function useSaver(slug: string, row: Row, mutate: Mutate) {
  const raw = useCallback(
    async (
      input: RegistrationEditInput,
      field: keyof RegistrationEditInput,
      optimistic: Partial<Row> = {},
    ) => {
      const result = await mutate(
        row,
        optimistic,
        () => updateRegistrationDetailsAction(slug, row.id, input),
        { quiet: true },
      );
      return result.ok
        ? { ok: true }
        : { ok: false, error: result.fieldErrors?.[field] ?? result.error };
    },
    [mutate, row, slug],
  );
  const field =
    (
      key: keyof Omit<RegistrationEditInput, "attributes">,
      optimistic?: (v: string) => Partial<Row>,
    ) =>
    (value: string) =>
      raw({ [key]: value }, key, optimistic?.(value) ?? {});
  return { field, raw };
}

/* --- Squad ------------------------------------------------------------- */

function SquadTab({
  slug,
  row,
  desk,
  teams,
  mutate,
}: {
  slug: string;
  row: Row;
  desk: PlayerDeskContext;
  teams: readonly { id: string; name: string }[];
  mutate: Mutate;
}) {
  const name = row.name ?? row.number;
  const onTeam = row.teamId !== null;
  const locked = desk.rosterLocked;
  const canEdit = desk.canManageTeams;
  const teamName = (id: string | null) =>
    id === null ? null : (teams.find((team) => team.id === id)?.name ?? null);

  const setMarks = (
    marks: { isIcon?: boolean; isCaptain?: boolean; isRetained?: boolean; teamId?: string | null },
    success: string,
    undoMarks: typeof marks,
  ) =>
    mutate(
      row,
      {
        ...marks,
        ...(marks.teamId !== undefined ? { teamName: teamName(marks.teamId) } : {}),
      },
      () => markRegistrationAction(slug, row.id, marks),
      {
        success,
        undo: () => {
          void mutate(
            row,
            {
              ...undoMarks,
              ...(undoMarks.teamId !== undefined ? { teamName: teamName(undoMarks.teamId) } : {}),
            },
            () => markRegistrationAction(slug, row.id, undoMarks),
          );
        },
      },
    );

  const PHRASE = {
    isIcon: ["is now an Icon", "is no longer an Icon"],
    isCaptain: ["is now Captain", "is no longer Captain"],
    isRetained: ["is retained", "is no longer retained"],
  } as const;
  const toggle = (mark: "isIcon" | "isCaptain" | "isRetained") => {
    const next = !row[mark];
    void setMarks({ [mark]: next }, `${name} ${PHRASE[mark][next ? 0 : 1]}`, { [mark]: !next });
  };

  const status = squadStatus(row, locked);
  const marksDisabledReason = !canEdit
    ? "Managing squads needs the team permission for this season."
    : null;

  return (
    <div className="pd-form" data-testid="assign-team-row">
      {/* The header already says "pre-signed to …" when all is well; the tab
          speaks up only when there is something to act on or explain. */}
      {status.tone !== "success" ? (
        <p className="pd-callout" data-tone={status.tone} data-testid="squad-status">
          {status.tone === "danger" ? <IconAlert size={16} className="icon-lead" /> : null}
          {status.text}
        </p>
      ) : null}

      <section className="pd-form-section">
        <div className="pd-grid">
          <SelectSetting
            label="Team"
            wide
            value={row.teamId ?? ""}
            empty={locked ? "No team" : "No team — goes to the auction"}
            options={teams.map((team) => ({ value: team.id, label: team.name }))}
            disabled={!canEdit || locked || teams.length === 0}
            {...(teams.length === 0
              ? { hint: "Add teams first — Teams tab." }
              : locked
                ? { hint: "The auction has started — squads are set by the auction now." }
                : {})}
            testId="sheet-team"
            commit={async (value) => {
              const clearing = value === "";
              const marks = clearing
                ? { teamId: null, isIcon: false, isCaptain: false, isRetained: false }
                : { teamId: value };
              const result = await mutate(
                row,
                { ...marks, teamName: teamName(clearing ? null : value) },
                () => markRegistrationAction(slug, row.id, marks),
                {
                  success: clearing
                    ? `${name} has no team — back in the auction pool`
                    : `${name} → ${teamName(value) ?? "team"}`,
                },
              );
              return result;
            }}
          />
        </div>
      </section>

      <section className="pd-form-section">
        <h3>Joins the team as</h3>
        <div className="pd-marks" role="group" aria-label="Pre-signing marks">
          <MarkToggle
            label="Captain"
            on={row.isCaptain}
            // Captaincy is a job in the squad, so it stays editable after the
            // auction starts — for a player who is already on a team.
            disabled={!canEdit || (locked && !row.isCaptain && !onTeam)}
            onToggle={() => {
              toggle("isCaptain");
            }}
            testId={`captain-toggle-${row.personId}`}
            help="Leads the side. One per team — naming a new one moves the armband."
          />
          <MarkToggle
            label="Icon"
            on={row.isIcon}
            disabled={!canEdit || locked}
            onToggle={() => {
              toggle("isIcon");
            }}
            testId={`icon-toggle-${row.personId}`}
            help="The marquee name, signed before the night."
          />
          <MarkToggle
            label="Retained"
            on={row.isRetained}
            disabled={!canEdit || locked}
            onToggle={() => {
              toggle("isRetained");
            }}
            testId={`retain-toggle-${row.personId}`}
            help="Kept from last season."
          />
        </div>
        <p className="pd-setting-hint">
          {marksDisabledReason ??
            (locked
              ? "Icon and Retained are locked with the auction. The armband can still move between players a team has bought."
              : `Any of these keeps them out of the auction — ${onTeam ? "they join their team directly" : "pick their team above"}.${desk.auctionExists ? " The auction is set up, and these still count: its lots follow them when it opens." : ""}`)}
        </p>
      </section>
    </div>
  );
}

function squadStatus(
  row: Row,
  locked: boolean,
): { tone: "success" | "info" | "warning" | "danger" | "neutral"; text: ReactNode } {
  const kind = preSignedKind(row);
  const marks = [
    row.isIcon ? "Icon" : null,
    row.isCaptain ? "Captain" : null,
    row.isRetained ? "Retained" : null,
  ]
    .filter((mark): mark is string => mark !== null)
    .join(" & ");
  if (kind !== null && row.teamId === null) {
    return {
      tone: "danger",
      text: `${marks} with no team — they are in no auction and no squad until you pick one.`,
    };
  }
  if (kind !== null) {
    return {
      tone: "success",
      text: `Pre-signed to ${row.teamName ?? "their team"} as ${marks} — skips the auction.`,
    };
  }
  if (row.teamId !== null) {
    return locked
      ? { tone: "neutral", text: `On ${row.teamName ?? "a team"}.` }
      : {
          tone: "warning",
          text: `On ${row.teamName ?? "a team"} by hand, but still in the auction pool. Mark them Captain, Icon or Retained to keep them out of it.`,
        };
  }
  if (row.status !== "approved") {
    return {
      tone: "neutral",
      text: "Not approved yet — approve them to put them in the auction pool.",
    };
  }
  return { tone: "info", text: "In the auction pool — a team buys them on the night." };
}

function MarkToggle({
  label,
  on,
  disabled,
  onToggle,
  testId,
  help,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
  testId: string;
  help: string;
}) {
  return (
    <button
      type="button"
      className="pd-mark"
      aria-pressed={on}
      // Clearing a mark is always allowed while the control is enabled at all.
      disabled={disabled && !on}
      onClick={onToggle}
      data-testid={testId}
    >
      <span className="pd-mark-box" aria-hidden>
        {on ? "✓" : ""}
      </span>
      <span className="pd-mark-text">
        <span className="pd-mark-label">{label}</span>
        <span className="pd-mark-help">{help}</span>
      </span>
    </button>
  );
}

/* --- Fee --------------------------------------------------------------- */

function FeeTab({ slug, row, mutate }: { slug: string; row: Row; mutate: Mutate }) {
  const { field: save, raw } = useSaver(slug, row, mutate);
  return (
    <div className="pd-form">
      <section className="pd-form-section">
        <SegmentSetting
          label="Entry fee"
          value={row.feeStatus}
          options={FEE_STATUSES.map((state) => ({ value: state, label: FEE_LABEL[state] }))}
          commit={(value) =>
            raw({ feeStatus: value }, "feeStatus", {
              feeStatus: value as Row["feeStatus"],
            })
          }
          testId="edit-fee-status"
        />
        <div className="pd-grid">
          <TextSetting
            label="Amount (₹)"
            value={row.feeAmountPaise === null ? "" : String(row.feeAmountPaise / 100)}
            inputMode="decimal"
            placeholder="500"
            commit={save("feeAmount")}
            testId="edit-fee-amount"
            hint="Desk bookkeeping only — never posted to the season's accounts."
          />
          <TextSetting
            label="Reference"
            value={row.feeReference ?? ""}
            placeholder="UPI ref, receipt no."
            commit={save("feeReference", (value) => ({ feeReference: value || null }))}
            testId="edit-fee-reference"
          />
        </div>
        {row.feeStatus === "paid" && row.feeAmountPaise !== null ? (
          <p className="pd-setting-hint" data-testid="details-fee">
            Paid {formatPaiseINR(paise(row.feeAmountPaise))}
            {row.feeReference !== null && row.feeReference !== "" ? ` · ${row.feeReference}` : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/* --- Activity ---------------------------------------------------------- */

function ActivityTab({ slug, row }: { slug: string; row: Row }) {
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null);
  const [history, setHistory] = useState<
    { competitionName: string; startsOn: string | null; status: string }[]
  >([]);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Two independent reads, one paint (PI-1).
    void Promise.all([
      registrationTimelineAction(slug, row.id),
      personHistoryAction(slug, row.id),
    ]).then(([entries, seasons]) => {
      if (live) {
        setTimeline(entries);
        setHistory(seasons);
      }
    });
    return () => {
      live = false;
    };
  }, [slug, row.id, row.status]);

  const add = async () => {
    setAdding(true);
    setError(null);
    const result = await addNoteAction(slug, row.id, note);
    setAdding(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add the note.");
      return;
    }
    setNote("");
    setTimeline(await registrationTimelineAction(slug, row.id));
  };

  return (
    <div className="pd-form" data-testid="timeline-panel">
      <form
        className="pd-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label htmlFor={`note-${row.id}`} className="pd-visually-hidden">
          Add a note
        </label>
        <input
          id={`note-${row.id}`}
          className="pd-input"
          placeholder="Add a note — “verified via club captain”"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          loading={adding}
          disabled={note.trim() === ""}
        >
          Add note
        </Button>
      </form>
      {error !== null ? (
        <p className="pd-setting-error" role="alert">
          {error}
        </p>
      ) : null}

      {history.length > 0 ? (
        <section className="pd-form-section">
          <h3>Seen before in your club</h3>
          <ul className="pd-history" data-testid="person-history">
            {history.map((season, index) => (
              <li key={index}>
                <span>{season.competitionName}</span>
                <span className="pd-quiet">
                  {season.startsOn !== null ? `${season.startsOn.slice(0, 4)} · ` : ""}
                  {season.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="pd-form-section">
        <h3>Timeline</h3>
        {timeline === null ? (
          <p className="pd-quiet">Loading…</p>
        ) : timeline.length === 0 ? (
          <p className="pd-quiet">Nothing recorded yet.</p>
        ) : (
          <ol className="pd-timeline">
            {timeline.map((entry, index) => (
              <li key={index}>
                <span className="pd-timeline-verb">
                  {TIMELINE_VERB[entry.action] ?? entry.action.replace(/^registration\./, "")}
                </span>
                <span className="pd-quiet">
                  {formatDateTime(entry.at)} ·{" "}
                  {entry.actorName !== null ? entry.actorName : "the system"}
                </span>
                {metaLine(entry.meta)}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function metaLine(meta: unknown): ReactNode {
  if (typeof meta !== "object" || meta === null) {
    return null;
  }
  const record = meta as Record<string, unknown>;
  if (typeof record["note"] === "string") {
    return <span className="pd-timeline-note">“{record["note"]}”</span>;
  }
  if (typeof record["reason"] === "string") {
    return (
      <span className="pd-timeline-note">
        Reason: {REASON_LABEL[record["reason"]] ?? record["reason"]}
      </span>
    );
  }
  if (typeof record["fields"] === "string") {
    return (
      <span className="pd-timeline-note">
        {record["fields"]
          .split(",")
          .map((field) => EDITED_FIELD_LABEL[field] ?? field)
          .join(", ")}
      </span>
    );
  }
  return null;
}

/** The toast a decision earns — the verb in the past tense, and the SMS in words. */
export function decisionToast(
  name: string,
  action: TriageAction,
  result: { notifying?: number },
): string {
  const verb = PAST_TENSE[action] ?? action;
  return (result.notifying ?? 0) > 0 ? `${name} ${verb} · SMS on its way` : `${name} ${verb}`;
}
