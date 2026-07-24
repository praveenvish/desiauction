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
  triageRegistrationAction,
  type ImportPreview,
  type RegistrationDashboard,
  type TriageAction,
} from "../../../../server/competition/actions";
import { PlayerPhotoUploader } from "./player-photo-uploader";
import { formatDateTime } from "../../../../lib/format-date";
import type { TimelineEntry } from "../../../../server/competition/registrations";

type Row = RegistrationDashboard["page"]["rows"][number];

const REG_TONE = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  waitlisted: "warning",
  withdrawn: "neutral",
} as const;

const STATUS_FILTERS = ["", "submitted", "approved", "rejected", "waitlisted", "withdrawn"];
const SORTS = ["recent", "oldest", "name", "number", "status"];

/**
 * DA-22: the toast built its verb as `${action}d`, which spelled "rejectd" and
 * "waitlistd". Approve was correct by luck.
 */
const PAST_TENSE: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  waitlist: "waitlisted",
  restore: "restored",
};

export function RegistrationDashboardPanel({
  slug,
  stats,
  page,
  teams,
  filters,
}: {
  slug: string;
  stats: RegistrationDashboard["stats"];
  page: RegistrationDashboard["page"];
  teams: RegistrationDashboard["teams"];
  filters: { search: string; status: string; team: string; sort: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState(REJECTION_REASONS[0]);
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assignTeamId, setAssignTeamId] = useState("");
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [noteText, setNoteText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [ioOpen, setIoOpen] = useState(false);
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

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const runBulk = async (action: TriageAction) => {
    if (selected.size === 0) {
      return;
    }
    setBusy(true);
    const result = await bulkTriageAction(
      slug,
      [...selected],
      action,
      action === "reject" ? rejectReason : undefined,
    );
    setBusy(false);
    if (result.ok) {
      toast({
        title: `${String(result.applied ?? 0)} ${PAST_TENSE[action] ?? action} · ${String(result.skipped ?? 0)} skipped`,
        tone: "success",
      });
      setSelected(new Set());
      router.refresh();
    } else {
      toast({ title: result.error ?? "Bulk action failed.", tone: "danger" });
    }
  };

  const runSingle = async (id: string, action: TriageAction) => {
    setBusy(true);
    const result = await triageRegistrationAction(
      slug,
      id,
      action,
      action === "reject" ? rejectReason : undefined,
    );
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      toast({ title: result.error ?? "Action failed.", tone: "danger" });
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

  // Keyboard productivity: j/k move the cursor, x toggles selection, a approves
  // the selection (doc 31 peek-driven review). Ignored while typing in a field.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const approveSelectedRef = useRef(() => {
    /* replaced each render below */
  });
  approveSelectedRef.current = () => void runBulk("approve");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
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
          toggle(row.id);
        }
      } else if (event.key === "a" && selectedRef.current.size > 0) {
        approveSelectedRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [cursor, toggle]);

  const allOnPageSelected = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [rows, selected],
  );

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
          data-testid="open-import"
          onClick={() => {
            setIoOpen(true);
          }}
        >
          + Import players
        </Button>
      </div>
      <div className="stat-row" data-testid="stat-row" data-hydrated={hydrated ? "true" : "false"}>
        <StatTile
          label="Total"
          value={stats.total}
          testId="stat-total"
          active={filters.status === ""}
          onSelect={() => {
            pushQuery({ status: "", page: "1" });
          }}
        />
        <StatTile
          label="Submitted"
          value={stats.submitted}
          testId="stat-submitted"
          active={filters.status === "submitted"}
          onSelect={() => {
            pushQuery({ status: "submitted", page: "1" });
          }}
        />
        <StatTile
          label="Approved"
          value={stats.approved}
          testId="stat-approved"
          active={filters.status === "approved"}
          onSelect={() => {
            pushQuery({ status: "approved", page: "1" });
          }}
        />
        <StatTile
          label="Waitlisted"
          value={stats.waitlisted}
          testId="stat-waitlisted"
          active={filters.status === "waitlisted"}
          onSelect={() => {
            pushQuery({ status: "waitlisted", page: "1" });
          }}
        />
        <StatTile
          label="Rejected"
          value={stats.rejected}
          testId="stat-rejected"
          active={filters.status === "rejected"}
          onSelect={() => {
            pushQuery({ status: "rejected", page: "1" });
          }}
        />
      </div>

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
              pushQuery({ status: event.target.value, page: "1" });
            }}
          >
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status === "" ? "All statuses" : status}
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
            label="Sort"
            name="sort"
            value={filters.sort}
            onChange={(event) => {
              pushQuery({ sort: event.target.value, page: "1" });
            }}
          >
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {sort}
              </option>
            ))}
          </Select>
          <Button type="submit" data-testid="search-submit">
            Search
          </Button>
        </form>
        <p className="dash-hint">Shortcuts: j/k move · x select · a approve selected</p>
      </Card>

      {selected.size > 0 ? (
        <Card data-testid="bulk-bar">
          <div className="bulk-bar">
            <strong data-testid="bulk-count">{selected.size} selected</strong>
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
            <Select
              label="Reject reason"
              name="reason"
              value={rejectReason}
              onChange={(event) => {
                setRejectReason(event.target.value as (typeof REJECTION_REASONS)[number]);
              }}
            >
              {REJECTION_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void runBulk("reject")}
              loading={busy}
              data-testid="bulk-reject"
            >
              Reject
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
        <div className="table-scroll">
          <table className="reg-table" data-testid="reg-table">
            <thead>
              <tr>
                <th>
                  <VisuallyHidden>Select</VisuallyHidden>
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={allOnPageSelected}
                    onChange={() => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (allOnPageSelected) {
                          rows.forEach((r) => next.delete(r.id));
                        } else {
                          rows.forEach((r) => next.add(r.id));
                        }
                        return next;
                      });
                    }}
                  />
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
                    toggle(row.id);
                  }}
                  onDetails={() => void openDetails(row.id)}
                  onSingle={(action) => void runSingle(row.id, action)}
                  onMark={(marks) =>
                    void markRegistrationAction(slug, row.id, marks).then(() => {
                      router.refresh();
                    })
                  }
                  busy={busy}
                />
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="dash-hint">
                    No registrations match these filters.
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
                <Badge tone="neutral">{entry.action.replace("registration.", "")}</Badge>
                <span className="timeline-at">{formatDateTime(entry.at)}</span>
                {isNote(entry.meta) ? (
                  <span className="timeline-note">“{entry.meta.note}”</span>
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

      <Dialog
        open={ioOpen}
        onClose={() => {
          setIoOpen(false);
        }}
        title="Import players"
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
        <div className="io-panel" data-testid="io-panel">
          <label className="io-file" htmlFor="csv-input">
            <span>
              Paste or choose a CSV — columns: name, phone, role, base_price_band · optional:
              date_of_birth, batting_style, bowling_style
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
}: {
  label: string;
  value: number;
  testId: string;
  /** PX-4: tiles double as one-click status views (URL-backed, shareable). */
  onSelect?: () => void;
  active?: boolean;
}) {
  const tile = (
    <div className="stat-tile" data-testid={testId}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
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

function RegRow({
  row,
  active,
  checked,
  onToggle,
  onDetails,
  onSingle,
  onMark,
  busy,
}: {
  row: Row;
  active: boolean;
  checked: boolean;
  onToggle: () => void;
  onDetails: () => void;
  onSingle: (action: TriageAction) => void;
  onMark: (marks: { isIcon?: boolean; isCaptain?: boolean }) => void;
  busy: boolean;
}) {
  const canTriage = row.status === "submitted" || row.status === "waitlisted";
  return (
    <tr className={active ? "reg-row active" : "reg-row"} data-testid={`reg-${row.personId}`}>
      <td>
        <input
          type="checkbox"
          aria-label={`Select ${row.name ?? row.phone}`}
          checked={checked}
          onChange={onToggle}
        />
      </td>
      <td className="reg-number">{row.number}</td>
      <td>
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
                  Icon
                </Badge>
              ) : null}
            </span>
            <span className="registration-phone">{row.phone}</span>
            {row.duplicateName ? (
              <Badge tone="warning" data-testid="dup-flag">
                possible duplicate
              </Badge>
            ) : null}
          </div>
        </div>
      </td>
      <td>
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
      <td>
        <Badge tone={REG_TONE[row.status]}>{row.status}</Badge>
      </td>
      <td>{row.teamName ?? "—"}</td>
      <td className="reg-actions">
        {canTriage ? (
          <Button
            size="sm"
            onClick={() => {
              onSingle("approve");
            }}
            loading={busy}
          >
            Approve
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={row.isIcon ? "secondary" : "ghost"}
          onClick={() => {
            onMark({ isIcon: !row.isIcon });
          }}
          data-testid={`icon-toggle-${row.personId}`}
        >
          {row.isIcon ? "Icon ✓" : "Icon"}
        </Button>
        <Button
          size="sm"
          variant={row.isCaptain ? "secondary" : "ghost"}
          onClick={() => {
            onMark({ isCaptain: !row.isCaptain });
          }}
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
