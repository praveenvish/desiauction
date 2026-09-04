import { createHash, createHmac } from "node:crypto";

import type { ArtifactStorePort } from "..";

/**
 * S3-COMPATIBLE ARTIFACT STORE (PRR P1-4).
 *
 * The only ArtifactStorePort in the tree was the filesystem one, which writes to
 * the local disk. On the documented Fly topology web and the finops runner are
 * separate machines with separate disks, so the web tier could never read what
 * the runner wrote — every export verified "unhealthy" forever and the daily
 * attestation could never green. This is the shared store the config always
 * demanded, talking S3/MinIO/R2 over plain HTTP with AWS Signature V4 signed by
 * `node:crypto` — the same "inject the transport, no cloud SDK" idiom the media
 * port uses. Artifacts are small UTF-8 text (documents, export bundles); the
 * export event's digest remains the truth, so this store never claims authority.
 */

export interface BucketArtifactConfig {
  /** e.g. https://s3.ap-south-1.amazonaws.com or http://localhost:9000 (MinIO). */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Injected for tests; defaults to global fetch. */
  readonly transport?: (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => Promise<{ status: number; text(): Promise<string> }>;
  /** Injected for deterministic signing in tests; defaults to Date.now. */
  readonly now?: () => number;
}

const UNSIGNED = "";
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
const SERVICE = "s3";

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC-3986 encoding of a key path, preserving the `/` separators S3 keys use. */
function encodeKeyPath(key: string): string {
  return key
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

function amzDates(now: number): { amzDate: string; dateStamp: string } {
  // YYYYMMDDTHHMMSSZ and YYYYMMDD, both in UTC — no locale, no separators.
  const iso = new Date(now).toISOString(); // 2026-08-30T12:34:56.789Z
  const amzDate = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(
    11,
    13,
  )}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export function createBucketArtifactStore(config: BucketArtifactConfig): ArtifactStorePort {
  const transport = config.transport ?? ((url, init) => fetch(url, init));
  const now = config.now ?? (() => Date.now());
  const origin = config.endpoint.replace(/\/+$/, "");
  const host = new URL(origin).host;

  function signed(
    method: "PUT" | "GET",
    key: string,
    payloadHash: string,
  ): { url: string; headers: Record<string, string> } {
    const { amzDate, dateStamp } = amzDates(now());
    const canonicalUri = `/${config.bucket}/${encodeKeyPath(key)}`;
    const canonicalHeaders =
      `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [
      method,
      canonicalUri,
      UNSIGNED, // no query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join(
      "\n",
    );
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), SERVICE),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return {
      url: `${origin}${canonicalUri}`,
      headers: {
        Authorization: authorization,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        host,
      },
    };
  }

  return {
    async put(key, bytes) {
      const { url, headers } = signed("PUT", key, sha256Hex(bytes));
      const res = await transport(url, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: bytes,
      });
      if (res.status !== 200 && res.status !== 204) {
        throw new Error(`artifact_put_failed:${String(res.status)}`);
      }
      return { ref: key };
    },
    async get(ref) {
      const { url, headers } = signed("GET", ref, EMPTY_SHA256);
      const res = await transport(url, { method: "GET", headers });
      if (res.status === 404 || res.status === 403) {
        return null;
      }
      if (res.status !== 200) {
        throw new Error(`artifact_get_failed:${String(res.status)}`);
      }
      return res.text();
    },
  };
}

export interface BucketArtifactEnv {
  readonly FINOPS_ARTIFACT_STORE?: string | undefined;
  readonly FINOPS_S3_ENDPOINT?: string | undefined;
  readonly FINOPS_S3_REGION?: string | undefined;
  readonly FINOPS_S3_BUCKET?: string | undefined;
  readonly FINOPS_S3_ACCESS_KEY_ID?: string | undefined;
  readonly FINOPS_S3_SECRET_ACCESS_KEY?: string | undefined;
}

/**
 * The one construction point both callers (web + runner) share, so they select
 * the same store from the same variables. Returns null when the bucket store is
 * not requested/configured, and the caller falls back to the filesystem store.
 */
export function bucketArtifactStoreFromEnv(env: BucketArtifactEnv): ArtifactStorePort | null {
  if (env.FINOPS_ARTIFACT_STORE !== "bucket") {
    return null;
  }
  const endpoint = env.FINOPS_S3_ENDPOINT;
  const region = env.FINOPS_S3_REGION;
  const bucket = env.FINOPS_S3_BUCKET;
  const accessKeyId = env.FINOPS_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.FINOPS_S3_SECRET_ACCESS_KEY;
  if (
    endpoint === undefined ||
    region === undefined ||
    bucket === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    throw new Error(
      "FINOPS_ARTIFACT_STORE=bucket requires FINOPS_S3_ENDPOINT, FINOPS_S3_REGION, FINOPS_S3_BUCKET, FINOPS_S3_ACCESS_KEY_ID and FINOPS_S3_SECRET_ACCESS_KEY",
    );
  }
  return createBucketArtifactStore({ endpoint, region, bucket, accessKeyId, secretAccessKey });
}
