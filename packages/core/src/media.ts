/**
 * Media validation + object-key derivation (parity foundation, §3.1). Pure — no
 * IO, no randomness, no ambient time. The storage adapter (S3/R2/local) lives in
 * apps/web/src/server/media and consumes these; nothing here touches a network.
 *
 * We persist a storage KEY, never a signed URL — the port signs at read time.
 */

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** 5 MiB — comfortably covers a phone photo; rejects accidental video/raw. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSION: Record<AllowedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

export type MediaSubject = "player" | "team" | "competition";

export interface MediaUpload {
  contentType: string;
  byteSize: number;
}

export type MediaValidation = { ok: true } | { ok: false; error: string };

/**
 * The first bytes of the allowed formats.
 *
 * `Content-Type` is a claim the CLIENT makes; it costs nothing to lie. The
 * upload path checked only that claim, so a text file (or a script, or a
 * polyglot) was stored under a .png key and served from the media origin
 * (audit 2026-08-18, P3-3). Sniffing the actual bytes makes the extension and
 * the content agree.
 *
 * WebP is a RIFF container: "RIFF" then four size bytes then "WEBP", so the
 * check skips bytes 4..7.
 */
const MAGIC: Record<AllowedImageType, (bytes: Uint8Array) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) =>
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a,
  "image/webp": (b) =>
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50,
};

/**
 * True when the bytes really are the format the caller claims. Callers that
 * persist an upload MUST gate on this as well as on `validateUpload`.
 */
export function bytesMatchImageType(contentType: string, bytes: Uint8Array): boolean {
  if (!isAllowedImageType(contentType)) {
    return false;
  }
  if (bytes.length < 12) {
    return false;
  }
  return MAGIC[contentType](bytes);
}

export function validateUpload(upload: MediaUpload): MediaValidation {
  if (!isAllowedImageType(upload.contentType)) {
    return { ok: false, error: "Only JPEG, PNG or WebP images are allowed." };
  }
  if (upload.byteSize <= 0) {
    return { ok: false, error: "The file is empty." };
  }
  if (upload.byteSize > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }
  return { ok: true };
}

/**
 * Deterministic storage key. Tenant-scoped by orgId so a bucket policy can pin
 * isolation. `token` is a caller-supplied opaque cache-buster (e.g. a fresh
 * ULID) — kept as a parameter so this stays pure and testable.
 *
 *   org/{orgId}/{subject}/{subjectId}/{token}.{ext}
 */
export function deriveMediaKey(args: {
  orgId: string;
  subject: MediaSubject;
  subjectId: string;
  contentType: AllowedImageType;
  token: string;
}): string {
  const ext = EXTENSION[args.contentType];
  return `org/${args.orgId}/${args.subject}/${args.subjectId}/${args.token}.${ext}`;
}

// Exactly the shape `deriveMediaKey` emits: `org/{26}/{subject}/{26}/{26}.{ext}`.
// ids are ULIDs (char 26). Each segment is [0-9A-Za-z] only — no `.` and no `/`
// inside a segment — so `..` and path separators are structurally impossible.
// This is the SECURITY boundary a storage adapter uses before touching a path.
const MEDIA_KEY_RE =
  /^org\/[0-9A-Za-z]{26}\/(?:player|team|competition)\/[0-9A-Za-z]{26}\/[0-9A-Za-z]{26}\.(?:jpg|png|webp)$/;

/**
 * True only for a well-formed, traversal-safe media key (the exact output of
 * `deriveMediaKey`). Callers that turn a key into a filesystem path or a storage
 * object MUST gate on this — a key arriving from the client is untrusted.
 */
export function isValidMediaKey(key: string): boolean {
  return MEDIA_KEY_RE.test(key);
}

/**
 * True only when `key` is a valid media key AND its embedded org/subject/subjectId
 * segments match the just-authorized target (S2). Binds an attach to what the
 * caller was actually authorized for, so a client cannot attach an arbitrary or
 * cross-tenant key. The token/extension tail stays free (the uploaded object).
 */
export function mediaKeyBelongsTo(
  key: string,
  target: { orgId: string; subject: MediaSubject; subjectId: string },
): boolean {
  return (
    isValidMediaKey(key) &&
    key.startsWith(`org/${target.orgId}/${target.subject}/${target.subjectId}/`)
  );
}
