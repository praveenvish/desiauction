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
