"use client";

import {
  Button,
  IMAGE_UPLOAD_ACCEPT,
  IconImage,
  IconPencil,
  IconUpload,
  PlayerImage,
  imageFileProblem,
  useToast,
  VisuallyHidden,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { runMediaUpload } from "../../../components/media/run-media-upload";
import {
  attachMedia,
  removeCompetitionImage,
  requestMediaUpload,
} from "../../../server/media/actions";

/**
 * The season's own two pictures, one card each: the square crest the public
 * directory shows beside the season, and the wide cover photo behind the
 * overview's hero banner (0082).
 *
 * Both ride the ONE media pipeline — presign (server action) → direct byte PUT
 * → attach — with subject `"competition"`, which the media guard gates on
 * `competition.manage`; `slot` only chooses the column. The generic
 * `ImageUploader` draws a square avatar, which is the wrong shape for a banner,
 * so the picker is composed here from its own rules (`imageFileProblem`,
 * `IMAGE_UPLOAD_ACCEPT`): one check, one wording, two shapes.
 *
 * The refresh matters: the picture is read by the hero, the public page and the
 * `/c` directory, so the page re-renders rather than trusting a local preview.
 */
export function SeasonImageCard({
  slug,
  competitionId,
  competitionName,
  slot,
  currentUrl,
}: {
  slug: string;
  competitionId: string;
  competitionName: string;
  slot: "logo" | "cover";
  currentUrl: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  // The optimistic picture, remembered against the server URL it stood in
  // for: once the refresh brings a different `currentUrl`, the server wins.
  const [draft, setDraft] = useState<{ src: string; over: string | null } | null>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cover = slot === "cover";
  const preview = draft !== null && draft.over === currentUrl ? draft.src : null;
  const shown = preview ?? currentUrl;
  const setPreview = (src: string | null) => {
    setDraft(src === null ? null : { src, over: currentUrl });
  };

  async function upload(file: File) {
    const problem = imageFileProblem(file);
    setError(problem);
    if (problem !== null) {
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setBusy("upload");
    try {
      const outcome = await runMediaUpload(
        file,
        (input) =>
          requestMediaUpload({ slug, subject: "competition", subjectId: competitionId, ...input }),
        (key) => attachMedia({ slug, subject: "competition", subjectId: competitionId, key, slot }),
      );
      if (outcome.ok) {
        setPreview(outcome.url);
        router.refresh();
      } else {
        setError(outcome.error);
        setPreview(null);
      }
    } catch {
      setError("Upload failed. Please try again.");
      setPreview(null);
    } finally {
      setBusy(null);
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function remove() {
    setBusy("remove");
    const result = await removeCompetitionImage({ slug, slot });
    setBusy(null);
    if (result.ok) {
      setPreview(null);
      setError(null);
      toast({ title: cover ? "Cover photo removed" : "Logo removed", tone: "success" });
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  const title = cover ? "Cover photo" : "Tournament logo";
  const noun = cover ? "cover photo" : "logo";

  // A ROW, not a card (2026-09-27): the logo and the cover were two half-page
  // cards of explanation. On the overview they are two lines of "How the season
  // looks" — each says whether it is set and offers the one act.
  return (
    <li
      className="ov-look"
      data-set={shown !== null ? "" : undefined}
      data-testid={cover ? "season-cover" : "season-branding"}
    >
      {cover ? (
        <span
          className="ov-look-thumb ov-cover-frame"
          data-empty={shown === null ? "true" : undefined}
        >
          {shown !== null ? (
            <img src={shown} alt="" width={72} height={24} decoding="async" loading="lazy" />
          ) : (
            <IconImage size={18} />
          )}
        </span>
      ) : (
        <span className="ov-look-thumb ov-logo-frame">
          <PlayerImage
            name={competitionName}
            seed={competitionId}
            size="sm"
            decorative
            {...(shown !== null ? { src: shown } : {})}
          />
        </span>
      )}
      <span className="ov-look-text">
        <strong>{title}</strong>
        {error !== null ? (
          <span id={errorId} role="alert" className="ov-image-error">
            {error}
          </span>
        ) : (
          <span>
            {shown !== null
              ? cover
                ? "Set — it sits behind the season’s banner."
                : "Set — shown on the public page and the directory."
              : cover
                ? "Not set — the banner keeps its floodlight gradient. About 1600 × 500."
                : "Not set — players see the season’s initials."}
          </span>
        )}
      </span>
      <span className="ov-look-actions">
        {currentUrl !== null ? (
          <Button
            variant="ghost"
            size="sm"
            loading={busy === "remove"}
            disabled={busy !== null}
            data-testid={cover ? "season-cover-remove" : "season-logo-remove"}
            onClick={() => void remove()}
          >
            Remove
            <VisuallyHidden> {noun}</VisuallyHidden>
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          loading={busy === "upload"}
          disabled={busy !== null}
          aria-describedby={error !== null ? errorId : undefined}
          data-testid={cover ? "season-cover-upload" : "season-logo-upload"}
          onClick={() => inputRef.current?.click()}
        >
          {shown !== null ? <IconPencil size={16} /> : <IconUpload size={16} />}
          {shown !== null ? "Change" : "Upload"}
          <VisuallyHidden> {noun}</VisuallyHidden>
        </Button>
      </span>
      {/* The visible button proxies the click, so this input is mechanism, not
          a control: out of the tab order and the accessibility tree together. */}
      <input
        ref={inputRef}
        aria-hidden="true"
        tabIndex={-1}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        className="ov-image-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) {
            void upload(file);
          }
          event.target.value = "";
        }}
      />
    </li>
  );
}
