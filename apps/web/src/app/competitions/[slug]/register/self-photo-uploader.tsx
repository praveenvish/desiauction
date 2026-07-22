"use client";

import { ImageUploader, type UploadOutcome } from "@desiauction/ui";

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
    const requested = await requestOwnPhotoUpload({
      slug,
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
    const attached = await attachOwnPhoto({ slug, key: requested.key });
    if (attached.ok) {
      track("register.photo_added");
      return { ok: true, url: attached.url };
    }
    return { ok: false, error: attached.error };
  }

  return (
    <ImageUploader label="Your photo (optional)" name={name} size="xl" shape="round" onUpload={onUpload} />
  );
}
