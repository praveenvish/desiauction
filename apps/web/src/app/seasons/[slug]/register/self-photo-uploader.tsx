"use client";

import { ImageUploader, type UploadOutcome } from "@desiauction/ui";

import { runMediaUpload } from "../../../../components/media/run-media-upload";
import { track } from "../../../../lib/telemetry";
import { attachOwnPhoto, requestOwnPhotoUpload } from "../../../../server/media/actions";

/**
 * Player self-photo at registration (parity §E). A player adds their OWN face —
 * the self-serve path that fills the showcase/board/overlay without organizer
 * effort. Orchestrates presign → PUT → attach against the self-scoped actions;
 * consent is captured as self_upload.
 */
export function SelfPhotoUploader({ slug, name }: { slug: string; name: string }) {
  async function onUpload(file: File): Promise<UploadOutcome> {
    const outcome = await runMediaUpload(
      file,
      (i) => requestOwnPhotoUpload({ slug, ...i }),
      (key) => attachOwnPhoto({ slug, key }),
    );
    if (outcome.ok) {
      track("register.photo_added");
    }
    return outcome;
  }

  return (
    <ImageUploader label="Your photo (optional)" name={name} size="xl" shape="round" onUpload={onUpload} />
  );
}
