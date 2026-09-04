import { createHash, createHmac } from "node:crypto";

import type { ObjectSigner } from "./storage-port";

/**
 * THE MEDIA BUCKET SIGNER — D1, closed (PI-1 P5).
 *
 * `BucketStorage` was designed against an injected `ObjectSigner` and nothing
 * ever constructed one: env validation DEMANDED `MEDIA_STORAGE=bucket` when
 * serving production, and the first import of `server/media` then threw
 * "no BucketConfig provided (see D1)". The production media path was a boot
 * failure wearing a config requirement's clothes.
 *
 * This is AWS Signature V4 **query presigning** (the artifact store next door
 * hand-rolls the header-signing variant for the same reason): no SDK, node
 * crypto only, works against S3, Cloudflare R2 and MinIO alike — D1's actual
 * decision ("S3 vs R2") collapses to an endpoint string.
 *
 * `content-type` is a SIGNED header: the browser's PUT must carry exactly the
 * type declared at presign, so a URL minted for a JPEG cannot upload anything
 * that claims to be something else. The payload itself is UNSIGNED-PAYLOAD —
 * bytes never pass through the Next server (the port's founding rule), so the
 * type pin plus the 5 MiB presign-time validation is the honest boundary, and
 * it is stated here rather than implied.
 */

export interface MediaS3Config {
  /** e.g. https://s3.ap-south-1.amazonaws.com or an R2/MinIO endpoint. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Injected clock for tests; production omits it. */
  readonly now?: () => Date;
}

const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** RFC 3986 encoding the way SigV4 wants it (encode everything but unreserved). */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Media keys are `org/{ulid}/{subject}/{ulid}/{token}.{ext}` — every segment
 * is alphanumeric by the key grammar, but each is encoded anyway (S1 spirit:
 * never trust a future caller to have validated first). */
function canonicalUriFor(bucket: string, key: string): string {
  const segments = [bucket, ...key.split("/")].map(rfc3986);
  return `/${segments.join("/")}`;
}

export function createMediaSigner(config: MediaS3Config): ObjectSigner {
  const endpoint = new URL(config.endpoint);
  const host = endpoint.host;

  return ({ method, key, contentType, expiresSeconds }) => {
    const at = (config.now?.() ?? new Date()).toISOString();
    const amzDate = `${at.slice(0, 19).replace(/[-:]/g, "")}Z`;
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
    const credential = `${config.accessKeyId}/${scope}`;

    // content-type is signed only when declared (PUT); DELETE carries none.
    const signedHeaderNames = contentType === undefined ? ["host"] : ["content-type", "host"];
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalHeaders = signedHeaderNames
      .map((name) => (name === "host" ? `host:${host}\n` : `content-type:${contentType ?? ""}\n`))
      .join("");

    const query: [string, string][] = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", credential],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(expiresSeconds)],
      ["X-Amz-SignedHeaders", signedHeaders],
    ];
    const canonicalQuery = query
      .map(([name, value]) => [rfc3986(name), rfc3986(value)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, value]) => `${name}=${value}`)
      .join("&");

    const canonicalUri = canonicalUriFor(config.bucket, key);
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      UNSIGNED_PAYLOAD,
    ].join("\n");

    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join(
      "\n",
    );

    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3"),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

    return `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  };
}
