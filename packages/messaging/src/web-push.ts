import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";

import { providerFetch, type ProviderResponse } from "./provider-fetch";

/**
 * WEB PUSH, BY HAND (email programme PR18) — the two standards a browser's
 * push service asks for, on node:crypto, with no dependency (the same call
 * sigv4.ts made for SES):
 *
 *   · VAPID (RFC 8292): who is pushing. An ES256 JWT for the push service's
 *     origin, signed with our key pair, and the public key beside it.
 *   · Message encryption (RFC 8291, `aes128gcm` from RFC 8188): what is said,
 *     readable only by the browser that subscribed. An ephemeral P-256 key,
 *     ECDH with the browser's key, HKDF with its auth secret, AES-128-GCM.
 *
 * `sendWebPush` answers `gone` for 404/410 — the browser unsubscribed or the
 * subscription expired — so the caller deletes the row rather than retrying.
 */

export interface PushSubscriptionKeys {
  readonly endpoint: string;
  /** The browser's P-256 public key, base64url (65 bytes, uncompressed). */
  readonly p256dh: string;
  /** The browser's auth secret, base64url (16 bytes). */
  readonly auth: string;
}

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point — also given to the browser. */
  readonly publicKey: string;
  /** base64url, the 32-byte private scalar. */
  readonly privateKey: string;
  /** `mailto:` or `https:` — how the push service can reach us. */
  readonly subject: string;
}

const b64url = (buffer: Buffer): string => buffer.toString("base64url");
const fromB64url = (text: string): Buffer => Buffer.from(text, "base64url");

/** A fresh VAPID key pair — for `pnpm push:keys`, once per environment. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** The VAPID JWT for one push service origin, valid for 12 hours. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now: number): string {
  const publicKey = fromB64url(keys.publicKey);
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  );
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url(publicKey.subarray(1, 33)),
      y: b64url(publicKey.subarray(33, 65)),
      d: keys.privateKey,
    },
    format: "jwk",
  });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

/** RFC 8291 + RFC 8188: the encrypted body, one record. */
export function encryptPushPayload(
  subscription: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  plaintext: Buffer,
  // Fixed only in tests; a fresh key and salt for every real message.
  fixed?: { readonly ephemeral: ReturnType<typeof createECDH>; readonly salt: Buffer },
): Buffer {
  const uaPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);
  const ephemeral = fixed?.ephemeral ?? createECDH("prime256v1");
  if (fixed === undefined) ephemeral.generateKeys();
  const asPublic = ephemeral.getPublicKey();
  const shared = ephemeral.computeSecret(uaPublic);
  const salt = fixed?.salt ?? randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02: the last (and only) record's padding delimiter.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, body]);
}

export type PushOutcome = "sent" | "gone" | "failed";

/**
 * THE PUSH SERVICES A BROWSER CAN HAND US, AND NOTHING ELSE (PRR 2026-09-29).
 *
 * A subscription's endpoint is a URL the BROWSER supplies, and the server then
 * POSTs to it. The only check was `https:`, so any signed-in person could save
 * `https://anything/` as a device and have this server call it on their next
 * notice — a request forged from inside the network (a 3xx carried it on to
 * plain-http internal addresses), with the 404/410 "gone" branch reporting back
 * which addresses answered. Each such call also held its turn for the full
 * provider deadline.
 *
 * Web push has a closed set of operators: a browser subscribes with its
 * vendor's service and no other. So the endpoint is matched against that set,
 * on the default port, with no credentials in the URL — when it is saved AND
 * again when it is sent to, because rows written before this rule existed are
 * still in the table.
 *
 *   · Chrome, Edge (Android), Opera, Brave, Samsung Internet — FCM
 *   · Firefox — Mozilla autopush
 *   · Edge (desktop) — Windows Notification Service
 *   · Safari — Apple Push
 */
const PUSH_SERVICE_HOSTS: readonly string[] = [
  "fcm.googleapis.com",
  "jmt17.google.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
];
const PUSH_SERVICE_SUFFIXES: readonly string[] = [
  ".push.services.mozilla.com",
  ".notify.windows.com",
  ".push.apple.com",
];

/** Longest endpoint any push service issues is a few hundred characters. */
export const PUSH_ENDPOINT_MAX_LENGTH = 2048;

export function isPushServiceEndpoint(endpoint: string): boolean {
  if (endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    PUSH_SERVICE_HOSTS.includes(host) ||
    PUSH_SERVICE_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

export type PushTransport = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: Uint8Array<ArrayBuffer>;
    redirect: "error";
  },
) => Promise<ProviderResponse>;

const defaultTransport: PushTransport = (url, init) => providerFetch(url, init);

export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  message: unknown,
  keys: VapidKeys,
  options: { now?: number; ttlSeconds?: number; transport?: PushTransport } = {},
): Promise<PushOutcome> {
  // Not a push service we know: never called. "failed", not "gone" — "gone"
  // makes the caller DELETE the row, and if this list is ever missing a real
  // browser's service, that would unsubscribe its users in silence. A row that
  // is skipped costs nothing and can be delivered to the day the list learns
  // its host.
  if (!isPushServiceEndpoint(subscription.endpoint)) {
    return "failed";
  }
  try {
    // Inside the try: the keys are the browser's claim, and a malformed one
    // throws out of node:crypto. That is a failed push, never a failed request.
    const body = encryptPushPayload(subscription, Buffer.from(JSON.stringify(message)));
    const response = await (options.transport ?? defaultTransport)(subscription.endpoint, {
      method: "POST",
      // A push service answers the address it issued; it does not send us on.
      redirect: "error",
      headers: {
        authorization: vapidAuthorization(subscription.endpoint, keys, options.now ?? Date.now()),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(options.ttlSeconds ?? 24 * 60 * 60),
        urgency: "normal",
      },
      // A copy on its own ArrayBuffer — what fetch's BodyInit accepts.
      body: new Uint8Array(body),
    });
    if (response.status === 404 || response.status === 410) return "gone";
    return response.status >= 200 && response.status < 300 ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
