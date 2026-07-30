"use client";

import { REJECTION_REASONS } from "@desiauction/core";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  PlayerImage,
  Select,
  Tabs,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addNoteAction,
  assignTeamAction,
  bulkTriageAction,
  exportRegistrationsAction,
  importCommitAction,
  importPreviewAction,
  markRegistrationAction,
  registrationTimelineAction,
  selectAllMatchingAction,
  triageRegistrationAction,
  type ImportPreview,
  type RegistrationDashboard,
  type TriageAction,
} from "../../../../server/competition/actions";
import { AddPlayerDialog } from "./add-player-dialog";
import { PhotoImportPanel } from "./photo-import";
import { PlayerPhotoUploader } from "./player-photo-uploader";
import { formatDateTime } from "../../../../lib/format-date";
import { formatPhone } from "../../../../lib/format-phone";
import type {
  OrphanIcon,
  RegistrationPage,
  RegistrationStats,
  TimelineEntry,
} from "../../../../server/competition/registrations";

type Row = RegistrationPage["rows"][number];

const REG_TONE = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  waitlisted: "warning",
  withdrawn: "neutral",
} as const;

const STATUS_FILTERS = ["", "submitted", "approved", "rejected", "waitlisted", "withdrawn"];
const STATUS_LABEL: Record<string, string> = {
  "": "All statuses",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Declined",
  waitlisted: "Waitlisted",
  withdrawn: "Withdrawn",
};
const SORTS = ["recent", "oldest", "name", "number", "status"];
const SORT_LABEL: Record<string, string> = {
  recent: "Newest first",
  oldest: "Oldest first",
  name: "Name",
  number: "Registration number",
  status: "Status",
};

/**
 * DA-22: the toast built its verb as `${action}d`, which spelled "rejectd" and
 * "waitlistd". Approve was correct by luck.
 */
const PAST_TENSE: Record<string, string> = {
  approve: "approved",
  reject: "declined",
  waitlist: "waitlisted",
  restore: "restored",
};

/** What a rejection reason is called where a human reads it. */
const REASON_LABEL: Record<string, string> = {
  duplicate: "Already registered",
  ineligible: "Not eligible",
  withdrew: "Player withdrew",
  capacity: "Season is full",
  other: "Other",
};

/**
 * DA-35: the timeline printed raw enum tails — "IMPORTED · APPROVE ·
 * MARKS_SET · WAITLIST" — and named no actor.
 */
const TIMELINE_VERB: Record<string, string> = {
  "registration.submitted": "Registered",
  "registration.added": "Added by the organizer",
  "registration.imported": "Imported from a CSV",
  "registration.approve": "Approved",
  "registration.reject": "Declined",
  "registration.waitlist": "Waitlisted",
  "registration.withdraw": "Withdrawn",
  "registration.restore": "Restored to review",
  "registration.marks_set": "Marks changed",
  "registration.team_assigned": "Assigned to a team",
  "registration.note": "Note added",
  "registration.notified": "Player notified by SMS",
  "registration.notify_failed": "SMS to the player failed",
  "registration.exported": "Included in a CSV export",
};

/** A row the organizer has selected — remembered by identity, not by index, so
 * it can be named on a page it is no longer displayed on. */
interface Picked {
  id: string;
  number: string;
  name: string | null;
}

