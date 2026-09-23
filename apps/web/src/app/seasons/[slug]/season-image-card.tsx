"use client";

import {
  Button,
  IMAGE_UPLOAD_ACCEPT,
  IconImage,
  IconPencil,
  IconUpload,
  PlayerImage,
  SectionCard,
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

  return (
    <SectionCard
      title={title}
      className="ov-image-card"
      data-testid={cover ? "season-cover" : "season-branding"}
      action={
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
          {shown !== null ? "Edit" : "Upload"}
          <VisuallyHidden> {noun}</VisuallyHidden>
        </Button>
      }
    >
      <div className="ov-image" data-shape={cover ? "wide" : "square"}>
        {cover ? (
          <span className="ov-cover-frame" data-empty={shown === null ? "true" : undefined}>
            {shown !== null ? (
              // Shown as the hero will crop it: object-fit cover, wide. The
              // intrinsic size is the frame's own 16:5 at its 208px width.
              <img src={shown} alt="" width={208} height={65} decoding="async" loading="lazy" />
            ) : (
              <IconImage size={28} />
            )}
          </span>
        ) : (
          <span className="ov-logo-frame">
            <PlayerImage
              name={competitionName}
              seed={competitionId}
              size="xl"
              decorative
              {...(shown !== null ? { src: shown } : {})}
            />
          </span>
        )}
        <div className="ov-image-text">
          <p>
            {cover
              ? "The wide picture behind this season’s banner — your ground, last year’s final. Without one, the banner keeps its floodlight gradient."
              : "Shown beside this season on the public directory and on its public page. Without one, players see the season’s initials."}
          </p>
          {error !== null ? (
            <p id={errorId} role="alert" className="ov-image-error">
              {error}
            </p>
          ) : (
            <p className="ov-image-hint">
              {cover ? "About 1600 × 500 · " : ""}JPEG, PNG or WebP · up to 5 MB
            </p>
          )}
          {currentUrl !== null ? (
            <Button
              variant="ghost"
              size="sm"
              className="ov-image-remove"
              loading={busy === "remove"}
              disabled={busy !== null}
              data-testid={cover ? "season-cover-remove" : "season-logo-remove"}
              onClick={() => void remove()}
            >
              Remove {noun}
            </Button>
          ) : null}
        </div>
      </div>
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
    </SectionCard>
  );
}
