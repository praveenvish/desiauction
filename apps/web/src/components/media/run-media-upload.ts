import type { UploadOutcome } from "@desiauction/ui";

// Single source of truth for the client media-upload orchestration (parity
// §3.1): presign → direct byte PUT → attach. The three uploaders (team crest,
// organizer player photo, player self-photo) supply their own server actions;
// the request→PUT→attach dance lives here ONCE and is unit-tested.

export type PresignOutcome =
  { ok: true; uploadUrl: string; key: string } | { ok: false; error: string };

export type AttachOutcome = { ok: true; url: string } | { ok: false; error: string };

export async function runMediaUpload(
  file: File,
  request: (input: { contentType: string; byteSize: number }) => Promise<PresignOutcome>,
  attach: (key: string) => Promise<AttachOutcome>,
): Promise<UploadOutcome> {
  const requested = await request({ contentType: file.type, byteSize: file.size });
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
  const attached = await attach(requested.key);
  return attached.ok ? { ok: true, url: attached.url } : { ok: false, error: attached.error };
}
