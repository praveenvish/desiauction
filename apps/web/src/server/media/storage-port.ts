import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  deriveMediaKey,
  isAllowedImageType,
  isValidMediaKey,
  type AllowedImageType,
} from "@desiauction/core";

/**
 * Media storage port (parity foundation, §3.1) — same idiom as the OTP sender
 * (auth/otp-sender.ts): one interface, a dev adapter and a prod adapter behind
 * an INJECTED signer/transport (no cloud SDK), constructed once from env.
 *
 * We persist storage KEYS (see @desiauction/core `deriveMediaKey`); the port
 * turns a key into an upload target (browser PUTs bytes directly) and a read
 * URL. Image bytes never pass through the Next server.
 */
export interface PresignedUpload {
  /** URL the browser PUTs the raw image bytes to. */
  readonly uploadUrl: string;
  /** The final storage key to persist once the PUT succeeds. */
  readonly key: string;
}

export interface StoragePort {
  /** Derive a key + upload target for a new image (validated by the caller). */
  presignUpload(args: {
    orgId: string;
    subject: "player" | "team" | "competition";
    subjectId: string;
    contentType: AllowedImageType;
    token: string;
  }): Promise<PresignedUpload>;
  /** Public (or signed) URL to read a stored key. */
  readUrl(key: string): string;
  /** Remove a stored object (best-effort; missing is not an error). */
  delete(key: string): Promise<void>;
}

// --- Development: local filesystem under apps/web/public/_media -------------
// Statically served, so readUrl is a plain path. The upload target is a local
// route handler (app/api/media/upload) that writes bytes for the given key.

const LOCAL_ROOT = join(process.cwd(), "public", "_media");
const LOCAL_PUBLIC_PREFIX = "/_media";

export class LocalStorage implements StoragePort {
  presignUpload(args: {
    orgId: string;
    subject: "player" | "team" | "competition";
    subjectId: string;
    contentType: AllowedImageType;
    token: string;
  }): Promise<PresignedUpload> {
    const key = deriveMediaKey(args);
    return Promise.resolve({ uploadUrl: `/api/media/upload?key=${encodeURIComponent(key)}`, key });
  }

  readUrl(key: string): string {
    return `${LOCAL_PUBLIC_PREFIX}/${key}`;
  }

  async delete(key: string): Promise<void> {
    if (!isValidMediaKey(key)) {
      throw new Error("Rejected: malformed media key");
    }
    await rm(join(LOCAL_ROOT, key), { force: true });
  }

  /** Used by the local upload route to persist bytes for a key. Prod uploads
   * go straight to the bucket and never hit this path. */
  async writeLocal(key: string, contentType: string, bytes: Buffer): Promise<void> {
    if (!isAllowedImageType(contentType)) {
      throw new Error("Rejected: not an allowed image type");
    }
    // Defense in depth (S1): never resolve a path from an unvalidated key, even
    // if a future caller forgets the route-level gate. `..` cannot pass this.
    if (!isValidMediaKey(key)) {
      throw new Error("Rejected: malformed media key");
    }
    const dest = join(LOCAL_ROOT, key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }
}

// --- Production: S3 / Cloudflare R2 behind an injected SigV4 signer ----------
// The signer + transport are injected (no AWS SDK), exactly like SmsTransport,
// so this is testable without network or live credentials. D1 (S3 vs R2) only
// changes which endpoint/signer we construct in createStorageFromEnv.

export type ObjectSigner = (args: {
  method: "PUT" | "DELETE";
  key: string;
  contentType?: string;
  expiresSeconds: number;
}) => string;

export interface HttpTransport {
  (url: string, init: { method: string }): Promise<{ status: number }>;
}

export interface BucketConfig {
  readonly publicBase: string; // e.g. https://cdn.desiauction.app
  readonly sign: ObjectSigner;
  readonly transport?: HttpTransport;
  readonly uploadExpirySeconds?: number;
}

export class BucketStorage implements StoragePort {
  private readonly transport: HttpTransport;
  private readonly uploadExpiry: number;

  constructor(private readonly config: BucketConfig) {
    this.transport = config.transport ?? ((url, init) => fetch(url, init));
    this.uploadExpiry = config.uploadExpirySeconds ?? 300;
  }

  presignUpload(args: {
    orgId: string;
    subject: "player" | "team" | "competition";
    subjectId: string;
    contentType: AllowedImageType;
    token: string;
  }): Promise<PresignedUpload> {
    const key = deriveMediaKey(args);
    const uploadUrl = this.config.sign({
      method: "PUT",
      key,
      contentType: args.contentType,
      expiresSeconds: this.uploadExpiry,
    });
    return Promise.resolve({ uploadUrl, key });
  }

  readUrl(key: string): string {
    return `${this.config.publicBase}/${key}`;
  }

  async delete(key: string): Promise<void> {
    const url = this.config.sign({ method: "DELETE", key, expiresSeconds: this.uploadExpiry });
    await this.transport(url, { method: "DELETE" });
  }
}

export interface StorageEnv {
  MEDIA_STORAGE: "local" | "bucket";
  MEDIA_PUBLIC_BASE?: string | undefined;
}

/** One construction point: env picks the adapter (mirrors createOtpSenderFromEnv).
 * The `bucket` branch is wired once D1 (S3 vs R2) is closed and a signer added. */
export function createStorageFromEnv(env: StorageEnv, bucket?: BucketConfig): StoragePort {
  if (env.MEDIA_STORAGE === "bucket") {
    if (bucket === undefined) {
      throw new Error("MEDIA_STORAGE=bucket but no BucketConfig provided (see D1)");
    }
    return new BucketStorage(bucket);
  }
  return new LocalStorage();
}
