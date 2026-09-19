"use client";

import { Button, Dialog, useToast } from "@desiauction/ui";
import { useMemo, useState } from "react";

import {
  DEFAULT_EXPORT_COLUMNS,
  EXPORT_GROUP_LABEL,
  EXPORT_PRESETS,
  EXPORT_ROWS_LABEL,
  exportColumnsFor,
  type ExportGroup,
  type ExportRows,
} from "../../../../lib/export-columns";
import {
  exportRegistrationsAction,
  type DashboardParams,
} from "../../../../server/competition/actions";

interface Remembered {
  columns: string[];
  rows: ExportRows;
}

const STORE_KEY = "da-export-choice";

function recall(): Remembered | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<Remembered>;
    return Array.isArray(parsed.columns) && typeof parsed.rows === "string"
      ? { columns: parsed.columns.filter((key) => typeof key === "string"), rows: parsed.rows }
      : null;
  } catch {
    return null;
  }
}

function remember(choice: Remembered): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(choice));
  } catch {
    // A private window keeps no memory; the export itself is unaffected.
  }
}

/**
 * Hand a spreadsheet the file. The byte-order mark is for Excel, which reads a
 * BOM-less CSV as the machine's legacy code page — "₹" and every Devanagari
 * name arrive as mojibake without it. Every other reader ignores it.
 */
export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * CHOOSE WHAT LEAVES, THEN DOWNLOAD IT.
 *
 * The export used to write one fixed file of sixteen columns for every
 * purpose. Now the organizer picks a purpose (an auction sheet, a contact
 * list, a jersey order, the fee desk, the full roster) or ticks exactly the
 * columns they want, and which players: everyone, the approved, the auction
 * pool, what the table is showing, or one team. The last choice is remembered,
 * so the second export is one click.
 */
interface ExportDialogProps {
  slug: string;
  open: boolean;
  onClose: () => void;
  /** The season's pack attributes — they become columns of their own. */
  sportAttributes: readonly { key: string; label: string }[];
  teams: readonly { id: string; name: string }[];
  /** The dashboard's live filter; offering "What's on screen" needs one. */
  view?: DashboardParams;
  /** Opened from a team's page: that squad, and no team picker. */
  fixedTeam?: { id: string; name: string };
}

export function ExportDialog(props: ExportDialogProps) {
  // Mounted only while open: the remembered choice lives in this browser, so
  // reading it during a server render would disagree with the client's.
  return props.open ? <OpenExportDialog {...props} /> : null;
}

