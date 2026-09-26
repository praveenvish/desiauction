"use client";

import { formatPaiseINR, FEE_STATUSES, paise } from "@desiauction/core";
import {
  Badge,
  Button,
  ButtonLink,
  Dialog,
  EmptyState,
  FilterMenu,
  IconAlert,
  IconArrowRight,
  IconCrown,
  IconDownload,
  IconFilter,
  IconGavel,
  IconKebab,
  IconLock,
  IconRefresh,
  IconSearch,
  IconStar,
  IconUpload,
  IconUsers,
  IconWallet,
  type KitTone,
  Pager,
  Pill,
  PlayerImage,
  PopoverMenu,
  SectionCard,
  SegmentedTabs,
  TeamChip,
  Toolbar,
  ToolbarChip,
  ToolbarSpacer,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { formatDate } from "../../../../lib/format-date";
import { personContact, personLabel } from "../../../../lib/person-label";
import { useHydrated } from "../../../../lib/use-hydrated";
import {
  advanceCompetitionAction,
  bulkTriageAction,
  registrationDetailAction,
  selectAllMatchingAction,
  triageRegistrationAction,
  type RegistrationDashboard,
  type TriageAction,
} from "../../../../server/competition/actions";
import type { PlayerDeskContext } from "../../../../server/competition/player-desk";
import type {
  KitSizeCount,
  KitSummary,
  OrphanPreSigned,
  RegistrationPage,
  RegistrationStats,
} from "../../../../server/competition/registrations";
import { DeclineDialog } from "../_players/decline-dialog";
import { ExportDialog } from "../_players/export-dialog";
import { canTriage, FEE_LABEL, PAST_TENSE, REASON_LABEL, type Row } from "../_players/labels";
import { decisionToast, PlayerSheet } from "../_players/player-sheet";
import { useMutate } from "../_players/use-mutate";
import { useRoster } from "../_players/use-roster";
import { AddPlayerDialog } from "./add-player-dialog";
import { ImportDialog } from "./import-dialog";
import "../_players/players-desk.css";

const SORTS = ["recent", "oldest", "name", "number", "status"];
const SORT_LABEL: Record<string, string> = {
  recent: "Newest first",
  oldest: "Oldest first",
  name: "Name",
  number: "Registration number",
  status: "Status",
};

/** A row the organizer has selected — remembered by identity, not by index, so
 * it can be named on a page it is no longer displayed on. */
interface Picked {
  id: string;
  number: string;
  name: string | null;
}

/**
 * What the desk still has to chase, and what it has taken.
 *
 * The outstanding COUNT leads, because that is the number an organizer acts on;
 * the money is the number they report. Waived and refunded are named only when
 * they exist, so an ordinary season's tile stays two facts long.
 */
function feeHint(stats: RegistrationStats): string {
  const parts: string[] = [];
  if (stats.fees.pending > 0) {
    parts.push(`${String(stats.fees.pending)} not paid`);
  }
  if (stats.fees.waived > 0) {
    parts.push(`${String(stats.fees.waived)} waived`);
  }
  if (stats.fees.refunded > 0) {
    parts.push(`${String(stats.fees.refunded)} refunded`);
  }
  if (stats.feeCollectedPaise > 0) {
    // rupees-always: registration fees are real money in every season
    parts.push(`${formatPaiseINR(paise(stats.feeCollectedPaise))} in`);
  }
  return parts.length === 0 ? "Entry fees recorded at the desk" : parts.join(" · ");
}

/**
 * How the auction pool is arrived at, so the tile can be checked by eye. Every
 * pre-signing mark subtracts, and naming only the ones that happen to be set
 * keeps the line short without leaving arithmetic that does not come out.
 */
function poolHint(stats: RegistrationStats): string {
  const terms: string[] = [];
  if (stats.icons > 0) {
    terms.push(`${String(stats.icons)} icon${stats.icons === 1 ? "" : "s"}`);
  }
  if (stats.captains > 0) {
    terms.push(`${String(stats.captains)} captain${stats.captains === 1 ? "" : "s"}`);
  }
  if (stats.retained > 0) {
    terms.push(`${String(stats.retained)} retained`);
  }
  return terms.length === 0
    ? "Approved players who go to the block"
    : `${String(stats.approved)} approved − ${terms.join(" − ")}`;
}

interface Filters {
  search: string;
  status: string;
  fee: string;
  team: string;
  role: string;
  sort: string;
}

export function RegistrationDashboardPanel({
  slug,
  stats,
  page,
  teams,
  filters,
  orphanPreSigned,
  kit,
  desk,
  registrationOpen,
  categoryFlags = {},
  initialPlayerId,
  startReview = false,
  share,
  canReopen = false,
}: {
  slug: string;
  stats: RegistrationStats;
  page: RegistrationPage;
  teams: NonNullable<RegistrationDashboard["teams"]>;
  filters: Filters;
  orphanPreSigned: OrphanPreSigned[];
  /** What to order, once sizes exist — see `kitSummary`. */
  kit?: KitSummary;
  desk: PlayerDeskContext;
  registrationOpen: boolean;
  /** PI-1: organizer-channel category advisories, keyed by registration id. */
  categoryFlags?: NonNullable<RegistrationDashboard["categoryFlags"]>;
  /** `?player=` — a sheet linked to directly opens on arrival. */
  initialPlayerId?: string;
  /** `?review=1` — "Start reviewing" landed here after filtering. */
  startReview?: boolean;
  /** The registration link, under the page head. */
  share?: ReactNode;
  /** Closed, the viewer may advance the season, and the auction has not begun. */
  canReopen?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const [navigating, startNavigation] = useTransition();
  const roster = useRoster(page.rows);
  const mutate = useMutate(roster);
  const rows = roster.rows;
  /*
   * DOES THIS SEASON TAKE ENTRY FEES AT ALL? Nothing in the schema says so, so
   * it is read from the desk's own record: any payment, waiver or refund, any
   * money collected, or any amount written against a row. A free league has
   * none of those, and used to show every player an amber "Not paid" and a
   * "Fees paid 0" tile — forty-three unpaid bills for a fee that does not
   * exist. With no fee on record the column reads "—" and the tile is absent.
   */
  const feesInUse =
    stats.fees.paid + stats.fees.waived + stats.fees.refunded > 0 ||
    stats.feeCollectedPaise > 0 ||
    rows.some((row) => row.feeAmountPaise !== null);

  const [selected, setSelected] = useState<Map<string, Picked>>(new Map());
  const [bulkBusy, setBulkBusy] = useState<TriageAction | "select" | null>(null);
  const [approveAllOpen, setApproveAllOpen] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [search, setSearch] = useState(filters.search);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [bulkDecline, setBulkDecline] = useState(false);
  const [declining, setDeclining] = useState<Row | null>(null);

  /* --- The sheet ------------------------------------------------------ */
  const [sheetId, setSheetId] = useState<string | null>(initialPlayerId ?? null);
  const [reviewing, setReviewing] = useState(false);
  /* A player the sheet shows who is not on this page — a link, an orphan in
     the warning list. Kept in its own tiny roster so edits stay optimistic. */
  const [detachedRows, setDetachedRows] = useState<Row[]>([]);
  const detached = useRoster(detachedRows);
  const mutateDetached = useMutate(detached);

  const onPage = sheetId === null ? undefined : rows.find((row) => row.id === sheetId);
  /*
   * The player the sheet shows can leave the page under it — approve someone
   * while the list is filtered to "Submitted", and the refresh that follows no
   * longer carries them. The sheet must not vanish mid-thought: their last
   * known row moves to the detached roster and the sheet stays put.
   */
  const [lastSheetRow, setLastSheetRow] = useState<Row | null>(null);
  if (onPage !== undefined && onPage !== lastSheetRow) {
    setLastSheetRow(onPage);
  }
  if (
    sheetId !== null &&
    onPage === undefined &&
    lastSheetRow?.id === sheetId &&
    !detachedRows.some((row) => row.id === sheetId)
  ) {
    setDetachedRows([lastSheetRow]);
  }
  const sheetRow =
    sheetId === null ? null : (onPage ?? detached.rows.find((row) => row.id === sheetId) ?? null);
  const sheetIndex = sheetRow === null ? -1 : rows.findIndex((row) => row.id === sheetRow.id);

  /** Keep the address in step so a sheet can be linked, without a server trip. */
  const writePlayerParam = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id === null) {
      url.searchParams.delete("player");
    } else {
      url.searchParams.set("player", id);
    }
    url.searchParams.delete("review");
    // `null`, as Next documents: it then syncs its router to this URL, so a later
    // `router.refresh()` keeps the parameter instead of restoring its own.
    window.history.replaceState(null, "", url.toString());
  }, []);

  const openSheet = useCallback(
    (id: string) => {
      setSheetId(id);
      writePlayerParam(id);
      if (!rows.some((row) => row.id === id)) {
        void registrationDetailAction(slug, id).then((result) => {
          if (result.ok) {
            setDetachedRows([result.row]);
          } else {
            toast({ title: result.error, tone: "danger" });
            setSheetId(null);
          }
        });
      }
    },
    [rows, slug, toast, writePlayerParam],
  );

  const closeSheet = useCallback(() => {
    const id = sheetId;
    setSheetId(null);
    setReviewing(false);
    writePlayerParam(null);
    // Back to the row it came from — a keyboard user keeps their place.
    if (id !== null) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-focus-key="open-${id}"]`)?.focus();
      });
    }
  }, [sheetId, writePlayerParam]);

  // A linked sheet for a player not on this page still has to load.
  useEffect(() => {
    if (initialPlayerId === undefined || page.rows.some((row) => row.id === initialPlayerId)) {
      return;
    }
    let live = true;
    void registrationDetailAction(slug, initialPlayerId).then((result) => {
      if (!live) {
        return;
      }
      if (result.ok) {
        setDetachedRows([result.row]);
      } else {
        setSheetId(null);
      }
    });
    return () => {
      live = false;
    };
    // Once, on arrival: a later page of rows is not a new link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingRows = useMemo(() => rows.filter(canTriage), [rows]);
  const nextPendingAfter = useCallback(
    (id: string): Row | undefined => {
      const from = rows.findIndex((row) => row.id === id);
      return (
        rows.slice(from + 1).find((row) => canTriage(row) && row.id !== id) ??
        rows.slice(0, Math.max(0, from)).find((row) => canTriage(row) && row.id !== id)
      );
    },
    [rows],
  );

  // "Start reviewing" filtered the list to submitted players and came back
  // with ?review=1: open the first one the moment the rows are here.
  const [reviewStarted, setReviewStarted] = useState(false);
  if (startReview && !reviewStarted && hydrated) {
    setReviewStarted(true);
    const first = page.rows.find(canTriage);
    if (first !== undefined) {
      setReviewing(true);
      setSheetId(first.id);
    }
  }

  const beginReview = () => {
    const first = pendingRows[0];
    if (first !== undefined) {
      setReviewing(true);
      openSheet(first.id);
      return;
    }
    pushQuery({ status: "submitted", page: "1", review: "1" });
  };

  const afterDecision = (row: Row) => {
    if (!reviewing) {
      return;
    }
    const next = nextPendingAfter(row.id);
    if (next === undefined) {
      toast({ title: "All caught up — nobody is waiting for review.", tone: "success" });
      closeSheet();
    } else {
      setSheetId(next.id);
      writePlayerParam(next.id);
    }
  };

  /* --- URL filters ---------------------------------------------------- */
  const pushQuery = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams();
      const merged: Record<string, string> = {
        q: filters.search,
        status: filters.status,
        fee: filters.fee,
        team: filters.team,
        role: filters.role,
        sort: filters.sort === "recent" ? "" : filters.sort,
        ...patch,
      };
      for (const [key, value] of Object.entries(merged)) {
        if (value !== "" && !(key === "page" && value === "1")) {
          next.set(key, value);
        }
      }
      startNavigation(() => {
        router.push(`/seasons/${slug}/registrations${next.size > 0 ? `?${next.toString()}` : ""}`, {
          scroll: false,
        });
      });
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
      if (selected.size > 0) {
        toast({
          title: `Selection cleared — ${String(selected.size)} row(s) were selected under the previous filter.`,
          tone: "info",
        });
        setSelected(new Map());
      }
      pushQuery({ ...patch, page: "1" });
    },
    [pushQuery, selected.size, toast],
  );

  // Search as you type — a beat after the last key, so a name is one query.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchInput = (value: string) => {
    setSearch(value);
    if (searchTimer.current !== null) {
      clearTimeout(searchTimer.current);
    }
    searchTimer.current = setTimeout(() => {
      if (value.trim() !== filters.search.trim()) {
        changeFilter({ q: value.trim() });
      }
    }, 400);
  };
  useEffect(
    () => () => {
      if (searchTimer.current !== null) {
        clearTimeout(searchTimer.current);
      }
    },
    [],
  );

  const filtersApplied =
    filters.search !== "" ||
    filters.status !== "" ||
    filters.fee !== "" ||
    filters.team !== "" ||
    filters.role !== "" ||
    filters.sort !== "recent";

  /* --- Selection & bulk ----------------------------------------------- */
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

  const allOnPageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const selectedOnPage = rows.filter((row) => selected.has(row.id)).length;
  const offPage = selected.size - selectedOnPage;

  const selectAllMatching = async () => {
    setBulkBusy("select");
    const result = await selectAllMatchingAction(slug, {
      ...(filters.search !== "" ? { search: filters.search } : {}),
      ...(filters.status !== "" ? { status: filters.status } : {}),
      ...(filters.fee !== "" ? { fee: filters.fee } : {}),
      ...(filters.team !== "" ? { teamId: filters.team } : {}),
      ...(filters.role !== "" ? { role: filters.role } : {}),
    });
    setBulkBusy(null);
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

  const runBulk = async (action: TriageAction, reason?: string, note?: string) => {
    if (selected.size === 0) {
      return;
    }
    setBulkBusy(action);
    const ids = [...selected.keys()];
    const target =
      action === "approve"
        ? "approved"
        : action === "waitlist"
          ? "waitlisted"
          : action === "reject"
            ? "rejected"
            : "submitted";
    const undoes = rows
      .filter((row) => selected.has(row.id))
      .map((row) => roster.apply(row.id, { status: target }));
    const result = await bulkTriageAction(slug, ids, action, reason, note);
    setBulkBusy(null);
    if (!result.ok) {
      undoes.forEach((undo) => {
        undo();
      });
      toast({ title: result.error ?? "Bulk action failed.", tone: "danger" });
      return;
    }
    const parts = [
      `${String(result.applied ?? 0)} ${PAST_TENSE[action] ?? action}`,
      ...((result.skipped ?? 0) > 0 ? [`${String(result.skipped)} skipped`] : []),
      // Say whether the PEOPLE will be told, not just whether the database
      // changed (DA-35). Delivery itself is recorded on each timeline.
      ...((result.notifying ?? 0) > 0 ? ["SMS on its way"] : []),
    ];
    toast({ title: parts.join(" · "), tone: "success" });
    setSelected(new Map());
    setBulkDecline(false);
    roster.settle();
  };

  /**
   * APPROVE EVERYONE WAITING, in one decision.
   *
   * An organizer who imported their own list has already decided about every
   * name on it; "Start reviewing" then walked them through 43 sheets to say
   * yes 43 times. The same server path as the bulk bar — every row still goes
   * through the triage rules and the approval messages — scoped to the
   * submitted players on every page, not just the one on screen.
   */
  const approveAllSubmitted = async () => {
    setApprovingAll(true);
    const found = await selectAllMatchingAction(slug, { status: "submitted" });
    if (!found.ok) {
      setApprovingAll(false);
      toast({ title: found.error, tone: "danger" });
      return;
    }
    const result = await bulkTriageAction(
      slug,
      found.rows.map((row) => row.id),
      "approve",
    );
    setApprovingAll(false);
    setApproveAllOpen(false);
    if (!result.ok) {
      toast({ title: result.error ?? "Approving everyone failed.", tone: "danger" });
      return;
    }
    toast({
      title: [
        `${String(result.applied ?? 0)} approved`,
        ...((result.skipped ?? 0) > 0 ? [`${String(result.skipped)} skipped`] : []),
        ...((result.notifying ?? 0) > 0 ? ["messages on their way"] : []),
      ].join(" · "),
      tone: "success",
    });
    roster.settle();
  };

  /* --- One row -------------------------------------------------------- */
  const decideRow = async (row: Row, action: TriageAction) => {
    const status =
      action === "approve" ? "approved" : action === "waitlist" ? "waitlisted" : row.status;
    const result = await mutate(row, { status }, () =>
      triageRegistrationAction(slug, row.id, action),
    );
    if (result.ok) {
      toast({ title: decisionToast(row.name ?? row.number, action, result), tone: "success" });
    }
  };

  const declineRow = async (row: Row, reason: string, note: string) => {
    const writer = detached.rows.some((entry) => entry.id === row.id) ? mutateDetached : mutate;
    const result = await writer(row, { status: "rejected", rejectionReason: reason }, () =>
      triageRegistrationAction(slug, row.id, "reject", reason, note),
    );
    if (result.ok) {
      toast({ title: decisionToast(row.name ?? row.number, "reject", result), tone: "success" });
      setDeclining(null);
      afterDecision(row);
    }
  };

  /* --- Keyboard: j/k in the list when no sheet is open ----------------- */
  const [cursor, setCursor] = useState(-1);
  useEffect(() => {
    if (sheetId !== null) {
      return;
    }
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
      if (event.key === "j") {
        setCursor((c) => Math.min(c + 1, rows.length - 1));
      } else if (event.key === "k") {
        setCursor((c) => Math.max(c - 1, 0));
      } else if (event.key === "x") {
        const row = rows[cursor];
        if (row !== undefined) {
          toggle(row);
        }
      } else if (event.key === "Enter" && cursor >= 0) {
        const row = rows[cursor];
        if (row !== undefined && target?.tagName !== "BUTTON") {
          openSheet(row.id);
        }
      } else if (event.key === "/") {
        event.preventDefault();
        document.getElementById("pd-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [rows, cursor, toggle, sheetId, openSheet]);

  useEffect(() => {
    document
      .querySelector<HTMLElement>('[data-cursor="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const teamOptions = teams.map((team) => ({ id: team.id, name: team.name }));
  const teamColorOf = useMemo(
    () => new Map(teams.map((team) => [team.id, team.primaryColor])),
    [teams],
  );

  /* --- Reopen: the overview's own advance, offered where intake is run. --- */
  const [reopening, setReopening] = useState(false);
  const reopen = async () => {
    setReopening(true);
    const result = await advanceCompetitionAction(slug, "registration_open");
    setReopening(false);
    if (!result.ok) {
      toast({ title: result.error ?? "Registration couldn't be reopened.", tone: "danger" });
      return;
    }
    toast({ title: "Registration is open again. The link takes new players.", tone: "success" });
    router.refresh();
  };

  const pendingReview = stats.submitted + stats.waitlisted;
  const firstOnPage = (page.page - 1) * page.pageSize;

  return (
    <div className="pd-desk" data-sheet-open={sheetRow !== null ? "true" : undefined}>
      {/* The page head's lede and actions. The shell draws the trail, the one
          <h1> and — in the top bar — the season's status pill. The two derived
          figures (auction pool, fees) ride the lede as facts, not tiles: they
          are not filters of the list below, so they do not sit with its tabs. */}
      <div className="rd-head">
        <div className="rd-head-main">
          <p className="rd-lede">
            {stats.total === 0
              ? "Share the registration link, add players yourself or import your sheet."
              : `${String(stats.total)} player${stats.total === 1 ? "" : "s"} registered · ${
                  pendingReview === 0
                    ? "everyone reviewed"
                    : `${String(pendingReview)} waiting for a decision`
                }`}
          </p>
          {/* DA-35: the figure that decides what auction night contains — the
              same rule the Auction tab filters on, so the two cannot disagree. */}
          <span
            className="rd-fact"
            data-testid="stat-auction-pool"
            title={`Auction pool: ${poolHint(stats)}`}
          >
            <IconGavel size={16} weight="duotone" aria-hidden />
            <span>
              <span className="stat-value">{stats.auctionPool}</span> in auction pool
            </span>
            <span className="rd-fact-hint stat-hint">{poolHint(stats)}</span>
          </span>
          {feesInUse ? (
            <button
              type="button"
              className="rd-fact"
              data-interactive="true"
              data-testid="stat-fees-paid"
              aria-pressed={filters.fee === "paid"}
              title="Show the players who have paid"
              onClick={() => {
                changeFilter({ fee: filters.fee === "paid" ? "" : "paid" });
              }}
            >
              <IconWallet size={16} weight="duotone" aria-hidden />
              <span>
                <span className="stat-value">{stats.fees.paid}</span> fees paid
              </span>
              <span className="rd-fact-hint stat-hint">{feeHint(stats)}</span>
            </button>
          ) : null}
          {registrationOpen ? null : share}
        </div>
        <div className="rd-actions">
          <Button
            variant="secondary"
            data-testid="open-import"
            onClick={() => {
              setImportOpen(true);
            }}
          >
            <IconUpload size={16} className="icon-lead" aria-hidden />
            Import players
          </Button>
          {canReopen ? (
            <Button
              variant="secondary"
              data-testid="reopen-registration"
              loading={reopening}
              onClick={() => void reopen()}
            >
              <IconRefresh size={16} className="icon-lead" aria-hidden />
              Reopen registration
            </Button>
          ) : null}
          <AddPlayerDialog
            slug={slug}
            roles={desk.roles}
            rolesRequired={desk.rolesRequired}
            attributes={desk.attributes}
          />
        </div>
      </div>

      {registrationOpen ? share : null}

      <NextStep
        stats={stats}
        orphans={orphanPreSigned}
        desk={desk}
        slug={slug}
        teamsCount={teams.length}
        onReview={beginReview}
        onApproveAll={() => {
          setApproveAllOpen(true);
        }}
        onOpenPlayer={openSheet}
      />
      <Dialog
        open={approveAllOpen}
        onClose={() => {
          if (!approvingAll) setApproveAllOpen(false);
        }}
        title={`Approve all ${String(stats.submitted)} waiting players?`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setApproveAllOpen(false);
              }}
              disabled={approvingAll}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void approveAllSubmitted()}
              loading={approvingAll}
              data-testid="approve-all-confirm"
            >
              Approve {String(stats.submitted)}
            </Button>
          </>
        }
      >
        <p>
          They join the auction pool, and each one gets their approval message. Waitlisted players
          are left as they are.
        </p>
      </Dialog>

      {/* DA-35: the orphan. A pre-signed player with no team is in NO auction
          and NO squad. Each name opens the player, one click from the fix. */}
      {orphanPreSigned.length > 0 ? (
        <div
          className="pd-alert"
          data-tone="danger"
          data-testid="orphan-pre-signed-warning"
          role="alert"
        >
          <p>
            <strong>
              {orphanPreSigned.length} pre-signed player
              {orphanPreSigned.length === 1 ? " is" : "s are"} in no auction and no squad.
            </strong>{" "}
            They skip the auction but have no team. Pick one, or clear the mark.
          </p>
          <ul className="pd-alert-list">
            {orphanPreSigned.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  className="pd-link"
                  onClick={() => {
                    openSheet(player.id);
                  }}
                >
                  {player.name ?? "Unnamed"}
                </button>{" "}
                <Badge tone={player.kind === "icon" ? "success" : "info"}>
                  {player.kind === "icon"
                    ? "Icon"
                    : player.kind === "captain"
                      ? "Captain"
                      : "Retained"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* WHAT TO ORDER — summed by the product, not by a pivot table. Only once
          somebody has recorded a size; a club that orders no kit never sees it. */}
      {kit !== undefined && (kit.tshirt.length > 0 || kit.trouser.length > 0) ? (
        <div className="pd-kit" data-testid="kit-summary">
          <span className="pd-kit-title">Kit to order</span>
          {[
            ["T-shirts", kit.tshirt],
            ["Trousers", kit.trouser],
          ].map(([label, sizes]) =>
            (sizes as KitSizeCount[]).length === 0 ? null : (
              <span key={label as string} className="pd-kit-line">
                <strong>{label as string}</strong>{" "}
                {(sizes as KitSizeCount[])
                  .map((entry) => `${entry.size} × ${String(entry.count)}`)
                  .join(" · ")}
              </span>
            ),
          )}
          {kit.missing > 0 ? (
            <span className="pd-quiet">{kit.missing} approved without a size</span>
          ) : null}
        </div>
      ) : null}

      <SectionCard flush className="rd-card" title="Players" hideHeader>
        {/* ROW 1 — the status tabs. The
            counts are the old figure tiles; each one is the filter it names
            (`stat-*` stay the suites' hooks, `.stat-value` the figure). */}
        <div className="rd-tabs" data-testid="stat-row" data-hydrated={hydrated ? "true" : "false"}>
          <SegmentedTabs
            label="Registration status"
            items={[
              {
                key: "all",
                label: "All",
                count: <span className="stat-value">{stats.total}</span>,
                active: filters.status === "" && filters.fee === "",
                testId: "stat-total",
                onSelect: () => {
                  changeFilter({ status: "", fee: "" });
                },
              },
              {
                key: "submitted",
                label: "To review",
                count: <span className="stat-value">{stats.submitted}</span>,
                attention: stats.submitted > 0,
                active: filters.status === "submitted",
                testId: "stat-submitted",
                onSelect: () => {
                  changeFilter({ status: "submitted" });
                },
              },
              {
                key: "approved",
                label: "Approved",
                count: <span className="stat-value">{stats.approved}</span>,
                active: filters.status === "approved",
                testId: "stat-approved",
                onSelect: () => {
                  changeFilter({ status: "approved" });
                },
              },
              {
                key: "waitlisted",
                label: "Waitlisted",
                count: <span className="stat-value">{stats.waitlisted}</span>,
                active: filters.status === "waitlisted",
                testId: "stat-waitlisted",
                onSelect: () => {
                  changeFilter({ status: "waitlisted" });
                },
              },
              {
                key: "rejected",
                label: "Declined",
                count: <span className="stat-value">{stats.rejected}</span>,
                active: filters.status === "rejected",
                testId: "stat-rejected",
                onSelect: () => {
                  changeFilter({ status: "rejected" });
                },
              },
              {
                key: "withdrawn",
                label: "Withdrawn",
                count: <span className="stat-value">{stats.withdrawn}</span>,
                active: filters.status === "withdrawn",
                testId: "stat-withdrawn",
                onSelect: () => {
                  changeFilter({ status: "withdrawn" });
                },
              },
            ]}
          />
        </div>

        {/* ROW 2 — ONE toolbar: search · what is set · count · Filters · Sort ·
            Export. It used to be a card head, a row of five selects and a
            select-all row (~150px); the select-all is the table's own header
            checkbox now. */}
        <form
          className="rd-toolbar"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            changeFilter({ q: search.trim() });
          }}
        >
          <Toolbar>
            <div className="pd-search rd-search">
              {/* The magnifier IS the submit button — Enter works too, and the
                  list also follows typing, a beat after the last key. */}
              <button
                type="submit"
                className="pd-search-icon"
                data-testid="search-submit"
                aria-label="Search"
              >
                <IconSearch size={16} aria-hidden />
              </button>
              <label htmlFor="pd-search" className="pd-visually-hidden">
                Search
              </label>
              <input
                id="pd-search"
                type="text"
                enterKeyHint="search"
                autoComplete="off"
                className="pd-input"
                placeholder="Search name, phone, # or team"
                value={search}
                onChange={(event) => {
                  onSearchInput(event.target.value);
                }}
              />
              <kbd className="rd-kbd" aria-hidden>
                /
              </kbd>
            </div>
            {filters.role !== "" ? (
              <ToolbarChip
                removeLabel="Remove role filter"
                onRemove={() => {
                  changeFilter({ role: "" });
                }}
              >
                Role: {labelOf(desk.roles, filters.role)}
              </ToolbarChip>
            ) : null}
            {filters.team !== "" ? (
              <ToolbarChip
                removeLabel="Remove team filter"
                onRemove={() => {
                  changeFilter({ team: "" });
                }}
              >
                Team: {teams.find((team) => team.id === filters.team)?.name ?? "—"}
              </ToolbarChip>
            ) : null}
            {filters.fee !== "" ? (
              <ToolbarChip
                removeLabel="Remove fee filter"
                onRemove={() => {
                  changeFilter({ fee: "" });
                }}
              >
                Fee: {(FEE_LABEL as Partial<Record<string, string>>)[filters.fee] ?? filters.fee}
              </ToolbarChip>
            ) : null}
            {filtersApplied ? (
              <button
                type="button"
                className="rd-reset"
                data-testid="filters-reset"
                onClick={() => {
                  setSearch("");
                  changeFilter({ q: "", status: "", fee: "", team: "", role: "", sort: "" });
                }}
              >
                Clear all
              </button>
            ) : null}
            <ToolbarSpacer />
            <span className="rd-count">
              {filtersApplied
                ? `${String(page.total)} of ${String(stats.total)}`
                : `${String(page.total)} player${page.total === 1 ? "" : "s"}`}
            </span>
            <FilterMenu
              testId="filters-menu"
              activeCount={[filters.role, filters.team, filters.fee].filter((v) => v !== "").length}
            >
              {desk.roles.length > 0 ? (
                <FilterSelect
                  label="Role"
                  visibleLabel
                  value={filters.role}
                  onChange={(value) => {
                    changeFilter({ role: value });
                  }}
                  options={[
                    { value: "", label: "All roles" },
                    ...desk.roles.map((role) => ({ value: role.key, label: role.label })),
                  ]}
                />
              ) : null}
              <FilterSelect
                label="Team"
                visibleLabel
                value={filters.team}
                onChange={(value) => {
                  changeFilter({ team: value });
                }}
                options={[
                  { value: "", label: "All teams" },
                  ...teams.map((team) => ({ value: team.id, label: team.name })),
                ]}
              />
              <FilterSelect
                label="Fee"
                visibleLabel
                value={filters.fee}
                onChange={(value) => {
                  changeFilter({ fee: value });
                }}
                options={[
                  { value: "", label: "Any fee status" },
                  ...FEE_STATUSES.map((state) => ({ value: state, label: FEE_LABEL[state] })),
                ]}
              />
            </FilterMenu>
            <FilterSelect
              label="Sort"
              className="rd-sort"
              value={filters.sort}
              onChange={(value) => {
                changeFilter({ sort: value });
              }}
              options={SORTS.map((sort) => ({ value: sort, label: SORT_LABEL[sort] ?? sort }))}
            />
            <Button
              size="sm"
              variant="secondary"
              data-testid="export-csv"
              className="rd-export"
              onClick={() => {
                setExportOpen(true);
              }}
            >
              <IconDownload size={16} className="icon-lead" aria-hidden />
              Export
            </Button>
          </Toolbar>
        </form>

        <div className="pd-table-wrap" data-busy={navigating ? "true" : undefined}>
          <div className="pd-table-scroll" role="region" aria-label="Registrations table">
            <table className="pd-table" data-testid="reg-table">
              <caption className="pd-visually-hidden">
                {page.total} registration{page.total === 1 ? "" : "s"} match this view — page{" "}
                {page.page} of {totalPages}.
              </caption>
              <thead>
                <tr>
                  <th className="pd-col-check">
                    {rows.length > 0 ? (
                      <input
                        type="checkbox"
                        className="pd-row-check"
                        aria-label="Select all on page"
                        title="Select all on this page"
                        checked={allOnPageSelected}
                        onChange={() => {
                          setSelected((prev) => {
                            const next = new Map(prev);
                            if (allOnPageSelected) {
                              rows.forEach((row) => next.delete(row.id));
                            } else {
                              rows.forEach((row) => {
                                next.set(row.id, {
                                  id: row.id,
                                  number: row.number,
                                  name: row.name,
                                });
                              });
                            }
                            return next;
                          });
                        }}
                      />
                    ) : (
                      <VisuallyHidden>Select</VisuallyHidden>
                    )}
                  </th>
                  <th className="pd-col-num">#</th>
                  <th>Player</th>
                  <th className="pd-col-role">Role</th>
                  <th className="pd-col-team">Team</th>
                  <th className="pd-col-status">Status</th>
                  {feesInUse ? <th className="pd-col-fee">Fee</th> : null}
                  <th className="pd-col-date">Registered on</th>
                  <th className="pd-col-actions">
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <PlayerRow
                    key={row.id}
                    row={row}
                    number={firstOnPage + index + 1}
                    cursor={index === cursor}
                    open={row.id === sheetId}
                    checked={selected.has(row.id)}
                    categoryFlagged={categoryFlags[row.id] !== undefined}
                    roleLabel={labelOf(desk.roles, row.role)}
                    teamColor={teamColorOf.get(row.teamId ?? "") ?? null}
                    feesInUse={feesInUse}
                    auctionDone={desk.auctionDone}
                    onToggle={() => {
                      toggle(row);
                    }}
                    onOpen={() => {
                      setCursor(index);
                      openSheet(row.id);
                    }}
                    onApprove={() => void decideRow(row, "approve")}
                    onDecline={() => {
                      setDeclining(row);
                    }}
                  />
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={feesInUse ? 9 : 8} className="pd-empty" data-testid="reg-empty">
                      {!filtersApplied && stats.total > 0 ? (
                        <EmptyState
                          size="compact"
                          icon={<IconAlert />}
                          concept="error"
                          title={`${String(stats.total)} registration${stats.total === 1 ? " exists" : "s exist"} but none can be displayed`}
                          description="This usually means the underlying player records are incomplete — contact support with this season’s name."
                        />
                      ) : filtersApplied ? (
                        <EmptyState
                          size="compact"
                          icon={<IconFilter />}
                          title="No registrations match these filters"
                          description={`Clear them to see all ${String(stats.total)} registration${stats.total === 1 ? "" : "s"}.`}
                          action={
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setSearch("");
                                changeFilter({
                                  q: "",
                                  status: "",
                                  fee: "",
                                  team: "",
                                  role: "",
                                  sort: "",
                                });
                              }}
                            >
                              Clear the filters
                            </Button>
                          }
                        />
                      ) : (
                        <EmptyState
                          size="compact"
                          icon={<IconUsers />}
                          title="Nobody has registered yet"
                          description="Share the registration link — that’s how players arrive — or add players yourself, or import a CSV."
                        />
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {page.total > 0 ? (
            <div className="pd-pager">
              <Pager
                total={page.total}
                page={page.page}
                pageCount={totalPages}
                pageSize={page.pageSize}
                noun="players"
                onPage={(entry) => {
                  pushQuery({ page: String(entry) });
                }}
                summaryTestId="page-indicator"
                prevTestId="page-prev"
                nextTestId="page-next"
              >
                <span className="pd-shortcuts">
                  <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>Enter</kbd> open · <kbd>x</kbd> select
                </span>
              </Pager>
            </div>
          ) : null}
        </div>
      </SectionCard>

      {/* The bulk bar floats over the table's foot: the selection and what
          can be done to it stay in view however far down the list you are. */}
      {selected.size > 0 ? (
        <div className="pd-bulk" data-testid="bulk-bar" role="region" aria-label="Bulk actions">
          <strong data-testid="bulk-count">{selected.size} selected</strong>
          {/* DA-35: the selection survives paging, so it says when some of it
              is not on screen — Decline would reach them too. */}
          {offPage > 0 ? (
            <span className="pd-quiet" data-testid="bulk-offpage">
              {offPage} not shown on this page
            </span>
          ) : null}
          <span className="pd-bulk-links">
            <button
              type="button"
              className="pd-link"
              onClick={() => {
                setReviewOpen(true);
              }}
              data-testid="bulk-review"
            >
              Review
            </button>
            {selected.size < page.total ? (
              <button
                type="button"
                className="pd-link"
                disabled={bulkBusy !== null}
                onClick={() => void selectAllMatching()}
                data-testid="bulk-select-all-matching"
              >
                Select all {page.total}
              </button>
            ) : null}
            <button
              type="button"
              className="pd-link"
              onClick={() => {
                setSelected(new Map());
              }}
              data-testid="bulk-clear"
            >
              Clear
            </button>
          </span>
          <span className="pd-bulk-actions">
            <Button
              size="sm"
              onClick={() => void runBulk("approve")}
              loading={bulkBusy === "approve"}
              disabled={bulkBusy !== null}
              data-testid="bulk-approve"
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void runBulk("waitlist")}
              loading={bulkBusy === "waitlist"}
              disabled={bulkBusy !== null}
              data-testid="bulk-waitlist"
            >
              Waitlist
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void runBulk("restore")}
              loading={bulkBusy === "restore"}
              disabled={bulkBusy !== null}
            >
              Restore
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setBulkDecline(true);
              }}
              disabled={bulkBusy !== null}
              data-testid="bulk-reject"
            >
              Decline…
            </Button>
          </span>
        </div>
      ) : null}

      {sheetRow !== null ? (
        <PlayerSheet
          key="sheet"
          slug={slug}
          row={sheetRow}
          desk={desk}
          teams={teamOptions}
          mutate={sheetIndex >= 0 ? mutate : mutateDetached}
          categoryFlagged={categoryFlags[sheetRow.id] !== undefined}
          onClose={closeSheet}
          {...(sheetIndex >= 0
            ? {
                position: { index: sheetIndex, total: rows.length },
                ...(sheetIndex > 0
                  ? {
                      onPrev: () => {
                        const target = rows[sheetIndex - 1];
                        if (target !== undefined) {
                          setCursor(sheetIndex - 1);
                          openSheet(target.id);
                        }
                      },
                    }
                  : {}),
                ...(sheetIndex < rows.length - 1
                  ? {
                      onNext: () => {
                        const target = rows[sheetIndex + 1];
                        if (target !== undefined) {
                          setCursor(sheetIndex + 1);
                          openSheet(target.id);
                        }
                      },
                    }
                  : {}),
              }
            : {})}
          onDecline={(row) => {
            setDeclining(row);
          }}
          onDecided={(row) => {
            afterDecision(row);
          }}
          reviewing={reviewing}
          nextToReview={(() => {
            const next = nextPendingAfter(sheetRow.id);
            return next === undefined || reviewing
              ? undefined
              : {
                  name: next.name ?? next.number,
                  left: pendingRows.filter((row) => row.id !== sheetRow.id).length,
                  go: () => {
                    setReviewing(true);
                    openSheet(next.id);
                  },
                };
          })()}
        />
      ) : null}

      <ImportDialog
        slug={slug}
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
        }}
        registrationOpen={registrationOpen}
      />

      <ExportDialog
        slug={slug}
        open={exportOpen}
        onClose={() => {
          setExportOpen(false);
        }}
        sportAttributes={desk.attributes}
        teams={teamOptions}
        {...(filtersApplied
          ? {
              view: {
                ...(filters.search !== "" ? { search: filters.search } : {}),
                ...(filters.status !== "" ? { status: filters.status } : {}),
                ...(filters.fee !== "" ? { fee: filters.fee } : {}),
                ...(filters.team !== "" ? { teamId: filters.team } : {}),
                ...(filters.role !== "" ? { role: filters.role } : {}),
              },
            }
          : {})}
      />

      <DeclineDialog
        open={declining !== null}
        onClose={() => {
          setDeclining(null);
        }}
        title={`Decline ${declining?.name ?? "this registration"}?`}
        confirmLabel="Decline"
        onConfirm={(reason, note) =>
          declining === null ? Promise.resolve() : declineRow(declining, reason, note)
        }
        testIds={{ confirm: "confirm-row-decline", note: "row-reject-note" }}
      >
        <p>
          {declining?.name ?? "This player"} is told their registration was not approved, with the
          reason you choose. Restore is the only way back.
        </p>
      </DeclineDialog>

      <DeclineDialog
        open={bulkDecline}
        onClose={() => {
          setBulkDecline(false);
        }}
        title={`Decline ${String(selected.size)} registration${selected.size === 1 ? "" : "s"}?`}
        confirmLabel={`Decline ${String(selected.size)}`}
        onConfirm={(reason, note) => runBulk("reject", reason, note)}
        testIds={{ confirm: "confirm-bulk-reject", note: "bulk-reject-note" }}
      >
        <p>
          This tells {selected.size} {selected.size === 1 ? "person" : "people"} their registration
          was not approved, and sends each of them the reason you choose. A declined registration
          can only be put back with Restore.
        </p>
        {offPage > 0 ? (
          <p role="alert" className="pd-callout" data-tone="warning">
            <strong>{offPage} of them are not shown on this page.</strong> Use “Review” in the
            selection bar to see everyone this will affect.
          </p>
        ) : null}
      </DeclineDialog>

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
        <ul className="pd-selection" data-testid="selection-list">
          {[...selected.values()].map((pick) => (
            <li key={pick.id}>
              <span>{pick.name ?? "Unnamed"}</span>
              <span className="pd-mono pd-quiet">{pick.number}</span>
              <button
                type="button"
                className="pd-link"
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
    </div>
  );
}

function labelOf(roles: readonly { key: string; label: string }[], role: string | null): string {
  if (role === null) {
    return "";
  }
  return roles.find((entry) => entry.key === role)?.label ?? role.replace(/_/g, " ");
}

/* --- What to do next ----------------------------------------------------- */

/**
 * ONE NEXT STEP, ALWAYS.
 *
 * The desk used to open on eight tiles and a table and leave the organizer to
 * work out what the season needed. This names the single most useful thing to
 * do now, in the order a season actually goes — review who registered, fix
 * anyone stranded, then hand the pool to the auction — with one button that
 * does it.
 */
function NextStep({
  stats,
  orphans,
  desk,
  slug,
  teamsCount,
  onReview,
  onApproveAll,
  onOpenPlayer,
}: {
  stats: RegistrationStats;
  orphans: OrphanPreSigned[];
  desk: PlayerDeskContext;
  slug: string;
  teamsCount: number;
  onReview: () => void;
  onApproveAll: () => void;
  onOpenPlayer: (id: string) => void;
}) {
  const pending = stats.submitted + stats.waitlisted;
  let eyebrow: string;
  let title: string;
  let why: string;
  let action: ReactNode;
  if (stats.total === 0) {
    eyebrow = "Get players in";
    title = "Nobody has registered yet";
    why = "Share the registration link above, add players one by one, or import your sheet.";
    action = null;
  } else if (pending > 0) {
    eyebrow = "Review";
    title = `${String(pending)} player${pending === 1 ? " is" : "s are"} waiting for a decision`;
    why =
      stats.submitted > 1
        ? "Approve everyone at once if you already know them — or open each one, and the next opens by itself."
        : "Open each one, approve or decline, and the next opens by itself.";
    action = (
      <div className="pd-next-actions">
        {stats.submitted > 1 ? (
          <Button onClick={onApproveAll} data-testid="approve-all">
            Approve all {String(stats.submitted)}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onReview} data-testid="start-review">
          Start reviewing <IconArrowRight size={16} className="icon-trail" />
        </Button>
      </div>
    );
  } else if (orphans.length > 0) {
    const first = orphans[0];
    eyebrow = "Fix";
    title = `${String(orphans.length)} pre-signed player${orphans.length === 1 ? " has" : "s have"} no team`;
    why = "They skip the auction, so without a team they are in no squad at all.";
    action =
      first === undefined ? null : (
        <Button
          variant="secondary"
          onClick={() => {
            onOpenPlayer(first.id);
          }}
        >
          Pick a team <IconArrowRight size={16} className="icon-trail" />
        </Button>
      );
  } else if (teamsCount < 2) {
    eyebrow = "Teams";
    title = "Add the teams that will bid";
    why = "An auction needs at least two teams — then pick each team's captain and icons.";
    action = (
      <ButtonLink variant="secondary" href={`/seasons/${slug}/teams`}>
        Go to teams <IconArrowRight size={16} className="icon-trail" />
      </ButtonLink>
    );
  } else if (!desk.auctionExists && stats.auctionPool === 0 && stats.approved > 0) {
    eyebrow = "Auction pool";
    title = "Nobody is left for the auction";
    why = `All ${String(stats.approved)} approved players are pre-signed (icons, captains or retained). Add or approve more players to fill the pool.`;
    action = null;
  } else if (!desk.auctionExists) {
    eyebrow = "Auction";
    title = `${String(stats.auctionPool)} player${stats.auctionPool === 1 ? "" : "s"} ready for the auction`;
    why = "Everyone is reviewed. Pick captains and icons on each team, then set up the auction.";
    action = (
      <ButtonLink variant="secondary" href={`/seasons/${slug}/auction`}>
        Set up the auction <IconArrowRight size={16} className="icon-trail" />
      </ButtonLink>
    );
  } else {
    // Nothing to do is not a step. The banner stays away rather than filling
    // the top of the desk with "all set".
    return null;
  }
  return (
    <section className="pd-next" aria-label="Next step" data-testid="next-step">
      <div>
        <p className="pd-next-eyebrow">{eyebrow}</p>
        <p className="pd-next-title">{title}</p>
        <p className="pd-next-why">{why}</p>
      </div>
      {action}
    </section>
  );
}

/* --- One row ------------------------------------------------------------- */

const STATUS_PILL: Record<Row["status"], KitTone> = {
  draft: "neutral",
  submitted: "blue",
  approved: "green",
  rejected: "red",
  waitlisted: "amber",
  withdrawn: "neutral",
};

const FEE_PILL: Record<Row["feeStatus"], KitTone> = {
  pending: "amber",
  paid: "green",
  waived: "blue",
  refunded: "neutral",
};

function PlayerRow({
  row,
  number,
  cursor,
  open,
  checked,
  categoryFlagged,
  roleLabel,
  teamColor,
  feesInUse,
  auctionDone,
  onToggle,
  onOpen,
  onApprove,
  onDecline,
}: {
  row: Row;
  /** The row's place in the whole filtered list, not just this page. */
  number: number;
  cursor: boolean;
  open: boolean;
  checked: boolean;
  categoryFlagged: boolean;
  roleLabel: string;
  teamColor: string | null;
  /** The season records fees at all — otherwise the cell is a dash. */
  feesInUse: boolean;
  /** The auction has run, so an approved player with no team is unsold. */
  auctionDone: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const triage = canTriage(row);
  const name = row.name ?? "Unnamed";
  return (
    <tr
      className="pd-row"
      data-testid={`reg-${row.personId}`}
      data-cursor={cursor ? "true" : undefined}
      data-open={open ? "true" : undefined}
      data-selected={checked ? "true" : undefined}
      onClick={(event) => {
        // The whole row opens the player; its own controls do their own thing.
        if (
          (event.target as HTMLElement).closest(
            "button, a, input, label, select, [role='menu']",
          ) === null
        ) {
          onOpen();
        }
      }}
    >
      <td className="pd-col-check">
        <input
          type="checkbox"
          className="pd-row-check"
          aria-label={`Select ${personLabel(row)}`}
          checked={checked}
          onChange={onToggle}
        />
      </td>
      <td className="pd-col-num">{number}</td>
      <td className="pd-col-player">
        <div className="pd-player">
          <PlayerImage
            name={row.name ?? "Player"}
            seed={row.id}
            size="sm"
            src={row.photoUrl}
            decorative
          />
          <div className="pd-player-text">
            <button
              type="button"
              className="pd-player-name"
              onClick={onOpen}
              data-focus-key={`open-${row.id}`}
              data-testid={`open-${row.personId}`}
            >
              {name}
            </button>
            <span className="pd-player-meta">
              <span className="pd-mono">{row.number}</span>
              {/* DA-35: never raw E.164 at a human. */}
              <span data-private>{personContact(row)}</span>
              {/* PHONE: the team (and its marks) ride this line, so a row is
                  two lines beside the face (~56px), not three (~115px). The
                  laptop keeps them in the Team column. */}
              <span className="pd-meta-phone">
                {row.teamName !== null
                  ? row.teamName
                  : auctionDone && row.status === "approved"
                    ? "Unsold"
                    : null}
                {row.isCaptain ? <IconCrown size={16} weight="fill" alt="Captain" /> : null}
                {row.isIcon ? <IconStar size={16} weight="fill" alt="Icon" /> : null}
                {row.isRetained ? <IconLock size={16} weight="fill" alt="Retained" /> : null}
              </span>
            </span>
            {row.duplicateName || categoryFlagged ? (
              <span className="pd-player-flags">
                {row.duplicateName ? (
                  <Badge tone="warning" data-testid="dup-flag">
                    possible duplicate
                  </Badge>
                ) : null}
                {categoryFlagged ? (
                  // PI-1: the engine flags; the organizer decides (invariant 5).
                  <Badge tone="warning" data-testid="category-flag">
                    check entry category
                  </Badge>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      </td>
      <td className="pd-col-role">
        <span>{roleLabel === "" ? "—" : roleLabel}</span>
        {row.age !== null ? <span className="pd-sub">{row.age} yrs</span> : null}
      </td>
      <td className="pd-col-team">
        <span className="pd-team">
          {row.teamName !== null ? (
            <TeamChip color={teamColor}>{row.teamName}</TeamChip>
          ) : (
            <span className="pd-quiet">
              {auctionDone && row.status === "approved" ? "Unsold" : "—"}
            </span>
          )}
        </span>
        <span className="pd-marks-inline">
          {row.isCaptain ? (
            <span
              className="pd-mark-chip"
              data-kind="captain"
              data-testid="captain-flag"
              title="Captain — skips the auction"
            >
              <IconCrown size={16} weight="fill" aria-hidden />
              <VisuallyHidden>Captain</VisuallyHidden>
            </span>
          ) : null}
          {row.isIcon ? (
            <span
              className="pd-mark-chip"
              data-kind="icon"
              data-testid="icon-flag"
              title="Icon — skips the auction"
            >
              <IconStar size={16} weight="fill" aria-hidden />
              <VisuallyHidden>Icon</VisuallyHidden>
            </span>
          ) : null}
          {row.isRetained ? (
            <span
              className="pd-mark-chip"
              data-kind="retained"
              data-testid="retained-flag"
              title="Retained — skips the auction"
            >
              <IconLock size={16} weight="fill" aria-hidden />
              <VisuallyHidden>Retained</VisuallyHidden>
            </span>
          ) : null}
        </span>
        {(row.isIcon || row.isCaptain || row.isRetained) && row.teamId === null ? (
          <span className="pd-sub pd-sub-danger">No team — in no squad</span>
        ) : null}
      </td>
      <td className="pd-col-status">
        <span className="pd-status">
          <Pill tone={STATUS_PILL[row.status]} dot>
            {row.status === "rejected" ? "declined" : row.status}
          </Pill>
        </span>
        {row.status === "rejected" && row.rejectionReason !== null ? (
          <span className="pd-sub" data-testid={`reason-${row.personId}`}>
            {REASON_LABEL[row.rejectionReason] ?? row.rejectionReason}
          </span>
        ) : null}
      </td>
      {/* A free league has no fee column at all (it was 25 rows of "—"). */}
      {feesInUse ? (
        <td className="pd-col-fee">
          <Pill tone={FEE_PILL[row.feeStatus]} testId={`fee-${row.personId}`}>
            {FEE_LABEL[row.feeStatus]}
          </Pill>
        </td>
      ) : null}
      <td className="pd-col-date">
        <time dateTime={row.createdAt}>{formatDate(row.createdAt)}</time>
      </td>
      <td className="pd-col-actions">
        <PopoverMenu
          label={`Actions for ${name}`}
          triggerClassName="rd-kebab"
          trigger={
            <span className="rd-kebab-glyph" data-testid={`row-menu-${row.personId}`}>
              <IconKebab size={18} aria-hidden />
            </span>
          }
          items={[
            { key: "open", label: "Open details", onSelect: onOpen },
            ...(triage
              ? [
                  {
                    key: "approve",
                    label: <span data-testid={`approve-${row.personId}`}>Approve</span>,
                    onSelect: onApprove,
                  },
                  {
                    key: "decline",
                    label: <span data-testid={`decline-${row.personId}`}>Decline…</span>,
                    onSelect: onDecline,
                    danger: true,
                  },
                ]
              : []),
          ]}
        />
      </td>
    </tr>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  visibleLabel = false,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  /** Inside the Filters menu the label is shown above the select. */
  visibleLabel?: boolean;
  className?: string;
}) {
  const id = `pd-filter-${label.toLowerCase()}`;
  return (
    <span
      className={["pd-filter", className].filter(Boolean).join(" ")}
      data-labelled={visibleLabel ? "true" : undefined}
    >
      <label htmlFor={id} className={visibleLabel ? "rd-filter-label" : "pd-visually-hidden"}>
        {label}
      </label>
      <select
        id={id}
        className="pd-input pd-select"
        value={value}
        data-active={value !== "" && !(label === "Sort" && value === "recent") ? "true" : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
