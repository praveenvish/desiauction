"use client";

import {
  REQUIRED_IMPORT_FIELDS,
  mappingOf,
  tokenizeCsv,
  type ColumnMapping,
  type DateOrder,
  type UnplacedValue,
  type ValueMaps,
} from "@desiauction/core";
import { Button, Dialog, Tabs, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  drivePickerConfigAction,
  importCommitAction,
  importSheetAction,
  importInspectAction,
  importPreviewAction,
  saveImportMappingAction,
  setImportSheetAction,
  type DrivePickerConfig,
  type ImportInspection,
  type ImportPreview,
  type ImportShape,
} from "../../../../server/competition/actions";
import type { ImportSheet } from "../../../../server/competition/competitions";
import { readCsvFile as readCsvText } from "../../../../lib/csv-file";
import { formatDateTime } from "../../../../lib/format-date";
import {
  SheetAccessLost,
  exportSheetCsv,
  pickDriveSheet,
  preloadGoogle,
  requestDriveToken,
} from "../../../../lib/google-drive";
import { ColumnMapper, MappingSummary, mappingNeedsReview } from "./column-mapper";
import { CsvDrop } from "./csv-drop";
import { ImportErrors } from "./import-errors";
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
  /** The values this season could not place — see the preview effect. */
  const [unplaced, setUnplaced] = useState<UnplacedValue[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>("dmy");
  const [remember, setRemember] = useState(true);
  /* Fill blanks by default — a re-import must not silently revert a correction
     somebody made by hand in the app. `file-wins` is an explicit choice. */
  const [fileWins, setFileWins] = useState(false);
  /* Off by default: a transaction ID is a claim until the desk checks it. */
  const [paidWhenReferenced, setPaidWhenReferenced] = useState(false);
  const [usingSaved, setUsingSaved] = useState(false);
  /*
   * STEPPING ASIDE FOR GOOGLE'S PICKER.
   *
   * This dialog is modal: the browser keeps it in the top layer and makes the
   * rest of the page inert. Google's Picker is appended to the page, so it
   * opened BEHIND the dialog and could not be clicked — the first real run sat
   * on "Waiting for Google…" with the picker visible but dead underneath. While
   * the picker is up the dialog closes itself (its contents stay mounted, so
   * the photo step keeps its state) and reopens when the picker is done. The
   * ref is read by the native close event, which fires after the state change.
   */
  const [steppedAside, setSteppedAside] = useState(false);
  const steppedAsideRef = useRef(false);
  const [tab, setTab] = useState("csv");
  /** Remounts the photo step after an import, so it counts the new players. */
  const [photosKey, setPhotosKey] = useState(0);
  /** A sheet sync just imported players: the photo step opens its picker itself. */
  const [photosAutoStart, setPhotosAutoStart] = useState(false);
  /**
   * Every way out of the dialog. The next open starts on Players (where Sync
   * lives), and the photo step starts fresh — it counts who still needs a
   * photo when it mounts, and a count from before an upload is a wrong one.
   */
  const close = () => {
    setTab("csv");
    setPhotosAutoStart(false);
    setPhotosKey((key) => key + 1);
    onClose();
  };
  /*
   * THE CONNECTED GOOGLE SHEET (0093). Registration runs for weeks, and every
   * new batch used to mean Forms → Download → drop the zip. With the form's
   * responses sheet connected once, "Sync new players" reads it again through
   * the same mapping, preview and diff — only the new rows are new.
   */
  const [drive, setDrive] = useState<DrivePickerConfig | null>(null);
  const [sheet, setSheet] = useState<ImportSheet | null>(null);
  const [sheetStep, setSheetStep] = useState<string | null>(null);
  /** The text in the dialog came from the Sheet — a landed import stamps "last synced". */
  const [fromSheet, setFromSheet] = useState(false);
  useEffect(() => {
    if (!open) {
      return;
    }
    let live = true;
    void Promise.all([drivePickerConfigAction(slug), importSheetAction(slug)]).then(
      ([config, connected]) => {
        if (!live) {
          return;
        }
        setDrive(config);
        setSheet(connected);
        if (config !== null) {
          // The sign-in pop-up must open inside the click — see preloadGoogle.
          preloadGoogle();
        }
      },
    );
    return () => {
      live = false;
    };
  }, [open, slug]);
  const stepAside = (aside: boolean) => {
    steppedAsideRef.current = aside;
    setSteppedAside(aside);
  };
  /** The full column table, open on demand or whenever it has a question. */
  const [reviewColumns, setReviewColumns] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  /** The text box is for pasting; a file never needs it opened. */
  const [pasteOpen, setPasteOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  /**
   * The exact text the current preview was computed from. The errors list
   * edits rows BY LINE, so it must edit the file those line numbers describe —
   * not whatever the text box holds by the time the organizer presses Fix.
   */
  const [checkedText, setCheckedText] = useState("");
  /** Bumped to re-run the preview under an unchanged shape (a fixed row). */
  const [previewTick, setPreviewTick] = useState(0);
  const previewSeq = useRef(0);
  const csvRef = useRef<HTMLTextAreaElement>(null);
  const resetImport = () => {
    setPreview(null);
    setInspection(null);
    setMapping({});
    setUsingSaved(false);
    setReviewColumns(false);
    // A NEW file gets no answers from the last one. "Category 1 means band A"
    // was true of the roster the organizer just imported; carrying it into the
    // next file would rewrite values nobody looked at.
    setValueMaps({});
    setUnplaced([]);
  };

  /**
   * Read the file's headers and settle on a mapping — the one this club already
   * confirmed for this exact layout if there is one, otherwise the detected
   * guess. The preview itself follows from the effect below.
   *
   * Takes the text rather than reading state, because it runs straight after a
   * file lands, before any state set in the same tick has rendered.
   */
  const inspect = async (text: string) => {
    if (text.trim() === "") {
      return;
    }
    const read = await importInspectAction(slug, text);
    setInspection(read);
    if (!read.ok) {
      setMapping({});
      setPreview(null);
      return;
    }
    if (read.saved !== undefined) {
      setMapping(read.saved.mapping);
      setDateOrder(read.saved.dateOrder);
      // The saved VALUES too, which is the half that made saving worth it:
      // a club whose bands are "Category 1/2/3" answers once, not once per
      // season for the rest of the tournament's life.
      setValueMaps(read.saved.valueMaps);
      setUsingSaved(true);
    } else {
      setMapping(read.detected === undefined ? {} : mappingOf(read.detected));
      setUsingSaved(false);
    }
  };

  /** Put a file's text in the dialog and start its preview. */
  const loadText = (text: string, source: "file" | "sheet") => {
    if (csvRef.current) {
      csvRef.current.value = text;
    }
    setRowCount(
      Math.max(
        0,
        tokenizeCsv(text).filter((row) => row.some((cell) => cell.trim() !== "")).length - 1,
      ),
    );
    setFromSheet(source === "sheet");
    resetImport();
    void inspect(text);
  };

  // A Google Form download is `Form.csv.zip`; readCsvText opens either. The
  // preview starts on its own — choosing the file IS the request to see it.
  const readCsvFile = (file: File) => {
    setFileName(file.name);
    setRowCount(null);
    readCsvText(file).then(
      (text) => {
        loadText(text, "file");
      },
      (error: unknown) => {
        setFileName(null);
        toast({
          title: error instanceof Error ? error.message : "Couldn't read that file.",
          tone: "danger",
        });
      },
    );
  };

  /**
   * Read the connected Sheet (or the one just picked) and preview it. The
   * Google sign-in comes FIRST, inside the click, so its pop-up is allowed.
   */
  const syncSheet = async (target: { id: string; name: string } | null = sheet) => {
    if (drive === null || target === null) {
      return;
    }
    try {
      setSheetStep("Waiting for Google…");
      const token = await requestDriveToken(drive.clientId);
      setSheetStep("Reading your sheet…");
      const csv = await exportSheetCsv(token, target.id);
      setFileName(target.name);
      loadText(csv, "sheet");
      setSheetStep(null);
    } catch (error) {
      setSheetStep(null);
      toast({
        title:
          error instanceof SheetAccessLost
            ? `${error.message} Press "Change sheet" and pick it again.`
            : error instanceof Error
              ? error.message
              : "Couldn't read the sheet.",
        tone: "danger",
      });
    }
  };

  /** Pick the form's responses sheet in Google's picker, remember it, sync it. */
  const connectSheet = async () => {
    if (drive === null) {
      return;
    }
    try {
      setSheetStep("Waiting for Google…");
      const token = await requestDriveToken(drive.clientId);
      setSheetStep("Choose the sheet in the Google window…");
      stepAside(true);
      let picked;
      try {
        picked = await pickDriveSheet(drive, token);
      } finally {
        stepAside(false);
      }
      if (picked === null) {
        setSheetStep(null);
        return;
      }
      const saved = await setImportSheetAction(slug, { id: picked.id, name: picked.name });
      if (!saved.ok) {
        setSheetStep(null);
        toast({ title: saved.error ?? "Couldn't connect that sheet.", tone: "danger" });
        return;
      }
      setSheet({ id: picked.id, name: picked.name, syncedAt: null });
      setSheetStep("Reading your sheet…");
      const csv = await exportSheetCsv(token, picked.id);
      setFileName(picked.name);
      loadText(csv, "sheet");
      setSheetStep(null);
    } catch (error) {
      stepAside(false);
      setSheetStep(null);
      toast({
        title: error instanceof Error ? error.message : "Couldn't connect the sheet.",
        tone: "danger",
      });
    }
  };

  const disconnectSheet = async () => {
    const done = await setImportSheetAction(slug, null);
    if (done.ok) {
      setSheet(null);
      setFromSheet(false);
    }
  };

  const shape = (): ImportShape => ({
    mapping,
    valueMaps,
    dateOrder,
    policy: fileWins ? "file-wins" : "fill-blanks",
    paidWhenReferenced,
  });

  /**
   * THE PREVIEW FOLLOWS THE SHAPE.
   *
   * It used to be cleared on every change — a column re-pointed, a value
   * answered, a checkbox ticked — and the organizer had to press Preview again
   * to see what their change did, which read as the change doing nothing. Now
   * any change re-checks the file under the new shape. A sequence number drops
   * answers that arrive out of order, so a slow check can never overwrite a
   * newer one.
   */
  useEffect(() => {
    if (inspection?.ok !== true) {
      return;
    }
    const text = csvRef.current?.value ?? "";
    if (
      text.trim() === "" ||
      REQUIRED_IMPORT_FIELDS.some((field) => mapping[field] === undefined)
    ) {
      // A file missing a required column cannot be previewed into anything
      // useful; the mapper says which, which is the actionable answer. Any
      // check still in flight describes a mapping that no longer exists.
      previewSeq.current++;
      setChecking(false);
      setPreview(null);
      return;
    }
    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      setChecking(true);
      void importPreviewAction(slug, text, {
        mapping,
        valueMaps,
        dateOrder,
        policy: fileWins ? "file-wins" : "fill-blanks",
        paidWhenReferenced,
      }).then((result) => {
        if (seq !== previewSeq.current) {
          return;
        }
        setChecking(false);
        setCheckedText(text);
        setPreview(result);
        // The unplaced list outlives the preview it came with: it is replaced
        // only by a NEWER list, so it shrinks as the organizer answers it
        // rather than vanishing halfway through a column of five.
        setUnplaced(result.unplaced);
      });
    }, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [slug, inspection, mapping, valueMaps, dateOrder, fileWins, paidWhenReferenced, previewTick]);

  /**
   * ONE BUTTON FOR PASTED TEXT, AND THE MAPPING IS ALWAYS ON SCREEN BEFORE THE
   * COMMIT IS.
   *
   * A chosen file previews itself; this is for rows pasted into the box (and
   * for re-checking on demand). The first press reads the headers, later
   * presses re-check under whatever the organizer has since corrected.
   */
  const runPreview = async () => {
    if (inspection === null) {
      await inspect(csvRef.current?.value ?? "");
      return;
    }
    setPreviewTick((tick) => tick + 1);
  };

  /** A row corrected in the errors list: the file changes, the shape does not. */
  const applyFix = (next: string) => {
    if (csvRef.current) {
      csvRef.current.value = next;
    }
    setPreviewTick((tick) => tick + 1);
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
    const result = await importCommitAction(slug, text, {
      skipInvalid,
      shape: shape(),
      fromSheet,
    });
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
        setPreviewTick((tick) => tick + 1);
        return;
      }
      resetImport();
      setFileName(null);
      setRowCount(null);
      if (csvRef.current) {
        csvRef.current.value = "";
      }
      setPhotosKey((key) => key + 1);
      if (fromSheet) {
        // "Last synced" moves, and new players' photos are one step away: go
        // straight to it rather than closing on the organizer mid-routine.
        setFromSheet(false);
        void importSheetAction(slug).then(setSheet);
        if ((result.imported ?? 0) > 0) {
          setPhotosAutoStart(true);
          setTab("photos");
          return;
        }
      }
      close();
    } else {
      toast({ title: result.error ?? "Import failed.", tone: "danger" });
    }
  };

  return (
    <Dialog
      open={open && !steppedAside}
      onClose={() => {
        if (!steppedAsideRef.current) {
          close();
        }
      }}
      title="Import players & photos"
      size="wide"
      footer={
        <Button
          variant="ghost"
          onClick={() => {
            close();
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
        selectedId={tab}
        onSelect={(id) => {
          // A tab the organizer chose is theirs: no picker opening by itself.
          setPhotosAutoStart(false);
          setTab(id);
        }}
        tabs={[
          {
            id: "csv",
            label: "Players",
            content: (
              <div className="io-panel" data-testid="io-panel">
                {drive !== null ? (
                  <div className="drive-photos" data-testid="sheet-sync">
                    {sheet === null ? (
                      <>
                        <p>
                          <strong>Registrations still coming in?</strong> Connect your form&apos;s
                          Google Sheet once, then bring in new players with one click — no more
                          downloads.
                        </p>
                        <Button
                          onClick={() => void connectSheet()}
                          loading={sheetStep !== null}
                          disabled={sheetStep !== null}
                          data-testid="sheet-connect"
                        >
                          Connect Google Sheet
                        </Button>
                        <p className="dash-hint">
                          {sheetStep ??
                            "In Google Forms, open Responses → Link to Sheets first if you haven't."}
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          <strong>Google Sheet: {sheet.name}</strong>
                          {" · "}
                          {sheet.syncedAt === null
                            ? "not synced yet"
                            : `last synced ${formatDateTime(sheet.syncedAt)}`}
                        </p>
                        <div className="io-row">
                          <Button
                            onClick={() => void syncSheet()}
                            loading={sheetStep !== null}
                            disabled={sheetStep !== null}
                            data-testid="sheet-sync-btn"
                          >
                            Sync new players
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void connectSheet()}
                            disabled={sheetStep !== null}
                          >
                            Change sheet
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void disconnectSheet()}
                            disabled={sheetStep !== null}
                          >
                            Disconnect
                          </Button>
                        </div>
                        {sheetStep !== null ? <p className="dash-hint">{sheetStep}</p> : null}
                      </>
                    )}
                  </div>
                ) : null}
                <CsvDrop fileName={fileName} rowCount={rowCount} onFile={readCsvFile} />
                <p className="dash-hint" hidden={fileName !== null}>
                  In Google Forms, open <strong>Responses</strong> → <strong>⋮</strong> →{" "}
                  <strong>Download responses (.csv)</strong> and drop the file here. We match your
                  columns for you, and nothing is saved until you press Import.
                </p>
                <div hidden={!pasteOpen}>
                  <label className="io-file" htmlFor="csv-input">
                    <span>Paste rows from a spreadsheet, header row first</span>
                  </label>
                  <textarea
                    id="csv-input"
                    ref={csvRef}
                    className="csv-input"
                    data-testid="import-textarea"
                    rows={5}
                    placeholder="Name,Mobile,Playing role"
                    defaultValue=""
                    onChange={() => {
                      // Typing makes this a different file than the one read.
                      setFileName(null);
                      setRowCount(null);
                      resetImport();
                    }}
                  />
                </div>
                <div className="io-row">
                  {!pasteOpen ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPasteOpen(true);
                      }}
                      data-testid="import-paste-toggle"
                    >
                      Paste rows instead
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void runPreview()}
                    disabled={
                      inspection !== null &&
                      REQUIRED_IMPORT_FIELDS.some((field) => mapping[field] === undefined)
                    }
                    data-testid="import-preview-btn"
                  >
                    {inspection === null ? "Preview" : "Check again"}
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
                        Using the column matching you saved for this form. Change anything and the
                        new version replaces it.
                      </p>
                    ) : null}
                    {/* One sentence when every column landed; the table when
                          it has a question, or when the organizer asks for it.
                          The table stays mounted either way, so what it holds
                          is the single source of the mapping. */}
                    {!reviewColumns && !mappingNeedsReview(inspection, mapping) ? (
                      <MappingSummary
                        inspection={inspection}
                        mapping={mapping}
                        onReview={() => {
                          setReviewColumns(true);
                        }}
                      />
                    ) : null}
                    <div hidden={!reviewColumns && !mappingNeedsReview(inspection, mapping)}>
                      <ColumnMapper
                        inspection={inspection}
                        mapping={mapping}
                        onChange={(next) => {
                          setMapping(next);
                          // The values were judged under the old columns.
                          setValueMaps({});
                          setUnplaced([]);
                        }}
                      />
                    </div>
                    {/* The values, under the columns — the order the
                          organizer meets them in: which column is this, then
                          what do the words in it mean. */}
                    <ValueMapper
                      unplaced={unplaced}
                      valueMaps={valueMaps}
                      onChange={(next) => {
                        setValueMaps(next);
                      }}
                    />
                    {mapping.fee_reference !== undefined && mapping.fee_status === undefined ? (
                      <label className="io-inline import-paid" htmlFor="paid-when-referenced">
                        <input
                          id="paid-when-referenced"
                          type="checkbox"
                          data-testid="paid-when-referenced"
                          checked={paidWhenReferenced}
                          onChange={(event) => {
                            setPaidWhenReferenced(event.target.checked);
                          }}
                        />
                        <span>
                          Mark new players who gave a transaction ID as <strong>paid</strong>{" "}
                          <span className="dash-hint">
                            — only if you&apos;ve checked the payments
                          </span>
                        </span>
                      </label>
                    ) : null}
                    <details className="io-options">
                      <summary>Import options</summary>
                      <div className="io-row">
                        {mapping.date_of_birth !== undefined ? (
                          <label className="io-inline" htmlFor="date-order">
                            <span>Dates in this file read as</span>
                            <select
                              id="date-order"
                              className="mapping-select"
                              data-testid="date-order"
                              value={dateOrder}
                              onChange={(event) => {
                                setDateOrder(event.target.value === "mdy" ? "mdy" : "dmy");
                              }}
                            >
                              <option value="dmy">day / month / year</option>
                              <option value="mdy">month / day / year</option>
                            </select>
                          </label>
                        ) : null}
                        <label className="io-inline" htmlFor="file-wins">
                          <input
                            id="file-wins"
                            type="checkbox"
                            data-testid="file-wins"
                            checked={fileWins}
                            onChange={(event) => {
                              setFileWins(event.target.checked);
                            }}
                          />
                          <span>Let this file overwrite details already entered</span>
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
                          <span>Remember this column matching for next time</span>
                        </label>
                      </div>
                    </details>
                  </>
                ) : null}
                {checking ? (
                  <p className="dash-hint" role="status" data-testid="import-checking">
                    Checking the file…
                  </p>
                ) : null}
                {preview !== null ? (
                  <div className="import-preview" data-testid="import-preview">
                    <p className="import-verdict">
                      <strong>
                        {preview.validCount} valid player{preview.validCount === 1 ? "" : "s"}
                      </strong>{" "}
                      ready
                      {preview.errors.length > 0
                        ? ` · ${String(preview.errors.length)} need${preview.errors.length === 1 ? "s" : ""} fixing`
                        : ""}
                    </p>
                    {/* WHAT COMMITTING WOULD ACTUALLY DO. "197 valid rows" said
                          the same thing whether they were all new or all already
                          here — and the commit then silently did nothing with the
                          second case. */}
                    {/* Only when it adds something: a first import is all
                          "new", which the line above already said. */}
                    {preview.diff !== undefined &&
                    preview.diff.counts.changed +
                      preview.diff.counts.unchanged +
                      preview.diff.counts.reinstate >
                      0 ? (
                      <p className="import-diff-line" data-testid="import-diff-counts">
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
                        <table className="reg-table import-table" data-testid="import-diff-table">
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
                      <ImportErrors
                        errors={preview.errors}
                        text={checkedText}
                        mapping={mapping}
                        onFix={applyFix}
                      />
                    ) : null}
                    {/* A file with errors AND valid rows now has a way forward.
                          The button states the whole bargain — what lands and what
                          is left — so "skip" is a choice the organizer read, not a
                          default they were given. */}
                    {preview.errors.length > 0 && preview.validCount > 0 ? (
                      <Button
                        onClick={() => void commitImport(true)}
                        loading={busy}
                        disabled={checking}
                        data-testid="import-commit-partial"
                      >
                        {`Import ${String(preview.validCount)} valid, skip ${String(preview.errors.length)}`}
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => void commitImport()}
                      loading={busy}
                      variant={preview.errors.length > 0 ? "ghost" : "primary"}
                      disabled={checking || preview.errors.length > 0 || preview.validCount === 0}
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
                <p className="dash-hint import-tip">
                  Next season, try sharing the registration link at the top of this page instead —
                  players sign up straight into this list, photos included, and there&apos;s nothing
                  to import.
                </p>
              </div>
            ),
          },
          {
            id: "photos",
            label: "Photos",
            content: (
              <PhotoImportPanel
                key={photosKey}
                slug={slug}
                autoStart={photosAutoStart}
                onStepAside={stepAside}
                onDone={() => {
                  close();
                }}
              />
            ),
          },
        ]}
      />
    </Dialog>
  );
}