function OpenExportDialog({
  slug,
  open,
  onClose,
  sportAttributes,
  teams,
  view,
  fixedTeam,
}: ExportDialogProps) {
  const toast = useToast();
  const columns = useMemo(() => exportColumnsFor(sportAttributes), [sportAttributes]);
  const [initial] = useState<Remembered>(
    () => recall() ?? { columns: [...DEFAULT_EXPORT_COLUMNS], rows: "all" },
  );
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(initial.columns));
  const [rows, setRows] = useState<ExportRows>(
    initial.rows === "view" && view === undefined ? "all" : initial.rows,
  );
  const [teamId, setTeamId] = useState(fixedTeam?.id ?? "");
  const [busy, setBusy] = useState(false);

  const presetOn = EXPORT_PRESETS.find((preset) => {
    const want = new Set([
      ...preset.columns,
      ...(preset.withSportAttributes === true ? sportAttributes.map((a) => a.key) : []),
    ]);
    return want.size === chosen.size && [...want].every((key) => chosen.has(key));
  });

  const groups = useMemo(() => {
    const byGroup = new Map<ExportGroup, typeof columns>();
    for (const column of columns) {
      byGroup.set(column.group, [...(byGroup.get(column.group) ?? []), column]);
    }
    return [...byGroup.entries()];
  }, [columns]);

  const rowChoices: ExportRows[] =
    view !== undefined ? ["all", "approved", "pool", "view"] : ["all", "approved", "pool"];

  const run = async () => {
    setBusy(true);
    const ordered = columns.filter((column) => chosen.has(column.key)).map((column) => column.key);
    const result = await exportRegistrationsAction(slug, {
      columns: ordered,
      rows,
      ...(teamId !== "" ? { teamId } : {}),
      ...(rows === "view" && view !== undefined ? { view } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      toast({ title: result.error, tone: "danger" });
      return;
    }
    remember({ columns: ordered, rows });
    downloadCsv(result.csv, result.filename);
    toast({ title: `Exported ${result.filename}`, tone: "success" });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={fixedTeam !== undefined ? `Export ${fixedTeam.name}` : "Export players"}
      size="wide"
      footer={
        <>
          <span className="pd-export-summary" aria-live="polite">
            {chosen.size} column{chosen.size === 1 ? "" : "s"} ·{" "}
            {EXPORT_ROWS_LABEL[rows].toLowerCase()}
            {teamId !== "" && fixedTeam === undefined
              ? ` · ${teams.find((team) => team.id === teamId)?.name ?? ""}`
              : ""}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void run()}
            loading={busy}
            disabled={chosen.size === 0}
            data-testid="export-download"
          >
            Download CSV
          </Button>
        </>
      }
    >
      <div className="pd-export" data-testid="export-dialog">
        <section>
          <h3 className="pd-export-h">What is it for?</h3>
          <div className="pd-presets">
            {EXPORT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="pd-preset"
                aria-pressed={presetOn?.id === preset.id}
                data-testid={`export-preset-${preset.id}`}
                onClick={() => {
                  setChosen(
                    new Set([
                      ...preset.columns,
                      ...(preset.withSportAttributes === true
                        ? sportAttributes.map((attribute) => attribute.key)
                        : []),
                    ]),
                  );
                  if (fixedTeam === undefined || preset.rows !== "view") {
                    setRows(preset.rows === "view" && view === undefined ? "all" : preset.rows);
                  }
                }}
              >
                <span className="pd-preset-label">{preset.label}</span>
                <span className="pd-preset-purpose">{preset.purpose}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="pd-export-h">Which players?</h3>
          <div className="pd-segment" role="group" aria-label="Which players">
            {rowChoices.map((choice) => (
              <button
                key={choice}
                type="button"
                className="pd-segment-item"
                aria-pressed={rows === choice}
                onClick={() => {
                  setRows(choice);
                }}
                data-testid={`export-rows-${choice}`}
              >
                {EXPORT_ROWS_LABEL[choice]}
              </button>
            ))}
          </div>
          {fixedTeam === undefined && teams.length > 0 ? (
            <label className="pd-inline-field">
              <span>Team</span>
              <select
                className="pd-input pd-select"
                value={teamId}
                onChange={(event) => {
                  setTeamId(event.target.value);
                }}
                data-testid="export-team"
              >
                <option value="">Every team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </section>

        <section>
          <div className="pd-export-cols-head">
            <h3 className="pd-export-h">Columns</h3>
            <span className="pd-export-bulk">
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setChosen(new Set(columns.map((column) => column.key)));
                }}
              >
                All
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setChosen(new Set());
                }}
              >
                None
              </button>
            </span>
          </div>
          <div className="pd-export-groups">
            {groups.map(([group, list]) => (
              <fieldset key={group} className="pd-export-group">
                <legend>{EXPORT_GROUP_LABEL[group]}</legend>
                {list.map((column) => (
                  <label key={column.key} className="pd-check">
                    <input
                      type="checkbox"
                      checked={chosen.has(column.key)}
                      onChange={() => {
                        setChosen((current) => {
                          const next = new Set(current);
                          if (next.has(column.key)) {
                            next.delete(column.key);
                          } else {
                            next.add(column.key);
                          }
                          return next;
                        });
                      }}
                      data-testid={`export-col-${column.key}`}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <p className="pd-setting-hint">
            Headers match the import, so any file you export can be edited in Excel and imported
            back. Father’s name is never exported.
          </p>
        </section>
      </div>
    </Dialog>
  );
}
