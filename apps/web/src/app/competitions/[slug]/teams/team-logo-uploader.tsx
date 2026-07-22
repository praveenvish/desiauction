"use client";

import { ImageUploader, type UploadOutcome } from "@desiauction/ui";
import { useRouter } from "next/navigation";

import { runMediaUpload } from "../../../../components/media/run-media-upload";
import { attachMedia, requestMediaUpload } from "../../../../server/media/actions";

/**
 * Organizer team-crest upload (parity §3.1). Orchestrates the three-step media
 * flow — presign (server action) → direct byte PUT → attach (server action) —
 * and refreshes so the new crest renders on this page and the public directory.
 * The UI primitive stays app-agnostic; this wrapper owns the wiring.
 */
export function TeamLogoUploader({
  slug,
  teamId,
  teamName,
  currentUrl,
}: {
  slug: string;
  teamId: string;
  teamName: string;
  currentUrl?: string;
}) {
  const router = useRouter();

  async function onUpload(file: File): Promise<UploadOutcome> {
    const outcome = await runMediaUpload(
      file,
      (i) => requestMediaUpload({ slug, subject: "team", subjectId: teamId, ...i }),
      (key) => attachMedia({ slug, subject: "team", subjectId: teamId, key }),
    );
    if (outcome.ok) {
      router.refresh();
    }
    return outcome;
  }

  return (
    <ImageUploader
      label="Team crest"
      name={teamName}
      seed={teamId}
      size="lg"
      onUpload={onUpload}
      {...(currentUrl !== undefined ? { currentUrl } : {})}
    />
  );
}
