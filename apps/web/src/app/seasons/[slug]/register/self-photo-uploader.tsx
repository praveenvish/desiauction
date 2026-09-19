"use client";

import {
  Button,
  IconCamera,
  IMAGE_UPLOAD_ACCEPT,
  imageFileProblem,
  PlayerImage,
  type PlayerImageSize,
} from "@desiauction/ui";
import { useId, useRef, useState, type ReactNode } from "react";

import { runMediaUpload } from "../../../../components/media/run-media-upload";
import { track } from "../../../../lib/telemetry";
import { attachOwnPhoto, requestOwnPhotoUpload } from "../../../../server/media/actions";

/**
 * Player self-photo at registration (parity §E). A player adds their OWN face —
 * the self-serve path that fills the showcase/board/overlay without organizer
 * effort. Orchestrates presign → PUT → attach against the self-scoped actions;
 * consent is captured as self_upload.
 *
 * The face (or the initials mark) is the first thing the wizard shows, so this
 * lays out its own avatar rather than the kit's side-by-side uploader: `hero`
 * is the large centred portrait on the "You" step, `inline` is the summary
 * card's avatar with whatever the card puts beside it (`children`). The photo
 * URL is owned by the wizard, so a photo added on step one is the photo on the
 * confirmation too. The file rule is the kit's, not a copy of it.
 */
export function SelfPhotoUploader({
  slug,
  name,
  photoUrl,
  onUploaded,
  variant = "hero",
  children,
}: {
  slug: string;
  name: string;
  photoUrl: string | null;
  onUploaded: (url: string) => void;
  variant?: "hero" | "inline";
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    const problem = imageFileProblem(file);
    setError(problem);
    if (problem !== null) {
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setBusy(true);
    try {
      const outcome = await runMediaUpload(
        file,
        (input) => requestOwnPhotoUpload({ slug, ...input }),
        (key) => attachOwnPhoto({ slug, key }),
      );
      if (outcome.ok) {
        track("register.photo_added");
        onUploaded(outcome.url);
      } else {
        setError(outcome.error);
      }
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setPreview(null);
      setBusy(false);
      URL.revokeObjectURL(objectUrl);
    }
  }

  const shown = preview ?? photoUrl;
  const size: PlayerImageSize = variant === "hero" ? "xl" : "lg";
  const label = busy ? "Uploading…" : photoUrl === null ? "Add photo" : "Change photo";

  return (
    <div className={`reg-photo reg-photo-${variant}`} data-testid="register-photo">
      <span className="reg-photo-frame">
        <PlayerImage
          name={name}
          size={size}
          shape="round"
          {...(shown !== null ? { src: shown } : {})}
        />
      </span>
      <div className="reg-photo-body">
        {variant === "inline" ? children : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy}
          aria-describedby={error !== null ? errorId : undefined}
          data-testid="register-photo-button"
          onClick={() => inputRef.current?.click()}
        >
          <IconCamera size={16} />
          {label}
        </Button>
        {/* The visible button proxies the click, so this input is a mechanism,
            not a control: out of the accessibility tree and the tab order. */}
        <input
          ref={inputRef}
          aria-hidden="true"
          tabIndex={-1}
          type="file"
          accept={IMAGE_UPLOAD_ACCEPT}
          className="reg-photo-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              void handleFile(file);
            }
            event.target.value = "";
          }}
        />
        {error !== null ? (
          <span id={errorId} role="alert" className="register-error">
            {error}
          </span>
        ) : null}
        {variant === "hero" ? children : null}
      </div>
    </div>
  );
}