export function RegistrationDashboardPanel({
  slug,
  stats,
  page,
  teams,
  filters,
  orphanIcons,
  registrationOpen,
}: {
  slug: string;
  stats: RegistrationStats;
  page: RegistrationPage;
  teams: NonNullable<RegistrationDashboard["teams"]>;
  filters: { search: string; status: string; team: string; sort: string };
  orphanIcons: OrphanIcon[];
  registrationOpen: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Map<string, Picked>>(new Map());
  const [busy, setBusy] = useState(false);
  // DA-35: no default. The reason was silently "duplicate", so every organizer
  // who did not open the select filed everybody as a duplicate.
  const [rejectReason, setRejectReason] = useState("");
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assignTeamId, setAssignTeamId] = useState("");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [noteText, setNoteText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [ioOpen, setIoOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState<TriageAction | null>(null);
  const [rowDecline, setRowDecline] = useState<Row | null>(null);
  const [iconConfirm, setIconConfirm] = useState<Row | null>(null);
  const csvRef = useRef<HTMLTextAreaElement>(null);
  const [search, setSearch] = useState(filters.search);
  // Interactivity marker: this effect runs only after client hydration, so the
  // attribute is a deterministic "the panel's handlers are live now" signal.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const rows = page.rows;
  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const filtersApplied =
    filters.search !== "" ||
    filters.status !== "" ||
    filters.team !== "" ||
    filters.sort !== "recent";

  /**
   * DA-35: focus landed on <body> after every action, because `router.refresh()`
   * replaces the subtree the button lived in. Each action records the stable key
   * of the control it came from; the key is re-focused once the fresh rows land.
   */
  const restoreFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const key = restoreFocusRef.current;
    if (key === null) {
      return;
    }
    restoreFocusRef.current = null;
    const target = document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`);
    target?.focus();
  }, [rows]);

  const pushQuery = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams();
      const merged = {
        q: filters.search,
        status: filters.status,
        team: filters.team,
        sort: filters.sort,
        ...patch,
      };
      for (const [key, value] of Object.entries(merged)) {
        if (value !== "") {
          next.set(key, value);
        }
      }
      router.push(`/seasons/${slug}/registrations?${next.toString()}`);
    },
    [router, slug, filters],
  );

  /**
   * A filter change re-decides WHICH PEOPLE the screen is about. A selection
   * made under the old filter can no longer be shown, so it is dropped — out
   * loud. Paging does not clear: those rows are still in the same set.
   */
  const changeFilter = useCallback(
    (patch: Record<string, string>) => {
      setSelected((prev) => {
        if (prev.size > 0) {
          toast({
            title: `Selection cleared — ${String(prev.size)} row(s) were selected under the previous filter.`,
            tone: "info",
          });
        }
        return new Map();
      });
      pushQuery({ ...patch, page: "1" });
    },
    [pushQuery, toast],
  );

  const toggle = useCallback((row: Pick<Row, "id" | "number" | "name">) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.set(row.id, { id: row.id, number: row.number, name: row.name });
      }
      return next;
    });
  }, []);

  const selectAllMatching = async () => {
    setBusy(true);
    const result = await selectAllMatchingAction(slug, {
      ...(filters.search !== "" ? { search: filters.search } : {}),
      ...(filters.status !== "" ? { status: filters.status } : {}),
      ...(filters.team !== "" ? { teamId: filters.team } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      toast({ title: result.error, tone: "danger" });
      return;
    }
    setSelected(
      new Map(
        result.rows.map((row) => [row.id, { id: row.id, number: row.number, name: row.name }]),
      ),
    );
    toast({
      title: result.capped
        ? `Selected the first ${String(result.rows.length)} matching registrations.`
        : `Selected all ${String(result.rows.length)} matching registrations.`,
      tone: "success",
    });
  };

  const announce = (
    result: {
      ok: boolean;
      applied?: number;
      skipped?: number;
      notified?: number;
      notifyFailed?: number;
      error?: string;
    },
    action: TriageAction,
  ) => {
    if (!result.ok) {
      toast({ title: result.error ?? "Bulk action failed.", tone: "danger" });
      return;
    }
    const parts = [
      `${String(result.applied ?? 0)} ${PAST_TENSE[action] ?? action}`,
      `${String(result.skipped ?? 0)} skipped`,
    ];
    // DA-35: say whether the PEOPLE were told, not just whether the database
    // changed. A silent success here is exactly the bug being fixed.
    if ((result.notified ?? 0) > 0) {
      parts.push(`${String(result.notified ?? 0)} notified`);
    }
    if ((result.notifyFailed ?? 0) > 0) {
      parts.push(`${String(result.notifyFailed ?? 0)} could not be reached`);
    }
    toast({
      title: parts.join(" · "),
      tone: (result.notifyFailed ?? 0) > 0 ? "danger" : "success",
    });
  };

  const runBulk = async (action: TriageAction) => {
    if (selected.size === 0) {
      return;
    }
    setBusy(true);
    const result = await bulkTriageAction(
      slug,
      [...selected.keys()],
      action,
      action === "reject" ? rejectReason : undefined,
    );
    setBusy(false);
    announce(result, action);
    if (result.ok) {
      setSelected(new Map());
      setConfirmBulk(null);
      router.refresh();
    }
  };

  const runSingle = async (row: Row, action: TriageAction, reason?: string, focusKey?: string) => {
    setBusy(true);
    restoreFocusRef.current = focusKey ?? null;
    const result = await triageRegistrationAction(slug, row.id, action, reason);
    setBusy(false);
    if (result.ok) {
      // DA-35: a single approval used to toast only on FAILURE — success was
      // announced to nobody, least of all a screen-reader user.
      const told =
        (result.notified ?? 0) > 0
          ? " · player notified"
          : (result.notifyFailed ?? 0) > 0
            ? " · we could not reach them"
            : "";
      toast({
        title: `${row.name ?? row.number} ${PAST_TENSE[action] ?? action}${told}`,
        tone: (result.notifyFailed ?? 0) > 0 ? "danger" : "success",
      });
      setRowDecline(null);
      router.refresh();
    } else {
      toast({ title: result.error ?? "Action failed.", tone: "danger" });
    }
  };

  /**
   * A mark either took or was refused, and the refusal is a rule the organizer
   * has to hear — Icon and Captain are mutually exclusive, and a click that
   * quietly did nothing would teach them nothing.
   */
  const applyMark = (result: { ok: boolean; error?: string }, success: string) => {
    if (result.ok) {
      toast({ title: success, tone: "success" });
      router.refresh();
    } else {
      toast({ title: result.error ?? "That mark could not be set.", tone: "danger" });
    }
  };

  const openDetails = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    // DA-13: the panel renders AFTER the table, so on a 25-row page it opened
    // ~2,400px below the row that was clicked. Clicking Details looked like
    // nothing had happened at all.
    requestAnimationFrame(() => {
      document
        .querySelector('[data-testid="timeline-panel"]')
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setNoteText("");
    setTimeline(await registrationTimelineAction(slug, id));
  };

  const submitNote = async (id: string) => {
    const result = await addNoteAction(slug, id, noteText);
    if (result.ok) {
      setNoteText("");
      setTimeline(await registrationTimelineAction(slug, id));
    } else {
      toast({ title: result.error ?? "Could not add note.", tone: "danger" });
    }
  };

  const doExport = async () => {
    const result = await exportRegistrationsAction(slug);
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

  const readCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (csvRef.current) {
        csvRef.current.value = typeof reader.result === "string" ? reader.result : "";
      }
      setPreview(null);
    };
    reader.readAsText(file);
  };

  const runPreview = async () => {
    const text = csvRef.current?.value ?? "";
    if (text.trim() === "") {
      return;
    }
    setPreview(await importPreviewAction(slug, text));
  };

  const commitImport = async () => {
    const text = csvRef.current?.value ?? "";
    setBusy(true);
    const result = await importCommitAction(slug, text);
    setBusy(false);
    if (result.ok) {
      toast({
        title: `Imported ${String(result.imported ?? 0)} · ${String(result.duplicates ?? 0)} already registered`,
        tone: "success",
      });
      setPreview(null);
      if (csvRef.current) {
        csvRef.current.value = "";
      }
      setIoOpen(false);
      router.refresh();
    } else {
      toast({ title: result.error ?? "Import failed.", tone: "danger" });
    }
  };

  /**
   * Keyboard cursor: j/k move, x toggles the cursor row's selection.
   *
   * DA-35: `a` used to APPROVE THE WHOLE SELECTION from a bare keypress with no
   * dialog — 25 irreversible approvals from a typo in a page that has no undo.
   * A destructive write has no business on an unmodified letter key listening
   * at the window. Movement and selection stay; the writes are buttons.
   */
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const current = rowsRef.current;
      if (event.key === "j") {
        setCursor((c) => Math.min(c + 1, current.length - 1));
      } else if (event.key === "k") {
        setCursor((c) => Math.max(c - 1, 0));
      } else if (event.key === "x") {
        const row = current[cursor];
        if (row) {
          toggle(row);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [cursor, toggle]);

  // Keep the keyboard cursor in view (P2) — a cursor you cannot see is a cursor
  // that selects rows you did not mean.
  useEffect(() => {
    document
      .querySelector<HTMLElement>('[data-cursor="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const allOnPageSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [rows, selected],
  );
  const selectedOnPage = useMemo(
    () => rows.filter((r) => selected.has(r.id)).length,
    [rows, selected],
  );
  const offPage = selected.size - selectedOnPage;

  return (
    <>
      <div className="reg-toolbar">
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
          variant="secondary"
          data-testid="open-import"
          onClick={() => {
            setIoOpen(true);
          }}
        >
          Import (CSV / photos)
        </Button>
        <AddPlayerDialog slug={slug} />
      </div>
      <div className="stat-row" data-testid="stat-row" data-hydrated={hydrated ? "true" : "false"}>
        <StatTile
          label="Total"
          value={stats.total}
          testId="stat-total"
          active={filters.status === ""}
          onSelect={() => {
            changeFilter({ status: "" });
          }}
        />
        <StatTile
          label="Submitted"
          value={stats.submitted}
          testId="stat-submitted"
          active={filters.status === "submitted"}
          onSelect={() => {
            changeFilter({ status: "submitted" });
          }}
        />
        <StatTile
          label="Approved"
          value={stats.approved}
          testId="stat-approved"
          active={filters.status === "approved"}
          onSelect={() => {
            changeFilter({ status: "approved" });
          }}
        />
        {/* DA-35: the figure that decides what auction night contains. It sat on
            the Auction tab only, computed from the same rows, and the two tabs
            disagreed in public. */}
        <StatTile
          label="Auction pool"
          value={stats.auctionPool}
          testId="stat-auction-pool"
          hint={
            stats.icons > 0
              ? `${String(stats.approved)} approved − ${String(stats.icons)} icon${stats.icons === 1 ? "" : "s"}`
              : "Approved players who go to the block"
          }
        />
        <StatTile
          label="Waitlisted"
          value={stats.waitlisted}
          testId="stat-waitlisted"
          active={filters.status === "waitlisted"}
          onSelect={() => {
            changeFilter({ status: "waitlisted" });
          }}
        />
        <StatTile
          label="Declined"
          value={stats.rejected}
          testId="stat-rejected"
          active={filters.status === "rejected"}
          onSelect={() => {
            changeFilter({ status: "rejected" });
          }}
        />
        <StatTile
          label="Withdrawn"
          value={stats.withdrawn}
          testId="stat-withdrawn"
          active={filters.status === "withdrawn"}
          onSelect={() => {
            changeFilter({ status: "withdrawn" });
          }}
        />
      </div>
      <p className="dash-hint" data-testid="pool-explainer">
        <strong>Auction pool</strong> is what the auction will actually contain: approved players
        minus Icons. An Icon is pre-signed to their team and never goes to the block — the Auction
        tab counts the pool the same way.
      </p>

      {/* DA-35: the orphan. An Icon is only counted into a squad when their
          registration carries the same team as the paddle, so an Icon with no
          team is in NO auction and NO squad. One click created that state and
          the product said nothing. */}
      {orphanIcons.length > 0 ? (
        <Card data-testid="orphan-icon-warning">
          <p role="alert" className="reg-warning">
            <strong>
              {orphanIcons.length} Icon{orphanIcons.length === 1 ? " is" : "s are"} in no auction
              and no squad.
            </strong>{" "}
            An Icon is pre-signed to a team instead of being bid for, so an Icon with no team is not
            in the auction pool and will not appear in any squad. Assign a team, or clear the Icon
            mark to put them back in the pool.
          </p>
          <ul className="reg-warning-list">
            {orphanIcons.map((icon) => (
              <li key={icon.id}>
                {icon.name ?? "Unnamed"} <span className="reg-number">{icon.number}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <form
          className="filter-bar"
          onSubmit={(event) => {
            event.preventDefault();
            changeFilter({ q: search });
          }}
        >
          <Field
            label="Search"
            name="q"
            placeholder="name, phone, number or team"
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
              changeFilter({ status: event.target.value });
            }}
          >
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status] ?? status}
              </option>
            ))}
          </Select>
          <Select
            label="Team"
            name="team"
            value={filters.team}
            onChange={(event) => {
              changeFilter({ team: event.target.value });
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
            label="Sort"
            name="sort"
            value={filters.sort}
            onChange={(event) => {
              changeFilter({ sort: event.target.value });
            }}
          >
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABEL[sort] ?? sort}
              </option>
            ))}
          </Select>
          <Button type="submit" data-testid="search-submit">
            Search
          </Button>
        </form>
        <p className="dash-hint">Shortcuts: j/k move the cursor · x selects the cursor row</p>
      </Card>

      {selected.size > 0 ? (
        <Card data-testid="bulk-bar">
          <div className="bulk-bar">
            <strong data-testid="bulk-count">{selected.size} selected</strong>
            {/* DA-35: the selection used to survive paging and filter changes
                INVISIBLY — 25 selected, none of them on screen, and Reject
                would have hit all 25. It now says so, out loud, every time. */}
            {offPage > 0 ? (
              <span className="bulk-offpage" data-testid="bulk-offpage">
                {offPage} not shown on this page
              </span>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setReviewOpen(true);
              }}
              data-testid="bulk-review"
            >
              Review selection
            </Button>
            {selected.size < page.total ? (
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() => void selectAllMatching()}
                data-testid="bulk-select-all-matching"
              >
                Select all {page.total} matching
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelected(new Map());
              }}
              data-testid="bulk-clear"
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => void runBulk("approve")}
              loading={busy}
              data-testid="bulk-approve"
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void runBulk("waitlist")}
              loading={busy}
              data-testid="bulk-waitlist"
            >
              Waitlist
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirmBulk("reject");
              }}
              loading={busy}
              data-testid="bulk-reject"
            >
              Decline
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void runBulk("restore")}
              loading={busy}
            >
              Restore
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        {/* Select-all lives ABOVE the table, not inside <thead>: below 1100px
            each row becomes a card and the header strip is gone, which would
            have taken the only select-all with it. One control, every width. */}
        {rows.length > 0 ? (
          <label className="reg-select-all">
            <input
              type="checkbox"
              className="reg-check"
              aria-label="Select all on page"
              checked={allOnPageSelected}
              onChange={() => {
                setSelected((prev) => {
                  const next = new Map(prev);
                  if (allOnPageSelected) {
                    rows.forEach((r) => next.delete(r.id));
                  } else {
                    rows.forEach((r) => {
                      next.set(r.id, { id: r.id, number: r.number, name: r.name });
                    });
                  }
                  return next;
                });
              }}
            />
            <span>
              Select all {rows.length} on this page
              {page.total > rows.length ? ` (of ${String(page.total)} matching)` : ""}
            </span>
          </label>
        ) : null}
        <div
          className="table-scroll"
          role="region"
          aria-label="Registrations table"
          tabIndex={0}
          data-testid="table-scroll"
        >
          <table className="reg-table" data-testid="reg-table">
            <caption className="reg-caption">
              {page.total} registration{page.total === 1 ? "" : "s"} match this view — page{" "}
              {page.page} of {totalPages}.
            </caption>
            <thead>
              <tr>
                <th>
                  <VisuallyHidden>Select</VisuallyHidden>
                </th>
                <th>#</th>
                <th>Player</th>
                <th>Role</th>
                <th>Status</th>
                <th>Team</th>
                <th>
                  <VisuallyHidden>Actions</VisuallyHidden>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <RegRow
                  key={row.id}
                  row={row}
                  active={index === cursor}
                  checked={selected.has(row.id)}
                  onToggle={() => {
                    toggle(row);
                  }}
                  onDetails={() => void openDetails(row.id)}
                  onApprove={() => void runSingle(row, "approve", undefined, `approve-${row.id}`)}
                  onWaitlist={() =>
                    void runSingle(row, "waitlist", undefined, `waitlist-${row.id}`)
                  }
                  onDecline={() => {
                    setRejectReason("");
                    setRowDecline(row);
                  }}
                  onIcon={() => {
                    if (row.isIcon) {
                      restoreFocusRef.current = `icon-${row.id}`;
                      void markRegistrationAction(slug, row.id, { isIcon: false }).then(
                        (result) => {
                          applyMark(result, `${row.name ?? row.number} is no longer an Icon`);
                        },
                      );
                    } else {
                      setIconConfirm(row);
                    }
                  }}
                  onCaptain={() => {
                    restoreFocusRef.current = `captain-${row.id}`;
                    void markRegistrationAction(slug, row.id, { isCaptain: !row.isCaptain }).then(
                      (result) => {
                        applyMark(
                          result,
                          row.isCaptain
                            ? `${row.name ?? row.number} is no longer Captain`
                            : `${row.name ?? row.number} is Captain`,
                        );
                      },
                    );
                  }}
                  busy={busy}
                />
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="reg-empty" data-testid="reg-empty">
                    {/* DA-35: one string served two different situations — an
                        empty season and a filter that matched nothing. The
                        first is the START of this screen's life, and blaming a
                        filter that has not been applied is a dead end. */}
                    {filtersApplied || stats.total > 0 ? (
                      <>
                        <strong>No registrations match these filters.</strong>{" "}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            setSearch("");
                            changeFilter({ q: "", status: "", team: "", sort: "recent" });
                          }}
                        >
                          Clear the filters
                        </button>{" "}
                        to see all {stats.total} registration{stats.total === 1 ? "" : "s"}.
                      </>
                    ) : (
                      <>
                        <strong>Nobody has registered yet.</strong> Share the link above —
                        that&apos;s how players arrive. You can also add players yourself or import
                        a CSV.
                      </>
                    )}
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
        <Card data-testid="timeline-panel">
          {(() => {
            const detail = rows.find((r) => r.id === expanded);
            return detail !== undefined ? (
              <>
                {/* DA-13: the panel had no heading, so once you found it you
                    still could not tell whose record you were looking at. */}
                <h2 data-testid="details-subject">
                  {detail.name ?? "Player"}{" "}
                  <span className="registration-phone">{detail.number}</span>
                </h2>
                {detail.status === "rejected" && detail.rejectionReason !== null ? (
                  <p className="reg-reason" data-testid="details-reason">
                    Declined — {REASON_LABEL[detail.rejectionReason] ?? detail.rejectionReason}. The
                    player was told this reason.
                  </p>
                ) : null}
                <div className="reg-photo-manage">
                  <PlayerPhotoUploader
                    slug={slug}
                    registrationId={detail.id}
                    playerName={detail.name ?? "Player"}
                    {...(detail.photoUrl !== null ? { currentUrl: detail.photoUrl } : {})}
                  />
                </div>
              </>
            ) : null;
          })()}
          <h3>Timeline</h3>
          <ol className="timeline">
            {timeline.map((entry, index) => (
              <li key={index}>
                <Badge tone="neutral">{TIMELINE_VERB[entry.action] ?? entry.action}</Badge>
                <span className="timeline-at">{formatDateTime(entry.at)}</span>
                <span className="timeline-actor">
                  {entry.actorName !== null ? `by ${entry.actorName}` : "by the system"}
                </span>
                {isNote(entry.meta) ? (
                  <span className="timeline-note">“{entry.meta.note}”</span>
                ) : null}
                {isReason(entry.meta) ? (
                  <span className="timeline-note">
                    Reason: {REASON_LABEL[entry.meta.reason] ?? entry.meta.reason}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="note-row">
            <Field
              label="Add a note"
              name="note"
              value={noteText}
              onChange={(event) => {
                setNoteText(event.target.value);
              }}
              placeholder="Verified via club captain"
            />
            <Button
              size="sm"
              onClick={() => void submitNote(expanded)}
              disabled={noteText.trim() === ""}
            >
              Add note
            </Button>
          </div>
          {teams.length > 0 ? (
            <div className="note-row" data-testid="assign-team-row">
              <Select
                label="Assign to team"
                value={assignTeamId}
                onChange={(event) => {
                  setAssignTeamId(event.target.value);
                }}
              >
                <option value="">Choose a team…</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={assignTeamId === ""}
                data-testid="assign-team"
                onClick={() => {
                  // PX-4: the certified assignTeamAction finally gets a UI —
                  // capability (team.manage) is enforced server-side.
                  void assignTeamAction(slug, expanded, assignTeamId).then((result) => {
                    if (result.ok) {
                      toast({ title: "Assigned to team", tone: "success" });
                      router.refresh();
                    } else {
                      toast({ title: result.error ?? "Assignment failed.", tone: "danger" });
                    }
                  });
                }}
              >
                Assign
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* --- Bulk decline: a destructive act on people you may not be looking
          at now asks first, and names how many and who. --- */}
      <Dialog
        open={confirmBulk === "reject"}
        onClose={() => {
          setConfirmBulk(null);
        }}
        title={`Decline ${String(selected.size)} registration${selected.size === 1 ? "" : "s"}?`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmBulk(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={rejectReason === ""}
              data-testid="confirm-bulk-reject"
              onClick={() => void runBulk("reject")}
            >
              Decline {selected.size}
            </Button>
          </>
        }
      >
        <p>
          This tells {selected.size} {selected.size === 1 ? "person" : "people"} their registration
          was not approved, and sends each of them the reason you choose. There is no undo — a
          declined registration can only be put back with Restore.
        </p>
        {offPage > 0 ? (
          <p role="alert" className="reg-warning">
            <strong>{offPage} of them are not shown on this page.</strong> Use “Review selection” to
            see everyone this will affect.
          </p>
        ) : null}
        <Select
          label="Reason (the player is told this)"
          name="reason"
          value={rejectReason}
          onChange={(event) => {
            setRejectReason(event.target.value);
          }}
        >
          <option value="">Choose a reason…</option>
          {REJECTION_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {REASON_LABEL[reason] ?? reason}
            </option>
          ))}
        </Select>
      </Dialog>

      {/* --- Review selection: the selection made inspectable. --- */}
      <Dialog
        open={reviewOpen}
        onClose={() => {
          setReviewOpen(false);
        }}
        title={`${String(selected.size)} selected`}
        size="wide"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setSelected(new Map());
                setReviewOpen(false);
              }}
            >
              Clear selection
            </Button>
            <Button
              onClick={() => {
                setReviewOpen(false);
              }}
            >
              Done
            </Button>
          </>
        }
      >
        <p>Everyone a bulk action would affect, including rows on other pages.</p>
        <ul className="selection-list" data-testid="selection-list">
          {[...selected.values()].map((pick) => (
            <li key={pick.id}>
              <span>{pick.name ?? "Unnamed"}</span>
              <span className="reg-number">{pick.number}</span>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setSelected((prev) => {
                    const next = new Map(prev);
                    next.delete(pick.id);
                    return next;
                  });
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Dialog>

      {/* --- Per-row decline: the two outcomes that used to be reachable only
          through a 13px checkbox and a scroll back up to the bulk bar. --- */}
      <Dialog
        open={rowDecline !== null}
        onClose={() => {
          setRowDecline(null);
        }}
        title={`Decline ${rowDecline?.name ?? "this registration"}?`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRowDecline(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={rejectReason === ""}
              data-testid="confirm-row-decline"
              onClick={() => {
                if (rowDecline !== null) {
                  void runSingle(rowDecline, "reject", rejectReason, `decline-${rowDecline.id}`);
                }
              }}
            >
              Decline
            </Button>
          </>
        }
      >
        <p>
          {rowDecline?.name ?? "This player"} is told their registration was not approved, with the
          reason you choose. Restore is the only way back.
        </p>
        <Select
          label="Reason (the player is told this)"
          name="row-reason"
          value={rejectReason}
          onChange={(event) => {
            setRejectReason(event.target.value);
          }}
        >
          <option value="">Choose a reason…</option>
          {REJECTION_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {REASON_LABEL[reason] ?? reason}
            </option>
          ))}
        </Select>
      </Dialog>

      {/* --- Marking an Icon changes what auction night contains. It says so
          before it happens, once, at the point of use. --- */}
      <Dialog
        open={iconConfirm !== null}
        onClose={() => {
          setIconConfirm(null);
        }}
        title={`Mark ${iconConfirm?.name ?? "this player"} as an Icon?`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setIconConfirm(null);
              }}
            >
              Cancel
            </Button>
            <Button
              data-testid="confirm-icon"
              onClick={() => {
                const target = iconConfirm;
                setIconConfirm(null);
                if (target !== null) {
                  restoreFocusRef.current = `icon-${target.id}`;
                  void markRegistrationAction(slug, target.id, { isIcon: true }).then((result) => {
                    if (!result.ok) {
                      toast({
                        title: result.error ?? "That mark could not be set.",
                        tone: "danger",
                      });
                      return;
                    }
                    toast({
                      title:
                        target.teamId === null
                          ? `${target.name ?? target.number} is an Icon — assign them a team`
                          : `${target.name ?? target.number} is an Icon`,
                      tone: target.teamId === null ? "danger" : "success",
                    });
                    router.refresh();
                  });
                }
              }}
            >
              Mark as Icon
            </Button>
          </>
        }
      >
        <p>
          An Icon is pre-signed to a team instead of being bid for. They leave the auction pool —
          the auction will have one fewer player on the block — and they join their team&apos;s
          squad directly.
        </p>
        {iconConfirm?.teamId === null ? (
          <p role="alert" className="reg-warning">
            <strong>{iconConfirm.name ?? "This player"} has no team.</strong> An Icon is only
            counted into a squad through their team, so until you assign one they will be in no
            auction and no squad at all.
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={ioOpen}
        onClose={() => {
          setIoOpen(false);
        }}
        title="Import players & photos"
        size="wide"
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setIoOpen(false);
            }}
          >
            Close
          </Button>
        }
      >
        {!registrationOpen ? (
          <p role="alert" className="reg-warning" data-testid="import-closed-note">
            Registration is closed for this season. Players you add here are entered by you as the
            organizer — they still pass the same approval gate.
          </p>
        ) : null}
        <Tabs
          label="Import kind"
          tabs={[
            {
              id: "csv",
              label: "Players (CSV)",
              content: (
                <div className="io-panel" data-testid="io-panel">
                  <label className="io-file" htmlFor="csv-input">
                    <span>
                      Paste or choose a CSV — columns: name, phone, role, base_price_band ·
                      optional: date_of_birth, batting_style, bowling_style
                    </span>
                  </label>
                  <textarea
                    id="csv-input"
                    ref={csvRef}
                    className="csv-input"
                    data-testid="import-textarea"
                    rows={5}
                    placeholder="Paste CSV rows here, or choose a file"
                    defaultValue=""
                  />
                  <div className="io-row">
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      aria-label="Choose a CSV file"
                      data-testid="import-file"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          readCsvFile(file);
                        }
                      }}
                    />
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
                        <>
                          <ul className="import-errors">
                            {preview.errors.slice(0, 8).map((error, index) => (
                              <li key={index}>
                                Line {error.line}: {error.message}
                              </li>
                            ))}
                          </ul>
                          {preview.errors.length > 8 ? (
                            <p className="dash-hint">
                              and {preview.errors.length - 8} more error
                              {preview.errors.length - 8 === 1 ? "" : "s"} not listed here.
                            </p>
                          ) : null}
                        </>
                      ) : null}
                      <Button
                        onClick={() => void commitImport()}
                        loading={busy}
                        disabled={preview.errors.length > 0 || preview.validCount === 0}
                        data-testid="import-commit"
                      >
                        {/* DA-26: the button read "Import 2 player(s)" while disabled
                            because four OTHER rows had errors, so it named the wrong
                            number and never said what was blocking it. */}
                        {preview.errors.length > 0
                          ? `Fix ${String(preview.errors.length)} error${preview.errors.length === 1 ? "" : "s"} to import`
                          : preview.validCount === 0
                            ? "Nothing to import"
                            : `Import ${String(preview.validCount)} player${preview.validCount === 1 ? "" : "s"}`}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              id: "photos",
              label: "Photos",
              content: (
                <PhotoImportPanel
                  slug={slug}
                  onDone={() => {
                    setIoOpen(false);
                  }}
                />
              ),
            },
          ]}
        />
      </Dialog>
    </>
  );
}

function StatTile({
  label,
  value,
  testId,
  onSelect,
  active,
  hint,
}: {
  label: string;
  value: number;
  testId: string;
  /** PX-4: tiles double as one-click status views (URL-backed, shareable). */
  onSelect?: () => void;
  active?: boolean;
  /** A figure that is DERIVED says how, where it is read. */
  hint?: string;
}) {
  const tile = (
    <div className="stat-tile" data-testid={testId}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint !== undefined ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
  if (onSelect === undefined) {
    return tile;
  }
  return (
    <button
      type="button"
      className="stat-tile-link"
      data-active={active === true}
      aria-pressed={active === true}
      aria-label={`Filter: ${label}`}
      onClick={onSelect}
    >
      {tile}
    </button>
  );
}

function isNote(meta: unknown): meta is { note: string } {
  return (
    typeof meta === "object" &&
    meta !== null &&
    typeof (meta as { note?: unknown }).note === "string"
  );
}

function isReason(meta: unknown): meta is { reason: string } {
  return (
    typeof meta === "object" &&
    meta !== null &&
    typeof (meta as { reason?: unknown }).reason === "string"
  );
}

function RegRow({
  row,
  active,
  checked,
  onToggle,
  onDetails,
  onApprove,
  onWaitlist,
  onDecline,
  onIcon,
  onCaptain,
  busy,
}: {
  row: Row;
  active: boolean;
  checked: boolean;
  onToggle: () => void;
  onDetails: () => void;
  onApprove: () => void;
  onWaitlist: () => void;
  onDecline: () => void;
  onIcon: () => void;
  onCaptain: () => void;
  busy: boolean;
}) {
  const canTriage = row.status === "submitted" || row.status === "waitlisted";
  return (
    <tr
      className={active ? "reg-row active" : "reg-row"}
      data-testid={`reg-${row.personId}`}
      data-cursor={active ? "true" : undefined}
    >
      <td data-label="Select">
        <input
          type="checkbox"
          className="reg-check"
          aria-label={`Select ${row.name ?? formatPhone(row.phone)}`}
          checked={checked}
          onChange={onToggle}
        />
      </td>
      <td className="reg-number" data-label="Number">
        {row.number}
      </td>
      <td data-label="Player">
        <div className="reg-identity">
          <PlayerImage
            name={row.name ?? "Player"}
            seed={row.personId}
            size="sm"
            {...(row.photoUrl !== null ? { src: row.photoUrl } : {})}
          />
          <div className="reg-identity-text">
            <span className="registration-name">
              {row.name ?? "Unnamed"}
              {row.isCaptain ? (
                <Badge tone="info" data-testid="captain-flag">
                  Captain
                </Badge>
              ) : null}
              {row.isIcon ? (
                <Badge tone="success" data-testid="icon-flag">
                  Icon · not in the pool
                </Badge>
              ) : null}
            </span>
            {/* DA-35: the fourth screen to echo raw E.164 back at a human. */}
            <span className="registration-phone">{formatPhone(row.phone)}</span>
            {row.duplicateName ? (
              <Badge tone="warning" data-testid="dup-flag">
                possible duplicate
              </Badge>
            ) : null}
          </div>
        </div>
      </td>
      <td data-label="Role">
        {row.role.replace(/_/g, " ")}
        {row.age !== null ? <span className="reg-sub">{row.age} yrs</span> : null}
        {row.battingStyle !== null || row.bowlingStyle !== null ? (
          <span className="reg-sub">
            {[row.battingStyle, row.bowlingStyle]
              .filter((s): s is string => s !== null)
              .map((s) => s.replace(/_/g, " "))
              .join(" · ")}
          </span>
        ) : null}
      </td>
      <td data-label="Status">
        <Badge tone={REG_TONE[row.status]}>
          {row.status === "rejected" ? "declined" : row.status}
        </Badge>
        {/* The reason was queried, shipped in every row payload, and rendered
            in no place at all. */}
        {row.status === "rejected" && row.rejectionReason !== null ? (
          <span className="reg-sub" data-testid={`reason-${row.personId}`}>
            {REASON_LABEL[row.rejectionReason] ?? row.rejectionReason}
          </span>
        ) : null}
      </td>
      <td data-label="Team">
        {row.teamName ?? "—"}
        {row.isIcon && row.teamId === null ? (
          <span className="reg-sub reg-sub-warning">Icon with no team</span>
        ) : null}
      </td>
      <td className="reg-actions" data-label="Actions">
        {canTriage ? (
          <>
            <Button
              size="sm"
              onClick={onApprove}
              loading={busy}
              data-focus-key={`approve-${row.id}`}
            >
              Approve
            </Button>
            {row.status === "submitted" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={onWaitlist}
                loading={busy}
                data-focus-key={`waitlist-${row.id}`}
                data-testid={`waitlist-${row.personId}`}
              >
                Waitlist
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={onDecline}
              data-focus-key={`decline-${row.id}`}
              data-testid={`decline-${row.personId}`}
            >
              Decline
            </Button>
          </>
        ) : null}
        {/* Icon and Captain are mutually exclusive: an Icon is pre-signed and
            never goes under the hammer, a Captain leads a squad that plays.
            The server refuses the combination; the button says so first rather
            than letting the click fail. */}
        <Button
          size="sm"
          variant={row.isIcon ? "secondary" : "ghost"}
          onClick={onIcon}
          aria-pressed={row.isIcon}
          disabled={row.isCaptain}
          title={
            row.isCaptain
              ? "Can't be an Icon: they're the Captain, and a Captain leads a squad that plays. An Icon is pre-signed and never goes to the auction. Clear Captain first."
              : row.isIcon
                ? "Icon: pre-signed to their team, not in the auction pool. Click to put them back in the pool."
                : "Mark as Icon: pre-signed to their team instead of going to the auction."
          }
          data-focus-key={`icon-${row.id}`}
          data-testid={`icon-toggle-${row.personId}`}
        >
          {row.isIcon ? "Icon ✓" : "Icon"}
        </Button>
        <Button
          size="sm"
          variant={row.isCaptain ? "secondary" : "ghost"}
          onClick={onCaptain}
          aria-pressed={row.isCaptain}
          disabled={row.isIcon}
          title={
            row.isIcon
              ? "Can't be Captain: they're an Icon, pre-signed to their team and never in the auction. Clear Icon first."
              : "Captain: wears the armband for their team. One per team."
          }
          data-focus-key={`captain-${row.id}`}
          data-testid={`captain-toggle-${row.personId}`}
        >
          {row.isCaptain ? "Captain ✓" : "Captain"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDetails}>
          Details
        </Button>
      </td>
    </tr>
  );
}
