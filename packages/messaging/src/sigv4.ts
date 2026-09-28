import { createHash, createHmac } from "node:crypto";

/**
 * AWS SIGNATURE VERSION 4, for one JSON call to one AWS service.
 *
 * The repo already signs S3 requests by hand (s3-artifact-store.ts, the media
 * signer) rather than taking the AWS SDK, and SES is the same algorithm with a
 * different service name. So this is the third signer, not a new dependency:
 * `node:crypto` and forty lines, proved against AWS's own published test
 * vector (sigv4.test.ts) rather than against itself.
 *
 * Deliberately narrow — a request with no query string, signing `host`,
 * `x-amz-date` and whatever headers the caller hands in. The S3 signers are
 * not folded into it: they live in the certified finops package, and a shared
 * helper is not worth amending that.
 */

export interface SigV4Request {
  readonly method: string;
  readonly url: string;
  /** Headers to send AND sign. `host` and `x-amz-date` are added. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface SigV4Credentials {
  readonly region: string;
  readonly service: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** `20150830T123600Z` and `20150830` from one instant. */
function amzDates(now: number): { amzDate: string; dateStamp: string } {
  const amzDate = new Date(now)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** Every path segment URI-encoded once, slashes kept (the non-S3 rule). */
function canonicalPath(pathname: string): string {
  if (pathname === "") return "/";
  return pathname
    .split("/")
    .map((segment) =>
      encodeURIComponent(decodeURIComponent(segment)).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

/**
 * The headers to send: the caller's, plus `host`, `x-amz-date` and the
 * `authorization` that covers all of them.
 */
export function signRequest(
  request: SigV4Request,
  credentials: SigV4Credentials,
  now: number,
): Record<string, string> {
  const url = new URL(request.url);
  const { amzDate, dateStamp } = amzDates(now);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  headers["host"] = url.host;
  headers["x-amz-date"] = amzDate;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name] ?? ""}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(url.pathname),
    // No query string on any call this signs; an empty line is its canonical form.
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(request.body),
  ].join("\n");

  const scope = `${dateStamp}/${credentials.region}/${credentials.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(
      hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), credentials.region),
      credentials.service,
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
