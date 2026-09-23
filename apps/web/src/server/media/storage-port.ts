import { mkdir, open, rm, writeFile } from "node:fs/promises";
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
 * URL. The UPLOAD never passes through the Next server; the attach does read
 * the object back once, capped, to sanitize it (sanitize.ts, P0-6) — the one
 * place the server touches image bytes on the write path.
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
  /**
   * Read an object's bytes, refusing to buffer more than `maxBytes` — the
   * client chose what it PUT, so its size is a claim until counted here.
   */
  readObject(key: string, maxBytes: number): Promise<StoredObject>;
  /** Write bytes the SERVER produced (the sanitized re-encode) under `key`. */
  writeObject(key: string, contentType: AllowedImageType, bytes: Buffer): Promise<void>;
}

export type StoredObject =
  { status: "ok"; bytes: Buffer } | { status: "missing" } | { status: "too_large" };

/**
 * Drain a body, stopping the moment it passes `maxBytes` — so a 2 GB object
 * costs us 5 MB and a cancelled stream, not 2 GB of heap.
 */
export async function readCapped(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

  async readObject(key: string, maxBytes: number): Promise<StoredObject> {
    if (!isValidMediaKey(key)) {
      throw new Error("Rejected: malformed media key");
    }
    let handle;
    try {
      handle = await open(join(LOCAL_ROOT, key), "r");
    } catch {
      return { status: "missing" };
    }
    try {
      const { size } = await handle.stat();
      if (size > maxBytes) {
        return { status: "too_large" };
      }
      const bytes = await readCapped(handle.createReadStream(), maxBytes);
      return bytes === null ? { status: "too_large" } : { status: "ok", bytes };
    } finally {
      await handle.close();
    }
  }

  async writeObject(key: string, contentType: AllowedImageType, bytes: Buffer): Promise<void> {
    await this.writeLocal(key, contentType, bytes);
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
  method: "GET" | "PUT" | "DELETE";
  key: string;
  contentType?: string;
  expiresSeconds: number;
}) => string;

export interface HttpTransport {
  (
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: Uint8Array },
  ): Promise<{
    status: number;
    headers?: { get(name: string): string | null };
    body?: AsyncIterable<Uint8Array> | null;
  }>;
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
    this.transport =
      config.transport ??
      (async (url, init) => {
        const response = await fetch(url, {
          method: init.method,
          ...(init.headers !== undefined ? { headers: init.headers } : {}),
          // A copy onto a plain ArrayBuffer: what `BodyInit` accepts.
          ...(init.body !== undefined ? { body: new Uint8Array(init.body) } : {}),
          // Server-to-bucket IO: a hung origin must not hang an attach.
          signal: AbortSignal.timeout(15_000),
        });
        return {
          status: response.status,
          headers: response.headers,
          body: response.body as AsyncIterable<Uint8Array> | null,
        };
      });
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

  async readObject(key: string, maxBytes: number): Promise<StoredObject> {
    if (!isValidMediaKey(key)) {
      throw new Error("Rejected: malformed media key");
    }
    const url = this.config.sign({ method: "GET", key, expiresSeconds: 60 });
    const response = await this.transport(url, { method: "GET" });
    if (response.status === 404 || response.status === 403) {
      // S3 answers 403 for a missing key when the signer lacks ListBucket.
      return { status: "missing" };
    }
    if (response.status < 200 || response.status >= 300 || !response.body) {
      throw new Error(`Media read failed: HTTP ${String(response.status)}`);
    }
    // Refuse on the declared length first; count the bytes regardless, since a
    // chunked response need not declare one.
    const declared = Number(response.headers?.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { status: "too_large" };
    }
    const bytes = await readCapped(response.body, maxBytes);
    return bytes === null ? { status: "too_large" } : { status: "ok", bytes };
  }

  async writeObject(key: string, contentType: AllowedImageType, bytes: Buffer): Promise<void> {
    if (!isValidMediaKey(key) || !isAllowedImageType(contentType)) {
      throw new Error("Rejected: malformed media key or type");
    }
    // Same signed-content-type PUT the browser uses, so the object is served
    // with the type we actually encoded.
    const url = this.config.sign({
      method: "PUT",
      key,
      contentType,
      expiresSeconds: 60,
    });
    const response = await this.transport(url, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: bytes,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Media write failed: HTTP ${String(response.status)}`);
    }
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
