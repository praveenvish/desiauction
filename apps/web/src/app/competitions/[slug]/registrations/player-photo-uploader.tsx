"use client";

import { ImageUploader, type UploadOutcome } from "@desiauction/ui";
import { useRouter } from "next/navigation";

import { attachMedia, requestMediaUpload } from "../../../../server/media/actions";

/**
 * Organizer player-photo upload (parity §3.1). Same three-step flow as the team
 * crest — presign → PUT → attach — for subject "player" (subjectId is the
 * registration id; the photo lands person-level with attestation consent, DPDP
 * §5). Refreshes so the photo appears in the table and downstream board/showcase.
 */
export function PlayerPhotoUploader({
  slug,
  registrationId,
  playerName,
  currentUrl,
}: {
  slug: string;
  registrationId: string;
  playerName: string;
  currentUrl?: string;
}) {
  const router = useRouter();

  async function onUpload(file: File): Promise<UploadOutcome> {
    const requested = await requestMediaUpload({
      slug,
      subject: "player",
      subjectId: registrationId,
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
      subject: "player",
      subjectId: registrationId,
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
      label="Player photo"
      name={playerName}
      seed={registrationId}
      size="lg"
      shape="round"
      onUpload={onUpload}
      {...(currentUrl !== undefined ? { currentUrl } : {})}
    />
  );
}
