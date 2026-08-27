"use client";

import { ImageUploader, type UploadOutcome } from "@desiauction/ui";
import { useRouter } from "next/navigation";

import { runMediaUpload } from "../../../components/media/run-media-upload";
import { attachMedia, requestMediaUpload } from "../../../server/media/actions";

/**
 * Organizer tournament-logo upload — the competition-level sibling of
 * `teams/team-logo-uploader` (parity §3.1). Same three-step media flow —
 * presign (server action) → direct byte PUT → attach (server action) — with
 * subject `"competition"`, which the media guard has always accepted
 * (media/authz `resolveMediaSubject` + `requireMediaWrite`) and always
 * persisted to `competitions.logo_url`. Nothing in the product ever called it,
 * so every season fell back to a text monogram on the public directory.
 *
 * The refresh matters: the mark this sets is read by the season overview, the
 * public season page and the `/c` directory, so the page has to re-render
 * rather than trust the uploader's own optimistic preview.
 */
export function CompetitionLogoUploader({
  slug,
  competitionId,
  competitionName,
  currentUrl,
}: {
  slug: string;
  competitionId: string;
  competitionName: string;
  currentUrl?: string;
}) {
  const router = useRouter();

  async function onUpload(file: File): Promise<UploadOutcome> {
    const outcome = await runMediaUpload(
      file,
      (i) => requestMediaUpload({ slug, subject: "competition", subjectId: competitionId, ...i }),
      (key) => attachMedia({ slug, subject: "competition", subjectId: competitionId, key }),
    );
    if (outcome.ok) {
      router.refresh();
    }
    return outcome;
  }

  return (
    <ImageUploader
      label="Tournament logo"
      name={competitionName}
      seed={competitionId}
      size="lg"
      onUpload={onUpload}
      {...(currentUrl !== undefined ? { currentUrl } : {})}
    />
  );
}
