"use client";

import { matchPhotoFiles, type PhotoMatch } from "@desiauction/core";
import { Badge, Button, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { runMediaUpload } from "../../../../components/media/run-media-upload";
import { attachMedia, requestMediaUpload } from "../../../../server/media/actions";
import { photoTargetsAction } from "../../../../server/competition/actions";

// Client-side hints only — mirrors ImageUploader; the media actions re-validate.
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

type EntryStatus = "ready" | "blocked" | "uploading" | "done" | "failed";

interface Entry {
  file: File;
  match: PhotoMatch;
  status: EntryStatus;
  /** Why blocked/failed — filename-match reasons live on `match` instead. */
  detail?: string;
}

const RULE_LABEL = { number: "by reg. number", phone: "by phone", name: "by name" } as const;

/**
 * Bulk photo import (the photos arm of the Import dialog). The organizer picks
 * a folder's worth of images; each filename is matched to a registration —
 * registration number, then phone, then full name — and the whole batch is
 * shown for review BEFORE a single byte is uploaded (the CSV import's
 * validate-then-commit discipline, applied to images). Upload then rides the
 * certified presign → PUT → attach path per file, which also records the
 * organizer-attestation consent (DPDP §5) exactly like a single-photo upload.
 */
export function PhotoImportPanel({ slug, onDone }: { slug: string; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [matching, setMatching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const pickFiles = async (list: FileList) => {
    const files = [...list];
    setMatching(true);
    const targets = await photoTargetsAction(slug);
    setMatching(false);
    const matches = matchPhotoFiles(
      files.map((file) => file.name),
      targets,
    );
    setEntries(
      files.map((file, index) => {
        const match = matches[index] as PhotoMatch;
        if (!match.ok) {
          return { file, match, status: "blocked" as const };
        }
        if (!ALLOWED.includes(file.type)) {
          return { file, match, status: "blocked" as const, detail: "not a JPEG, PNG or WebP" };
        }
        if (file.size > MAX_BYTES) {
          return { file, match, status: "blocked" as const, detail: "larger than 5 MB" };
        }
        return { file, match, status: "ready" as const };
      }),
    );
    setProgress(0);
  };

  const reset = () => {
    setEntries([]);
    setProgress(0);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const uploadAll = async () => {
    setUploading(true);
    let done = 0;
    let failed = 0;
    // Sequential on purpose: presigned PUTs from a phone on club-ground wifi
    // behave far better one at a time, and progress stays honest.
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as Entry;
      if (entry.status !== "ready" || !entry.match.ok) {
        continue;
      }
      const registrationId = entry.match.target.registrationId;
      setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, status: "uploading" } : e)));
      const outcome = await runMediaUpload(
        entry.file,
        (input) =>
          requestMediaUpload({ slug, subject: "player", subjectId: registrationId, ...input }),
        (key) => attachMedia({ slug, subject: "player", subjectId: registrationId, key }),
      );
      if (outcome.ok) {
        done++;
      } else {
        failed++;
      }
      setEntries((prev) =>
        prev.map((e, j) =>
          j === i
            ? outcome.ok
              ? { ...e, status: "done" }
              : { ...e, status: "failed", detail: outcome.error }
            : e,
        ),
      );
      setProgress(done + failed);
    }
    setUploading(false);
    toast({
      title:
        failed === 0
          ? `${String(done)} photo${done === 1 ? "" : "s"} uploaded`
          : `${String(done)} uploaded · ${String(failed)} failed`,
      tone: failed === 0 ? "success" : "danger",
    });
    router.refresh();
    if (failed === 0 && done > 0) {
      // Clear before closing: the panel stays mounted inside the dialog, so a
      // kept batch would greet the next open with the last run's table.
      reset();
      onDone();
    }
  };

  const ready = entries.filter((entry) => entry.status === "ready").length;
  const blocked = entries.filter((entry) => entry.status === "blocked").length;
  // Stable during the run (blocked never changes), unlike `ready`, which drains.
  const attempted = entries.length - blocked;
  const finished = entries.length > 0 && entries.every((entry) => entry.status !== "ready");

  return (
    <div className="io-panel" data-testid="photo-import-panel">
      <label className="io-file" htmlFor="photo-files">
        <span>
          Choose player photos — each file is matched to a player by its name: registration number
          (R7K2M9.jpg), mobile (9876543210.jpg) or full name (Rohit Sharma.jpg). Downloaded a
          Google Form&apos;s folder from Drive? Drop it in as-is — the question and the copy number
          it adds (&ldquo;Rohit Sharma - Upload your photo (1).jpg&rdquo;) are ignored.
        </span>
      </label>
      <div className="io-row">
        <input
          id="photo-files"
          ref={inputRef}
          type="file"
          accept={ALLOWED.join(",")}
          multiple
          aria-label="Choose player photos"
          data-testid="photo-files"
          disabled={uploading}
          onChange={(event) => {
            if (event.target.files !== null && event.target.files.length > 0) {
              void pickFiles(event.target.files);
            }
          }}
        />
        {entries.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={reset} disabled={uploading}>
            Clear
          </Button>
        ) : null}
      </div>
      {matching ? <p className="dash-hint">Matching files to players…</p> : null}
      {entries.length > 0 ? (
        <>
          <div className="table-scroll">
            <table className="reg-table photo-match-table" data-testid="photo-match-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Player</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  /* `.reg-table` hides its `thead` below 1100px and restores the
                     headings from `data-label` (seasons.css). */
                  <tr key={index}>
                    <td data-label="File" className="photo-match-file">
                      {entry.file.name}
                    </td>
                    <td data-label="Player">
                      {entry.match.ok ? (
                        <>
                          {entry.match.target.name ?? "Unnamed"}{" "}
                          <span className="registration-phone">{entry.match.target.number}</span>{" "}
                          <Badge tone="neutral">{RULE_LABEL[entry.match.rule]}</Badge>
                          {entry.match.target.hasPhoto ? (
                            <Badge tone="warning">replaces current photo</Badge>
                          ) : null}
                        </>
                      ) : (
                        <span className="photo-match-reason">{entry.match.reason}</span>
                      )}
                    </td>
                    <td data-label="Status">
                      {entry.status === "ready" ? (
                        <Badge tone="info">ready</Badge>
                      ) : entry.status === "uploading" ? (
                        <Badge tone="info">uploading…</Badge>
                      ) : entry.status === "done" ? (
                        <Badge tone="success">uploaded</Badge>
                      ) : entry.status === "failed" ? (
                        <Badge tone="danger">{entry.detail ?? "failed"}</Badge>
                      ) : (
                        <Badge tone="danger">{entry.detail ?? "skipped"}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!finished ? (
            <Button
              onClick={() => void uploadAll()}
              loading={uploading}
              disabled={ready === 0}
              data-testid="photo-upload-all"
            >
              {uploading
                ? `Uploading ${String(Math.min(progress + 1, attempted))} of ${String(attempted)}…`
                : ready === 0
                  ? "Nothing to upload"
                  : blocked > 0
                    ? `Upload ${String(ready)} photo${ready === 1 ? "" : "s"} (${String(blocked)} skipped)`
                    : `Upload ${String(ready)} photo${ready === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
