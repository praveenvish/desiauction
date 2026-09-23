import { MAX_IMAGE_BYTES, deriveMediaKey, type MediaSubject } from "@desiauction/core";

import { imageTypeOfKey, sanitizeImage } from "./sanitize";
import type { StoragePort } from "./storage-port";

export type IngestResult =
  | {
      ok: true;
      /** The sanitized object's key — the one to persist. */
      key: string;
      /** The client's raw upload, to delete once the new key is committed. */
      rawKey: string;
    }
  | { ok: false; error: string };

/**
 * Turn the object the CLIENT uploaded into one WE wrote (P0-6).
 *
 * Reads the raw upload back with a hard cap, sanitizes it (sanitize.ts), and
 * writes the result under a FRESH key — same org/subject/subjectId, new token,
 * extension of the format actually encoded. A new key rather than an
 * overwrite: the raw key was public-readable from the moment the PUT landed,
 * so a CDN may already hold the unsanitized bytes under it; nothing ever
 * persists or links that key, and it is deleted once the attach commits.
 *
 * A raw upload that is too big or not a real image is deleted here and
 * refused — it never reaches a row.
 */
export async function ingestUpload(
  port: StoragePort,
  rawKey: string,
  target: { orgId: string; subject: MediaSubject; subjectId: string },
  token: string,
): Promise<IngestResult> {
  const declared = imageTypeOfKey(rawKey);
  if (declared === null) {
    return { ok: false, error: "Invalid image reference." };
  }
  const read = await port.readObject(rawKey, MAX_IMAGE_BYTES);
  if (read.status === "missing") {
    return { ok: false, error: "The upload did not arrive. Please try again." };
  }
  if (read.status === "too_large") {
    await discard(port, rawKey);
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }
  const clean = await sanitizeImage(read.bytes, declared);
  if (!clean.ok) {
    await discard(port, rawKey);
    return clean;
  }
  const key = deriveMediaKey({ ...target, contentType: clean.contentType, token });
  await port.writeObject(key, clean.contentType, clean.bytes);
  return { ok: true, key, rawKey };
}

/** Best-effort removal; an object we cannot delete is still never attached. */
export async function discard(port: StoragePort, key: string): Promise<void> {
  try {
    await port.delete(key);
  } catch {
    // Already gone, or the store is unreachable; no row points at it.
  }
}
