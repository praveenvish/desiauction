"use client";

import { useId, useRef, useState } from "react";

import { PlayerImage, type PlayerImageSize } from "./player-image";
import styles from "./image-uploader.module.css";

// Client-side hints only — the server (media/actions + upload route) is the
// authoritative validator. Kept local so packages/ui stays dependency-light.
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

export type UploadOutcome = { ok: true; url: string } | { ok: false; error: string };

export interface ImageUploaderProps {
  /** Field label (e.g. "Team logo", "Player photo"). */
  label: string;
  /** Accessible name for the preview fallback mark. */
  name: string;
  /** Existing image URL, if one is already set. */
  currentUrl?: string;
  /** Stable seed for the fallback mark (id preferred over name). */
  seed?: string;
  /** Orchestrates request → PUT → attach; returns the new URL or an error. */
  onUpload: (file: File) => Promise<UploadOutcome>;
  size?: PlayerImageSize;
  shape?: "square" | "round";
}

export function ImageUploader({
  label,
  name,
  currentUrl,
  seed,
  onUpload,
  size = "xl",
  shape = "square",
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [url, setUrl] = useState<string | undefined>(currentUrl);
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!ALLOWED.includes(file.type)) {
      setError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be 5 MB or smaller.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setBusy(true);
    try {
      const result = await onUpload(file);
      if (result.ok) {
        setUrl(result.url);
        setPreview(undefined); // show the canonical URL; the blob is revoked below
        setError(null);
      } else {
        setError(result.error);
        setPreview(undefined);
      }
    } catch {
      setError("Upload failed. Please try again.");
      setPreview(undefined);
    } finally {
      setBusy(false);
      URL.revokeObjectURL(objectUrl);
    }
  }

  const shownSrc = preview ?? url;

  return (
    <div className={styles["uploader"]}>
      <PlayerImage
        name={name}
        seed={seed ?? ""}
        size={size}
        shape={shape}
        {...(shownSrc !== undefined ? { src: shownSrc } : {})}
      />
      <div className={styles["controls"]}>
        <span className={styles["label"]}>{label}</span>
        <button
          type="button"
          className={styles["button"]}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-busy={busy}
          aria-describedby={error !== null ? errorId : undefined}
        >
          {busy ? "Uploading…" : url !== undefined ? "Replace image" : "Upload image"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED.join(",")}
          className={styles["input"]}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              void handleFile(file);
            }
            event.target.value = "";
          }}
        />
        {error !== null ? (
          <span id={errorId} role="alert" className={styles["error"]}>
            {error}
          </span>
        ) : (
          <span className={styles["hint"]}>JPEG, PNG or WebP · up to 5 MB</span>
        )}
      </div>
    </div>
  );
}
