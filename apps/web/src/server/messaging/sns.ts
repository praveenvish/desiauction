import { X509Certificate, createPublicKey, createVerify, type KeyObject } from "node:crypto";

import { providerFetch, type ProviderResponse } from "./provider-fetch";

/**
 * AMAZON SNS MESSAGE VERIFICATION — how `/api/webhooks/ses` knows a POST came
 * from AWS and not from somebody who found the URL.
 *
 * SNS signs every message with a certificate it hosts on its own domain. The
 * check is AWS's documented one, done with `node:crypto` rather than an SDK:
 *
 *   1. the certificate URL must be HTTPS on `sns.<region>.amazonaws.com` and a
 *      `.pem` — anything else is refused BEFORE it is fetched, so a forged
 *      message cannot make us fetch an attacker's key (or any URL at all);
 *   2. the canonical string for the message type is rebuilt from its fields;
 *   3. the signature (SHA1 for SignatureVersion 1, SHA256 for 2) must verify
 *      against the certificate's public key, and the certificate must be in
 *      date.
 *
 * A valid signature proves AWS sent it — NOT that it is ours: anyone can make
 * AWS sign a message from their own topic. The route therefore also requires
 * the TopicArn to be the one configured (`SES_SNS_TOPIC_ARN`). Both, always.
 */

export interface SnsEnvelope {
  readonly Type: string;
  readonly MessageId: string;
  readonly TopicArn: string;
  readonly Message: string;
  readonly Timestamp: string;
  readonly SignatureVersion: string;
  readonly Signature: string;
  readonly SigningCertURL: string;
  readonly Subject?: string;
  readonly SubscribeURL?: string;
  readonly Token?: string;
}

const REQUIRED = [
  "Type",
  "MessageId",
  "TopicArn",
  "Message",
  "Timestamp",
  "SignatureVersion",
  "Signature",
  "SigningCertURL",
] as const;

export function parseSnsEnvelope(raw: string): SnsEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of REQUIRED) {
    if (typeof record[key] !== "string") return null;
  }
  const optional: Record<string, string> = {};
  for (const key of ["Subject", "SubscribeURL", "Token"]) {
    const value = record[key];
    // Absent and JSON null both mean "not signed over" — normalised to absent.
    if (typeof value === "string") optional[key] = value;
    else if (value !== undefined && value !== null) return null;
  }
  const required = Object.fromEntries(REQUIRED.map((key) => [key, record[key]]));
  return { ...required, ...optional } as unknown as SnsEnvelope;
}

/** `https://sns.<region>.amazonaws.com/...` — the only host SNS signs from. */
export function isSnsUrl(raw: string, options: { readonly pem?: boolean } = {}): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    /^sns\.[a-z]{2}(-[a-z]+)+-\d\.amazonaws\.com$/.test(url.hostname) &&
    (options.pem !== true || url.pathname.endsWith(".pem"))
  );
}

/** AWS's canonical string: named fields, in this order, each `Name\nvalue\n`. */
export function snsStringToSign(envelope: SnsEnvelope): string {
  const fields =
    envelope.Type === "Notification"
      ? (["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] as const)
      : ([
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ] as const);
  return fields
    .filter((name) => envelope[name] !== undefined)
    .map((name) => `${name}\n${envelope[name] ?? ""}\n`)
    .join("");
}

export type CertFetcher = (url: string) => Promise<string>;

/**
 * The signing certificate, fetched once per URL and kept: SNS rotates it
 * rarely, and fetching it for every bounce would put AWS's CDN on the
 * critical path of every report.
 */
export function createCertFetcher(
  transport: (
    url: string,
    init: { method: string; headers: Record<string, string> },
  ) => Promise<ProviderResponse> = providerFetch,
): CertFetcher {
  const cache = new Map<string, Promise<string>>();
  return (url) => {
    const cached = cache.get(url);
    if (cached !== undefined) return cached;
    const pending = transport(url, { method: "GET", headers: {} }).then((response) => {
      if (response.status !== 200 || !response.body.includes("-----BEGIN")) {
        throw new Error(`SNS certificate fetch failed (${String(response.status)})`);
      }
      return response.body;
    });
    // A failed fetch is not cached: the next report tries again.
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
    return pending;
  };
}

function publicKeyOf(pem: string, now: number): KeyObject | null {
  if (!pem.includes("BEGIN CERTIFICATE")) return createPublicKey(pem);
  const certificate = new X509Certificate(pem);
  const inDate = Date.parse(certificate.validFrom) <= now && now <= Date.parse(certificate.validTo);
  return inDate ? certificate.publicKey : null;
}

export async function verifySnsSignature(
  envelope: SnsEnvelope,
  fetchCert: CertFetcher,
  now: number = Date.now(),
): Promise<boolean> {
  const algorithm =
    envelope.SignatureVersion === "1"
      ? "RSA-SHA1"
      : envelope.SignatureVersion === "2"
        ? "RSA-SHA256"
        : null;
  if (algorithm === null || !isSnsUrl(envelope.SigningCertURL, { pem: true })) {
    return false;
  }
  try {
    const key = publicKeyOf(await fetchCert(envelope.SigningCertURL), now);
    if (key === null) return false;
    return createVerify(algorithm)
      .update(snsStringToSign(envelope), "utf8")
      .verify(key, envelope.Signature, "base64");
  } catch {
    return false;
  }
}
