"use client";

import { matchPhotoFiles, type PhotoMatch, type PhotoTarget } from "@desiauction/core";
import { Badge, Button, IconUpload, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { runMediaUpload } from "../../../../components/media/run-media-upload";
import {
  downloadDriveFile,
  hasFreshDriveToken,
  pickDriveFiles,
  preloadGoogle,
  requestDriveToken,
} from "../../../../lib/google-drive";
import { expandPhotoFiles } from "../../../../lib/photo-files";
import { shrinkImage } from "../../../../lib/shrink-image";
import { attachMedia, requestMediaUpload } from "../../../../server/media/actions";
import {
  drivePickerConfigAction,
  photoTargetsAction,
  type DrivePickerConfig,
} from "../../../../server/competition/actions";

// Client-side hints only — mirrors ImageUploader; the media actions re-validate.
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
/* HEIC is what an iPhone uploads to a Google Form. It is accepted HERE so the
   browser can convert it to JPEG on the way up (`shrinkImage`); the upload
   itself only ever sees the formats above. */
const CONVERTIBLE = ["image/heic", "image/heif"];
const MAX_BYTES = 5 * 1024 * 1024;

type EntryStatus = "ready" | "blocked" | "uploading" | "done" | "failed";

interface Entry {
  file: File;
  match: PhotoMatch;
  /** The organizer's own answer for a file the names could not place. */
  manual?: PhotoTarget;
  status: EntryStatus;
  /** Why blocked/failed — filename-match reasons live on `match` instead. */
  detail?: string;
  /** Object URL for the thumbnail — revoked when the batch is cleared. */
  preview: string;
  /** Fetched by the Drive link in this player's own row — an exact match. */
  viaDrive?: boolean;
}

/** Drive downloads in flight at once — enough to be quick, few enough for club wifi. */
const DRIVE_PARALLEL = 4;

const RULE_LABEL = { number: "by reg. number", phone: "by phone", name: "by name" } as const;

/** Who this file will land on, however that was decided. */
function targetOf(entry: Entry): PhotoTarget | null {
  return entry.manual ?? (entry.match.ok ? entry.match.target : null);
}

function formatProblem(file: File): string | undefined {
  return ALLOWED.includes(file.type) || CONVERTIBLE.includes(file.type)
    ? undefined
    : "not a photo (JPEG, PNG, WebP or HEIC)";
}

/**
 * Bulk photo import (the photos arm of the Import dialog). The organizer drops
 * a folder's worth of images — or the .zip Google Drive gives them for a
 * form's upload folder — and each file is matched to a registration by
 * registration number, then phone, then full name. The whole batch is shown
 * for review BEFORE a single byte is uploaded (the CSV import's
 * validate-then-commit discipline, applied to images), with each photo's
 * thumbnail beside the player it will land on, and a player picker for any
 * file the names could not place.
 *
 * Upload rides the certified presign → PUT → attach path per file, which also
 * records the organizer-attestation consent (DPDP §5) exactly like a
 * single-photo upload. Each photo is shrunk in the browser first, so a phone
 * camera's 6 MB original no longer fails the 5 MB limit.
 */
export function PhotoImportPanel({
  slug,
  onDone,
  onStepAside,
  autoStart = false,
}: {
  slug: string;
  onDone: () => void;
  /** Hide the (modal) import dialog while Google's Picker is on screen. */
  onStepAside?: (aside: boolean) => void;
  /**
   * Open the Drive picker as soon as this step appears — set right after a
   * Sheet sync imported players, so their photos are the SAME sitting rather
   * than a second job. Only acts while that sync's Google sign-in is fresh:
   * the picker is part of the page, but a sign-in window is a pop-up, and a
   * pop-up the person didn't click for is one the browser blocks.
   */
  autoStart?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [targets, setTargets] = useState<PhotoTarget[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [matching, setMatching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [over, setOver] = useState(false);
  /* "Get photos from Google Drive": shown only when the Google project is
     configured AND the season has players whose Form row linked a photo. */
  const [drive, setDrive] = useState<DrivePickerConfig | null>(null);
  const [linked, setLinked] = useState<PhotoTarget[]>([]);
  const [driveStep, setDriveStep] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([drivePickerConfigAction(slug), photoTargetsAction(slug)]).then(
      ([config, found]) => {
        if (!live) {
          return;
        }
        setDrive(config);
        // Only players still WITHOUT a photo: after a weekly sync this is the
        // new arrivals, not the whole roster again.
        const withLinks = found.filter(
          (target) => (target.driveId ?? null) !== null && !target.hasPhoto,
        );
        setLinked(withLinks);
        if (config !== null && withLinks.length > 0) {
          preloadGoogle();
        }
      },
    );
    return () => {
      live = false;
    };
  }, [slug]);

  // Thumbnails hold memory until revoked; a closed dialog must give it back.
  const previews = useRef<string[]>([]);
  useEffect(
    () => () => {
      previews.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
    },
    [],
  );

  const pickFiles = async (chosen: File[]) => {
    setMatching(true);
    let expanded;
    try {
      expanded = await expandPhotoFiles(chosen);
    } catch (error) {
      setMatching(false);
      toast({
        title: error instanceof Error ? error.message : "Couldn't open those files.",
        tone: "danger",
      });
      return;
    }
    const found = await photoTargetsAction(slug);
    setMatching(false);
    const matches = matchPhotoFiles(
      expanded.files.map((file) => file.name),
      found,
    );
    clearPreviews();
    setTargets(found);
    setSkipped(expanded.skipped);
    setEntries(
      expanded.files.map((file, index) => {
        const match = matches[index] as PhotoMatch;
        const preview = URL.createObjectURL(file);
        previews.current.push(preview);
        const problem = formatProblem(file);
        if (problem !== undefined) {
          return { file, match, status: "blocked" as const, detail: problem, preview };
        }
        return {
          file,
          match,
          status: match.ok ? ("ready" as const) : ("blocked" as const),
          preview,
        };
      }),
    );
    setProgress(0);
  };

  /**
   * THE EXACT ROUTE. Each player's photo is fetched by the Drive link their own
   * Form row carried, so the match is certain — no file names involved. The
   * organizer signs in to Google, selects every photo Google shows (only this
   * form's), and the review table fills with each face already on its player.
   */
  const fromDrive = async (
    config: DrivePickerConfig | null = drive,
    wanted: readonly PhotoTarget[] = linked,
  ): Promise<void> => {
    if (config === null) {
      return;
    }
    const byDriveId = new Map(
      wanted.flatMap((target) =>
        target.driveId === undefined || target.driveId === null
          ? []
          : [[target.driveId, target] as const],
      ),
    );
    try {
      setDriveStep("Waiting for Google…");
      const token = await requestDriveToken(config.clientId);
      setDriveStep("Choose the photos in the Google window…");
      onStepAside?.(true);
      let picked;
      try {
        picked = await pickDriveFiles(config, token, [...byDriveId.keys()]);
      } finally {
        onStepAside?.(false);
      }
      if (picked.length === 0) {
        setDriveStep(null);
        return;
      }
      const found = await photoTargetsAction(slug);
      // The last batch's thumbnails, released once this one is on screen.
      const stale = previews.current;
      previews.current = [];
      const fresh = new Map(found.map((target) => [target.registrationId, target]));
      const next: Entry[] = [];
      const outside: string[] = [];
      let done = 0;
      const queue = [...picked];
      const work = async () => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
          const known = byDriveId.get(item.id);
          const target = known === undefined ? undefined : fresh.get(known.registrationId);
          if (target === undefined) {
            outside.push(item.name);
          } else {
            try {
              // Shrunk now rather than at upload: 110 camera originals held in
              // memory for the review would be hundreds of megabytes.
              const file = await shrinkImage(await downloadDriveFile(token, item));
              const preview = URL.createObjectURL(file);
              previews.current.push(preview);
              const problem = formatProblem(file);
              next.push({
                file,
                match: { file: file.name, ok: false, reason: "" },
                manual: target,
                viaDrive: true,
                status: problem === undefined ? "ready" : "blocked",
                ...(problem === undefined ? {} : { detail: problem }),
                preview,
              });
            } catch (error) {
              outside.push(
                `${item.name} (${error instanceof Error ? error.message : "download failed"})`,
              );
            }
          }
          done++;
          setDriveStep(
            `Downloading photos from Google Drive… ${String(done)} of ${String(picked.length)}`,
          );
        }
      };
      await Promise.all(Array.from({ length: DRIVE_PARALLEL }, work));
      stale.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      // The sheet's order, so the review reads like the organizer's roster.
      const order = new Map(found.map((target, index) => [target.registrationId, index]));
      next.sort(
        (a, b) =>
          (order.get(targetOf(a)?.registrationId ?? "") ?? 0) -
          (order.get(targetOf(b)?.registrationId ?? "") ?? 0),
      );
      setTargets(found);
      setSkipped(outside);
      setEntries(next);
      setProgress(0);
      setDriveStep(null);
    } catch (error) {
      setDriveStep(null);
      toast({
        title:
          error instanceof Error ? error.message : "Couldn't get the photos from Google Drive.",
        tone: "danger",
      });
    }
  };

  const clearPreviews = () => {
    previews.current.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    previews.current = [];
  };

  const reset = () => {
    clearPreviews();
    setEntries([]);
    setSkipped([]);
    setProgress(0);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  /** The organizer places a file by hand — or takes that answer back. */
  const assign = (index: number, registrationId: string) => {
    setEntries((prev) =>
      prev.map((entry, j) => {
        if (j !== index) {
          return entry;
        }
        const manual = targets.find((target) => target.registrationId === registrationId);
        if (manual === undefined) {
          const next: Entry = {
            file: entry.file,
            match: entry.match,
            status: "blocked",
            preview: entry.preview,
          };
          return next;
        }
        return { ...entry, manual, status: "ready" as const };
      }),
    );
  };

  const uploadAll = async () => {
    setUploading(true);
    let done = 0;
    let failed = 0;
    // Sequential on purpose: presigned PUTs from a phone on club-ground wifi
    // behave far better one at a time, and progress stays honest.
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i] as Entry;
      const target = targetOf(entry);
      if (entry.status !== "ready" || target === null) {
        continue;
      }
      const registrationId = target.registrationId;
      setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, status: "uploading" } : e)));
      const file = await shrinkImage(entry.file);
      const problem = !ALLOWED.includes(file.type)
        ? "an iPhone HEIC photo this browser can't convert — try again in Safari"
        : file.size > MAX_BYTES
          ? "still larger than 5 MB after shrinking"
          : null;
      const outcome =
        problem !== null
          ? { ok: false as const, error: problem }
          : await runMediaUpload(
              file,
              (input) =>
                requestMediaUpload({
                  slug,
                  subject: "player",
                  subjectId: registrationId,
                  ...input,
                }),
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

  // The auto-start (see the prop): once, and only when the Drive option is
  // loaded, has photos to offer, and the sync's sign-in is still fresh.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (
      !autoStart ||
      autoStarted.current ||
      drive === null ||
      linked.length === 0 ||
      !hasFreshDriveToken()
    ) {
      return;
    }
    autoStarted.current = true;
    void fromDrive(drive, linked);
  });

  const ready = entries.filter((entry) => entry.status === "ready").length;
  const blocked = entries.filter((entry) => entry.status === "blocked").length;
  const unmatched = entries.filter(
    (entry) => targetOf(entry) === null && entry.detail === undefined,
  ).length;
  // Stable during the run (blocked never changes), unlike `ready`, which drains.
  const attempted = entries.length - blocked;
  const finished = entries.length > 0 && entries.every((entry) => entry.status !== "ready");
  /* A player takes at most one photo per batch — the rule `matchPhotoFiles`
     already keeps — so the picker only offers players nobody has claimed. */
  const claimed = new Set(
    entries.map((entry) => targetOf(entry)?.registrationId).filter((id) => id !== undefined),
  );

  return (
    <div className="io-panel" data-testid="photo-import-panel">
      {drive !== null && linked.length > 0 ? (
        <div className="drive-photos" data-testid="drive-photos">
          <p>
            <strong>
              {linked.length} player{linked.length === 1 ? "" : "s"} from your Google Form{" "}
              {linked.length === 1 ? "has a" : "have a"} photo waiting in Google Drive.
            </strong>{" "}
            Get them straight from Google Drive — each photo lands on the player whose form it came
            with.
          </p>
          <Button
            onClick={() => void fromDrive()}
            loading={driveStep !== null}
            disabled={uploading || driveStep !== null}
            data-testid="drive-photos-btn"
          >
            Get photos from Google Drive
          </Button>
          <p className="dash-hint">
            {driveStep ??
              "Sign in with the Google account that owns the form (or one it's shared with), select all the photos Google shows, and press Select. We only see the photos you select."}
          </p>
        </div>
      ) : null}
      <label
        htmlFor="photo-files"
        className={`csv-drop${over ? " csv-drop-over" : ""}`}
        data-testid="photo-drop"
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
          if (event.dataTransfer.files.length > 0 && !uploading) {
            void pickFiles([...event.dataTransfer.files]);
          }
        }}
      >
        <input
          id="photo-files"
          ref={inputRef}
          type="file"
          className="csv-drop-input"
          accept={[...ALLOWED, ...CONVERTIBLE, ".heic", ".zip", "application/zip"].join(",")}
          multiple
          data-testid="photo-files"
          disabled={uploading}
          onChange={(event) => {
            if (event.target.files !== null && event.target.files.length > 0) {
              void pickFiles([...event.target.files]);
            }
          }}
        />
        <IconUpload size={28} aria-hidden className="csv-drop-icon" />
        <span className="csv-drop-title">Drop player photos here</span>
        <span className="csv-drop-sub">
          or <span className="csv-drop-link">choose files</span> — photos, or the .zip Google Drive
          gives you for your form&apos;s photo folder
        </span>
      </label>
      <p className="dash-hint">
        Each photo is matched to a player by its file name: registration number (R7K2M9.jpg), mobile
        (9876543210.jpg) or full name (Rohit Sharma.jpg). Anything we can&apos;t place, you pick the
        player for. Large phone photos are shrunk for you.
      </p>
      {matching ? <p className="dash-hint">Opening and matching photos…</p> : null}
      {entries.length > 0 ? (
        <>
          <div className="io-row">
            <p className="import-verdict" data-testid="photo-summary">
              <strong>
                {entries.length - unmatched} of {entries.length} matched
              </strong>
              {unmatched > 0 ? ` · ${String(unmatched)} need a player` : ""}
            </p>
            <Button variant="ghost" size="sm" onClick={reset} disabled={uploading}>
              Clear
            </Button>
          </div>
          {skipped.length > 0 ? (
            <p className="dash-hint">
              Left out: {skipped.slice(0, 5).join(" · ")}
              {skipped.length > 5 ? ` and ${String(skipped.length - 5)} more` : ""}
            </p>
          ) : null}
          <div className="table-scroll">
            <table
              className="reg-table import-table photo-match-table"
              data-testid="photo-match-table"
            >
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Player</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const target = targetOf(entry);
                  return (
                    <tr key={index}>
                      <td data-label="Photo" className="photo-match-file">
                        <span className="photo-match-thumb-row">
                          {/* A blob: URL of the organizer's own file — nothing
                              for next/image to optimise. */}
                          <img src={entry.preview} alt="" className="photo-match-thumb" />
                          <span>{entry.file.name}</span>
                        </span>
                      </td>
                      <td data-label="Player">
                        {entry.viaDrive === true && entry.manual !== undefined ? (
                          <>
                            {entry.manual.name ?? "Unnamed"}{" "}
                            <span className="registration-phone">{entry.manual.number}</span>{" "}
                            <Badge tone="success">by Drive link</Badge>
                            {entry.manual.hasPhoto ? (
                              <Badge tone="warning">replaces current photo</Badge>
                            ) : null}
                          </>
                        ) : entry.match.ok && entry.manual === undefined ? (
                          <>
                            {entry.match.target.name ?? "Unnamed"}{" "}
                            <span className="registration-phone">{entry.match.target.number}</span>{" "}
                            <Badge tone="neutral">{RULE_LABEL[entry.match.rule]}</Badge>
                            {entry.match.target.hasPhoto ? (
                              <Badge tone="warning">replaces current photo</Badge>
                            ) : null}
                          </>
                        ) : entry.detail === undefined || entry.manual !== undefined ? (
                          <select
                            className="mapping-select"
                            aria-label={`Player for ${entry.file.name}`}
                            data-testid={`photo-assign-${String(index)}`}
                            value={entry.manual?.registrationId ?? ""}
                            disabled={uploading || entry.status === "done"}
                            onChange={(event) => {
                              assign(index, event.target.value);
                            }}
                          >
                            <option value="">Choose the player…</option>
                            {targets
                              .filter(
                                (option) =>
                                  option.registrationId === target?.registrationId ||
                                  !claimed.has(option.registrationId),
                              )
                              .map((option) => (
                                <option key={option.registrationId} value={option.registrationId}>
                                  {option.name ?? "Unnamed"} · {option.number}
                                  {option.hasPhoto ? " (has a photo)" : ""}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <span className="photo-match-reason">
                            {entry.match.ok ? entry.match.target.name : entry.match.reason}
                          </span>
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
                        ) : entry.detail !== undefined ? (
                          <Badge tone="danger">{entry.detail}</Badge>
                        ) : (
                          <Badge tone="neutral">pick a player</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
