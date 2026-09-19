"use client";

import {
  REQUIRED_IMPORT_FIELDS,
  mappingOf,
  type ColumnMapping,
  type DateOrder,
  type UnplacedValue,
  type ValueMaps,
} from "@desiauction/core";
import { Button, Dialog, Tabs, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  importCommitAction,
  importInspectAction,
  importPreviewAction,
  saveImportMappingAction,
  type ImportInspection,
  type ImportPreview,
  type ImportShape,
} from "../../../../server/competition/actions";
import { ColumnMapper } from "./column-mapper";
import { PhotoImportPanel } from "./photo-import";
import { ValueMapper } from "./value-mapper";

/**
 * Import players (CSV) and photos — lifted out of the dashboard unchanged, so
 * the page that shows the players is no longer also the page that parses
 * spreadsheets. Every rule it keeps is documented where it is kept.
 */
export function ImportDialog({
  slug,
  open,
  onClose,
  registrationOpen,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  registrationOpen: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  /* The mapping step. `inspection` null = we have not read the file's headers
     yet, which is the state the dialog opens in. */
  const [inspection, setInspection] = useState<ImportInspection | null>(null);
  /*
   * What the file's own vocabulary means in this season — "Category 1" is band
   * A, "Arrows" is Andheri Arrows. The data path for this has existed since
   * migration 0033 (`org_import_mappings.value_maps`) and `applyMapping` has
   * always applied it; there was simply no way to author one, so it was sent as
   * `{}` on every import.
   */
  const [valueMaps, setValueMaps] = useState<ValueMaps>({});
  /** The values this season could not place — see `refreshPreview`. */
  const [unplaced, setUnplaced] = useState<UnplacedValue[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>("dmy");
  const [remember, setRemember] = useState(true);
  /* Fill blanks by default — a re-import must not silently revert a correction
     somebody made by hand in the app. `file-wins` is an explicit choice. */
  const [fileWins, setFileWins] = useState(false);
  const [usingSaved, setUsingSaved] = useState(false);
  const csvRef = useRef<HTMLTextAreaElement>(null);
  const resetImport = () => {
    setPreview(null);
    setInspection(null);
    setMapping({});
    setUsingSaved(false);
    // A NEW file gets no answers from the last one. "Category 1 means band A"
    // was true of the roster the organizer just imported; carrying it into the
    // next file would rewrite values nobody looked at.
    setValueMaps({});
    setUnplaced([]);
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
    valueMaps,
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
        // The saved VALUES too, which is the half that made saving worth it:
        // a club whose bands are "Category 1/2/3" answers once, not once per
        // season for the rest of the tournament's life.
        setValueMaps(read.saved.valueMaps);
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
    // `active` rather than `shape()` because the mapping may have been settled
    // a few lines above and `mapping` state has not caught up yet. Everything
    // else comes from the shape, INCLUDING the value maps, which this call used
    // to leave out — so an organizer's answer changed nothing until the second
    // press, which reads as the feature not working.
    await refreshPreview(text, { ...shape(), mapping: active });
  };

  /**
   * Re-validate and keep the unplaced list, which outlives the preview.
   *
   * The list has to survive its own answers: mapping a value makes the preview
   * stale, and a stale preview is cleared — but if the list lived on the
   * preview it would vanish the instant the organizer touched it, halfway
   * through a column of five. It is replaced only by a NEWER list, so it
   * shrinks as it is filled in rather than disappearing.
   */
  const refreshPreview = async (text: string, active: ImportShape): Promise<void> => {
    const result = await importPreviewAction(slug, text, active);
    setPreview(result);
    setUnplaced(result.unplaced);
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
        valueMaps,
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
        // Under the SAME shape the commit just used: re-reading the leftover
        // rows against no mapping at all would report every one of them broken
        // for a reason the organizer had already fixed.
        await refreshPreview(text, shape());
        return;
      }
      resetImport();
      if (csvRef.current) {
        csvRef.current.value = "";
      }
      onClose();
    } else {
      toast({ title: result.error ?? "Import failed.", tone: "danger" });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        onClose();
      }}
      title="Import players & photos"
      size="wide"
      footer={
        <Button
          variant="ghost"
          onClick={() => {
            onClose();
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
                        Using the mapping you saved for this form. Change anything below and the new
                        version replaces it.
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
                        // And the unplaced values were computed under it.
                        setValueMaps({});
                        setUnplaced([]);
                      }}
                    />
                    {/* The values, under the columns — the order the
                          organizer meets them in: which column is this, then
                          what do the words in it mean. */}
                    <ValueMapper
                      unplaced={unplaced}
                      valueMaps={valueMaps}
                      onChange={(next) => {
                        setValueMaps(next);
                        // The preview counted rows this answer just fixed.
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
                  onClose();
                }}
              />
            ),
          },
        ]}
      />
    </Dialog>
  );
}
