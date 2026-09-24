"use client";

import { IconFileCheck, IconUpload } from "@desiauction/ui";
import { useState } from "react";

/**
 * WHERE THE FILE GOES.
 *
 * The players tab used to open on an empty monospace box labelled "Paste CSV
 * rows here" — the most technical-looking thing in the product, on the screen
 * an organizer meets first and most often. What they actually hold is a
 * download from Google Forms (a .zip) or a spreadsheet, so the screen now asks
 * for exactly that, accepts it dropped or chosen, and says in one line where
 * Google keeps it.
 *
 * The native input stays in the DOM (visually hidden, still focusable) so the
 * keyboard and assistive tech get a real file control, and the whole zone is
 * its label, so clicking anywhere in it opens the picker.
 */
export function CsvDrop({
  fileName,
  rowCount,
  onFile,
}: {
  fileName: string | null;
  /** Players in the file, once read — shown so the organizer can sanity-check. */
  rowCount: number | null;
  onFile: (file: File) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor="import-file"
      className={`csv-drop${over ? " csv-drop-over" : ""}${fileName !== null ? " csv-drop-done" : ""}`}
      data-testid="csv-drop"
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files[0];
        if (file !== undefined) {
          onFile(file);
        }
      }}
    >
      <input
        id="import-file"
        type="file"
        className="csv-drop-input"
        accept=".csv,text/csv,.zip,application/zip"
        data-testid="import-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFile(file);
          }
          // Choosing the same file again (after fixing it in Sheets) must fire.
          event.target.value = "";
        }}
      />
      {fileName === null ? (
        <>
          <IconUpload size={28} aria-hidden className="csv-drop-icon" />
          <span className="csv-drop-title">Drop your Google Form download here</span>
          <span className="csv-drop-sub">
            or <span className="csv-drop-link">choose a file</span> — the .zip from Google Forms, or
            a CSV saved from Excel or Google Sheets
          </span>
        </>
      ) : (
        <>
          <IconFileCheck size={28} aria-hidden className="csv-drop-icon" />
          <span className="csv-drop-title">{fileName}</span>
          <span className="csv-drop-sub">
            {rowCount === null
              ? "Reading…"
              : `${String(rowCount)} player${rowCount === 1 ? "" : "s"} in this file`}
            {" · "}
            <span className="csv-drop-link">choose a different file</span>
          </span>
        </>
      )}
    </label>
  );
}
