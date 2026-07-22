"use client";

import { ImageUploader, type UploadOutcome } from "@desiauction/ui";
import { useRouter } from "next/navigation";

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
    const requested = await requestMediaUpload({
      slug,
      subject: "team",
      subjectId: teamId,
      contentType: file.type,
      byteSize: file.size,
    });
    if (!requested.ok) {
      return { ok: false, error: requested.error };
    }
    const put = await fetch(requested.uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!put.ok) {
      return { ok: false, error: "Upload failed. Please try again." };
    }
    const attached = await attachMedia({
      slug,
      subject: "team",
      subjectId: teamId,
      key: requested.key,
    });
    if (!attached.ok) {
      return { ok: false, error: attached.error };
    }
    router.refresh();
    return { ok: true, url: attached.url };
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
