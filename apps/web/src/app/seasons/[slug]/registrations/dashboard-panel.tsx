"use client";

import {
  REJECTION_REASONS,
  REQUIRED_IMPORT_FIELDS,
  mappingOf,
  type ColumnMapping,
  type DateOrder,
} from "@desiauction/core";
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
  importInspectAction,
  importPreviewAction,
  saveImportMappingAction,
  markRegistrationAction,
  personHistoryAction,
  registrationTimelineAction,
  selectAllMatchingAction,
  triageRegistrationAction,
  type ImportPreview,
  type ImportInspection,
  type ImportShape,
  type RegistrationDashboard,
  type TriageAction,
} from "../../../../server/competition/actions";
import { AddPlayerDialog } from "./add-player-dialog";
import { ColumnMapper } from "./column-mapper";
import { PhotoImportPanel } from "./photo-import";
import { PlayerPhotoUploader } from "./player-photo-uploader";
import { formatDateTime } from "../../../../lib/format-date";
import { formatPhone } from "../../../../lib/format-phone";
import type {
  OrphanPreSigned,
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

/**
 * How the auction pool is arrived at, so the tile can be checked by eye.
 *
 * Both pre-signed marks subtract, and naming only the one that happens to be
 * set leaves a reader doing arithmetic that does not come out.
 */
function poolHint(stats: RegistrationStats): string {
  const terms: string[] = [];
  if (stats.icons > 0) {
    terms.push(`${String(stats.icons)} icon${stats.icons === 1 ? "" : "s"}`);
  }
  if (stats.retained > 0) {
    terms.push(`${String(stats.retained)} retained`);
  }
  return terms.length === 0
    ? "Approved players who go to the block"
    : `${String(stats.approved)} approved − ${terms.join(" − ")}`;
}

export function RegistrationDashboardPanel({
  slug,
  stats,
  page,
  teams,
  filters,
  orphanPreSigned,
  roles,
  registrationOpen,
  categoryFlags = {},
}: {
  slug: string;
  stats: RegistrationStats;
  page: RegistrationPage;
  teams: NonNullable<RegistrationDashboard["teams"]>;
  filters: { search: string; status: string; team: string; sort: string };
  orphanPreSigned: OrphanPreSigned[];
  /** The season's own roles — the add dialog offered cricket's to every sport. */
  roles: readonly { key: string; label: string }[];
  registrationOpen: boolean;
  /** PI-1: organizer-channel category advisories, keyed by registration id. */
  categoryFlags?: NonNullable<RegistrationDashboard["categoryFlags"]>;
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
  // PI-1: the person's other seasons in this org, shown in the details drawer.
  const [history, setHistory] = useState<
    { competitionName: string; startsOn: string | null; status: string }[]
  >([]);
  const [noteText, setNoteText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  /* The mapping step. `inspection` null = we have not read the file's headers
     yet, which is the state the dialog opens in. */
  const [inspection, setInspection] = useState<ImportInspection | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>("dmy");
  const [remember, setRemember] = useState(true);
  /* Fill blanks by default — a re-import must not silently revert a correction
     somebody made by hand in the app. `file-wins` is an explicit choice. */
  const [fileWins, setFileWins] = useState(false);
  const [usingSaved, setUsingSaved] = useState(false);
  const [ioOpen, setIoOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState<TriageAction | null>(null);
  const [rowDecline, setRowDecline] = useState<Row | null>(null);
  /**
   * The SEASON's role labels. `roleLabel` asks cricket and falls back to the
   * key with its underscores swapped, so a football roster read "midfielder"
   * lower-cased in a column of Title Case.
   */
  const labelOf = useMemo(() => {
    const byKey = new Map(roles.map((role) => [role.key, role.label]));
    return (role: string | null): string =>
      role === null ? "" : (byKey.get(role) ?? role.replace(/_/g, " "));
  }, [roles]);
  const [iconConfirm, setIconConfirm] = useState<Row | null>(null);
  const [retainConfirm, setRetainConfirm] = useState<Row | null>(null);
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
    // PI-1: the timeline and the person's in-club history arrive together —
    // two independent reads, one paint.
    const [timelineRows, historyRows] = await Promise.all([
      registrationTimelineAction(slug, id),
      personHistoryAction(slug, id),
    ]);
    setTimeline(timelineRows);
    setHistory(historyRows);
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

  const resetImport = () => {
    setPreview(null);
    setInspection(null);
    setMapping({});
    setUsingSaved(false);
  };

  const readCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (csvRef.current) {
        csvRef.current.value = typeof reader.result === "string" ? reader.result : "";
      }
      resetImport();
    };
    reader.readAsText(file);
  };

  const shape = (): ImportShape => ({
    mapping,
    dateOrder,
    policy: fileWins ? "file-wins" : "fill-blanks",
  });

  /**
   * ONE BUTTON, AND THE MAPPING IS ALWAYS ON SCREEN BEFORE THE COMMIT IS.
   *
   * The first press reads the file's headers, settles on a mapping — one this
   * club already confirmed for this exact layout if there is one, otherwise the
   * detected guess — and validates under it. Later presses re-validate under
   * whatever the organizer has since corrected.
   *
   * Deliberately not a separate "read the file" step. For a file whose headers
   * are already ours (our own export, round-tripped) a mapping step would be
   * pure friction, and for a foreign file the mapper renders right here beside
   * the preview — so the translation is visible and correctable BEFORE anything
   * is written, which is the property that actually matters.
   */
  const runPreview = async () => {
    const text = csvRef.current?.value ?? "";
    if (text.trim() === "") {
      return;
    }
    let active = mapping;
    if (inspection === null) {
      const read = await importInspectAction(slug, text);
      setInspection(read);
      if (!read.ok) {
        setMapping({});
        setPreview(null);
        return;
      }
      if (read.saved !== undefined) {
        active = read.saved.mapping;
        setDateOrder(read.saved.dateOrder);
        setUsingSaved(true);
      } else {
        active = read.detected === undefined ? {} : mappingOf(read.detected);
        setUsingSaved(false);
      }
      setMapping(active);
      // A file missing a required column cannot be previewed into anything
      // useful; the mapper below says which, which is the actionable answer.
      if (REQUIRED_IMPORT_FIELDS.some((field) => active[field] === undefined)) {
        setPreview(null);
        return;
      }
    }
    setPreview(
      await importPreviewAction(slug, text, {
        mapping: active,
        dateOrder,
        policy: fileWins ? "file-wins" : "fill-blanks",
      }),
    );
  };

  /**
   * `skipInvalid` is the organizer's explicit choice, taken on the button they
   * pressed — never a default. A clean file commits whole; a file with errors
   * commits only when they pressed the button that says how many it will leave
   * behind, and those rows stay listed underneath by line number.
   */
  const commitImport = async (skipInvalid = false) => {
    const text = csvRef.current?.value ?? "";
    setBusy(true);
    const result = await importCommitAction(slug, text, { skipInvalid, shape: shape() });
    // Remember the mapping only once the import it describes actually landed —
    // a mapping saved beside a failed import is a mapping nobody validated.
    if (result.ok && remember && inspection?.ok === true && Object.keys(mapping).length > 0) {
      await saveImportMappingAction(slug, {
        signature: inspection.signature,
        label: null,
        mapping,
        valueMaps: {},
        dateOrder,
        scope: "org",
      });
    }
    setBusy(false);
    if (result.ok) {
      // Only the outcomes that happened: a run with nothing reinstated should
      // not report "0 rejoined" as though it were a finding.
      const parts = [`Imported ${String(result.imported ?? 0)}`];
      if ((result.updated ?? 0) > 0) {
        parts.push(`${String(result.updated)} updated`);
      }
      if ((result.reinstated ?? 0) > 0) {
        parts.push(`${String(result.reinstated)} rejoined`);
      }
      if ((result.unchanged ?? 0) > 0) {
        parts.push(`${String(result.unchanged)} unchanged`);
      }
      if ((result.skipped ?? 0) > 0) {
        parts.push(`${String(result.skipped)} skipped`);
      }
      toast({ title: parts.join(" · "), tone: "success" });
      router.refresh();
      if ((result.skipped ?? 0) > 0) {
        // Rows were left behind on purpose. Closing the dialog and wiping the
        // textarea would take away the only copy of WHICH rows, and the whole
        // point of skipping is that the organizer comes back to them.
        setPreview(await importPreviewAction(slug, text));
        return;
      }
      resetImport();
      if (csvRef.current) {
        csvRef.current.value = "";
      }
      setIoOpen(false);
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
        <AddPlayerDialog slug={slug} roles={roles} />
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
            // The subtraction has TWO terms now, and naming only the icons made
            // the arithmetic look wrong the moment anybody was retained:
            // "12 approved − 1 icon" printed beside a pool of 10.
            poolHint(stats)
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
      {orphanPreSigned.length > 0 ? (
        <Card data-testid="orphan-pre-signed-warning">
          <p role="alert" className="reg-warning">
            <strong>
              {orphanPreSigned.length} pre-signed player
              {orphanPreSigned.length === 1 ? " is" : "s are"} in no auction and no squad.
            </strong>{" "}
            An Icon or a retained player joins a team instead of being bid for, so one with no team
            is not in the auction pool and will not appear in any squad. Assign a team, or clear the
            mark to put them back in the pool.
          </p>
          <ul className="reg-warning-list">
            {orphanPreSigned.map((player) => (
              <li key={player.id}>
                {player.name ?? "Unnamed"} <span className="reg-number">{player.number}</span>{" "}
                {/* Which mark stranded them, because the two are cleared by
                    different buttons and "pre-signed" names neither. */}
                <Badge tone={player.kind === "icon" ? "success" : "info"}>
                  {player.kind === "icon" ? "Icon" : "Retained"}
                </Badge>
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
                  categoryFlagged={categoryFlags[row.id] !== undefined}
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
                  onRetain={() => {
                    if (row.isRetained) {
                      restoreFocusRef.current = `retain-${row.id}`;
                      void markRegistrationAction(slug, row.id, { isRetained: false }).then(
                        (result) => {
                          applyMark(result, `${row.name ?? row.number} is no longer retained`);
                        },
                      );
                    } else {
                      setRetainConfirm(row);
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
                  labelOf={labelOf}
                />
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="reg-empty" data-testid="reg-empty">
                    {/* DA-35: one string served two different situations — an
                        empty season and a filter that matched nothing. The
                        first is the START of this screen's life, and blaming a
                        filter that has not been applied is a dead end.

                        THIRD situation, found in review: no filters applied,
                        the tiles count registrations, and the table still has
                        zero rows. `stats.total > 0` used to shove that case
                        into the filter branch, whose "Clear the filters"
                        recovery is a no-op — the mismatch is a data problem
                        (rows whose person no longer resolves), not a filter
                        problem, and the message must not lie about it. */}
                    {!filtersApplied && stats.total > 0 ? (
                      <>
                        <strong>
                          {stats.total} registration{stats.total === 1 ? "" : "s"} exist
                          {stats.total === 1 ? "s" : ""} but none can be displayed.
                        </strong>{" "}
                        This usually means the underlying player records are incomplete — contact
                        support with this season&rsquo;s name.
                      </>
                    ) : filtersApplied ? (
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
                {/* HOW THEY PLAY.
                    On a phone the row card drops the Role cell — role, age and
                    the two playing styles — to keep the list scannable. That is
                    only honest if the facts are somewhere, and this is where.
                    They render at every width: a desktop reader who has the
                    column anyway loses nothing by seeing it confirmed here, and
                    a phone reader is one tap from the whole record rather than
                    from a gap. */}
                <dl className="details-facts" data-testid="details-facts">
                  <div>
                    <dt>Role</dt>
                    <dd>{labelOf(detail.role)}</dd>
                  </div>
                  {detail.age !== null ? (
                    <div>
                      <dt>Age</dt>
                      <dd>{detail.age} yrs</dd>
                    </div>
                  ) : null}
                  {detail.battingStyle !== null ? (
                    <div>
                      <dt>Batting</dt>
                      <dd>{detail.battingStyle.replace(/_/g, " ")}</dd>
                    </div>
                  ) : null}
                  {detail.bowlingStyle !== null ? (
                    <div>
                      <dt>Bowling</dt>
                      <dd>{detail.bowlingStyle.replace(/_/g, " ")}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Team</dt>
                    <dd>{detail.teamName ?? "—"}</dd>
                  </div>
                </dl>
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
          {/* PI-1: welcome-back context — the club's own records only. */}
          {history.length > 0 ? (
            <>
              <h3>Seen before in your club</h3>
              <ul className="reg-person-history" data-testid="person-history">
                {history.map((season, index) => (
                  <li key={index}>
                    {season.competitionName}
                    {season.startsOn !== null ? ` · ${season.startsOn.slice(0, 4)}` : ""}
                    {" · "}
                    {season.status}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
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

      {/* --- Retention removes a player from the night exactly as an Icon
          mark does, so it asks exactly as loudly. --- */}
      <Dialog
        open={retainConfirm !== null}
        onClose={() => {
          setRetainConfirm(null);
        }}
        title={`Retain ${retainConfirm?.name ?? "this player"} from a prior season?`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRetainConfirm(null);
              }}
            >
              Cancel
            </Button>
            <Button
              data-testid="confirm-retain"
              onClick={() => {
                const target = retainConfirm;
                setRetainConfirm(null);
                if (target !== null) {
                  restoreFocusRef.current = `retain-${target.id}`;
                  void markRegistrationAction(slug, target.id, { isRetained: true }).then(
                    (result) => {
                      if (!result.ok) {
                        toast({
                          title: result.error ?? "That mark could not be set.",
                          tone: "danger",
                        });
                        return;
                      }
                      // A retained player with no team is in no auction and no
                      // squad, so the toast that follows the click is where the
                      // organizer finds that out — not the warning card they
                      // may scroll past.
                      toast({
                        title:
                          target.teamId === null
                            ? `${target.name ?? target.number} is retained — assign them a team`
                            : `${target.name ?? target.number} is retained`,
                        tone: target.teamId === null ? "danger" : "success",
                      });
                      router.refresh();
                    },
                  );
                }
              }}
            >
              Retain
            </Button>
          </>
        }
      >
        <p>
          A retained player is kept from a prior season and joins their team directly instead of
          being bid for. They leave the auction pool — the auction will have one fewer player on the
          block — and they take up one of their team&apos;s squad slots.
        </p>
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
                    <Button
                      onClick={() => void runPreview()}
                      disabled={
                        inspection !== null &&
                        REQUIRED_IMPORT_FIELDS.some((field) => mapping[field] === undefined)
                      }
                      data-testid="import-preview-btn"
                    >
                      Preview
                    </Button>
                  </div>

                  {inspection !== null && !inspection.ok ? (
                    <p role="alert" className="reg-warning">
                      {inspection.error ?? "That file could not be read."}
                    </p>
                  ) : null}

                  {inspection !== null && inspection.ok ? (
                    <>
                      {usingSaved ? (
                        <p className="dash-hint" data-testid="mapping-saved-note">
                          Using the mapping you saved for this form. Change anything below and the
                          new version replaces it.
                        </p>
                      ) : null}
                      <ColumnMapper
                        inspection={inspection}
                        mapping={mapping}
                        onChange={(next) => {
                          setMapping(next);
                          // The preview describes the OLD mapping the moment
                          // the mapping changes; showing it on would be a lie.
                          setPreview(null);
                        }}
                      />
                      <div className="io-row">
                        <label className="io-inline" htmlFor="date-order">
                          <span>Dates in this file read as</span>
                          <select
                            id="date-order"
                            className="mapping-select"
                            data-testid="date-order"
                            value={dateOrder}
                            onChange={(event) => {
                              setDateOrder(event.target.value === "mdy" ? "mdy" : "dmy");
                              setPreview(null);
                            }}
                          >
                            <option value="dmy">day / month / year</option>
                            <option value="mdy">month / day / year</option>
                          </select>
                        </label>
                        <label className="io-inline" htmlFor="file-wins">
                          <input
                            id="file-wins"
                            type="checkbox"
                            data-testid="file-wins"
                            checked={fileWins}
                            onChange={(event) => {
                              setFileWins(event.target.checked);
                              // The preview described the other policy.
                              setPreview(null);
                            }}
                          />
                          <span>Let this file overwrite values already entered</span>
                        </label>
                        <label className="io-inline" htmlFor="remember-mapping">
                          <input
                            id="remember-mapping"
                            type="checkbox"
                            data-testid="remember-mapping"
                            checked={remember}
                            onChange={(event) => {
                              setRemember(event.target.checked);
                            }}
                          />
                          <span>Remember this mapping for next time</span>
                        </label>
                      </div>
                    </>
                  ) : null}
                  {preview !== null ? (
                    <div className="import-preview" data-testid="import-preview">
                      <p>
                        {preview.validCount} valid row(s) · {preview.errors.length} error(s)
                      </p>
                      {/* WHAT COMMITTING WOULD ACTUALLY DO. "197 valid rows" said
                          the same thing whether they were all new or all already
                          here — and the commit then silently did nothing with the
                          second case. */}
                      {preview.diff !== undefined ? (
                        <p data-testid="import-diff-counts">
                          <strong>{preview.diff.counts.new} new</strong>
                          {" · "}
                          <strong>{preview.diff.counts.changed} changed</strong>
                          {" · "}
                          {preview.diff.counts.unchanged} unchanged
                          {preview.diff.counts.reinstate > 0
                            ? ` · ${String(preview.diff.counts.reinstate)} rejoining`
                            : ""}
                        </p>
                      ) : null}
                      {preview.diff !== undefined && preview.diff.changes.length > 0 ? (
                        <div className="table-scroll">
                          <table className="reg-table" data-testid="import-diff-table">
                            <thead>
                              <tr>
                                <th>Player</th>
                                <th>Field</th>
                                <th>Now</th>
                                <th>After import</th>
                              </tr>
                            </thead>
                            <tbody>
                              {preview.diff.changes.flatMap((row) =>
                                row.fields.map((field, index) => (
                                  <tr key={`${String(row.line)}-${field.label}`}>
                                    <td data-label="Player">{index === 0 ? row.name : ""}</td>
                                    <td data-label="Field">{field.label}</td>
                                    <td data-label="Now" className="mapping-sample">
                                      {field.from}
                                    </td>
                                    <td data-label="After import" className="mapping-sample">
                                      {field.to}
                                    </td>
                                  </tr>
                                )),
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      {preview.diff !== undefined &&
                      preview.diff.counts.changed + preview.diff.counts.reinstate >
                        preview.diff.changes.length ? (
                        <p className="dash-hint">
                          Showing the first {preview.diff.changes.length}. The counts above cover
                          every row.
                        </p>
                      ) : null}
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
                      {/* A file with errors AND valid rows now has a way forward.
                          The button states the whole bargain — what lands and what
                          is left — so "skip" is a choice the organizer read, not a
                          default they were given. */}
                      {preview.errors.length > 0 && preview.validCount > 0 ? (
                        <Button
                          onClick={() => void commitImport(true)}
                          loading={busy}
                          data-testid="import-commit-partial"
                        >
                          {`Import ${String(preview.validCount)} valid, skip ${String(preview.errors.length)}`}
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => void commitImport()}
                        loading={busy}
                        variant={preview.errors.length > 0 ? "ghost" : "primary"}
                        disabled={preview.errors.length > 0 || preview.validCount === 0}
                        data-testid="import-commit"
                      >
                        {/* DA-26: the button read "Import 2 player(s)" while disabled
                            because four OTHER rows had errors, so it named the wrong
                            number and never said what was blocking it. */}
                        {preview.errors.length > 0
                          ? `Fix ${String(preview.errors.length)} error${preview.errors.length === 1 ? "" : "s"} to import all`
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
  categoryFlagged,
  onToggle,
  onDetails,
  onApprove,
  onWaitlist,
  onDecline,
  onIcon,
  onRetain,
  onCaptain,
  labelOf,
  busy,
}: {
  row: Row;
  active: boolean;
  checked: boolean;
  /** PI-1: the eligibility engine's organizer advisory — flag, never block. */
  categoryFlagged: boolean;
  onToggle: () => void;
  onDetails: () => void;
  onApprove: () => void;
  onWaitlist: () => void;
  onDecline: () => void;
  onIcon: () => void;
  onRetain: () => void;
  onCaptain: () => void;
  labelOf: (role: string | null) => string;
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
              {row.isRetained ? (
                <Badge tone="info" data-testid="retained-flag">
                  Retained · not in the pool
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
            {categoryFlagged ? (
              // PI-1: the season declares a gendered category and this
              // person's own profile says otherwise. The engine flags; the
              // organizer — who may know better — decides (invariant 5).
              <Badge tone="warning" data-testid="category-flag">
                check entry category
              </Badge>
            ) : null}
          </div>
        </div>
      </td>
      <td data-label="Role">
        {labelOf(row.role)}
        {row.age !== null ? <span className="reg-sub">{row.age} yrs</span> : null}
        {/* Its own class because the phone hides THIS and not the role or the
            age beside it: how somebody bats is what you read once you have
            decided they are worth a second look, and it lives in Details there.
            `.reg-sub` alone could not say which of the two sub-lines it was. */}
        {row.battingStyle !== null || row.bowlingStyle !== null ? (
          <span className="reg-sub reg-styles">
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
        {(row.isIcon || row.isRetained) && row.teamId === null ? (
          <span className="reg-sub reg-sub-warning">
            {row.isIcon ? "Icon" : "Retained"} with no team
          </span>
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
        {/* Retention is NOT exclusive with either of its neighbours, and the
            button says so by never being disabled. You retain last season's
            captain — the commonest retention there is — and a marquee player
            kept from last year is honestly both. See `setRegistrationMarks`. */}
        <Button
          size="sm"
          variant={row.isRetained ? "secondary" : "ghost"}
          onClick={onRetain}
          aria-pressed={row.isRetained}
          title={
            row.isRetained
              ? "Retained from a prior season: joins their team directly, not in the auction pool. Click to put them back in the pool."
              : "Retain: kept from a prior season, joins their team instead of going to the auction."
          }
          data-focus-key={`retain-${row.id}`}
          data-testid={`retain-toggle-${row.personId}`}
        >
          {row.isRetained ? "Retained ✓" : "Retain"}
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
