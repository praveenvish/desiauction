import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * ZEPTOMAIL EVENTS — bounces and spam complaints from Zoho CPaaS's Mail Agent
 * webhook, turned into suppressions and delivery reports.
 *
 * The SES sibling (ses-webhook.ts) with a different envelope. Same rules:
 * prove the caller before acting; a hard bounce or a complaint suppresses the
 * address for good; a soft bounce is only logged, because the mailbox may
 * well come back.
 *
 * HOW A CALL IS PROVED. Zoho's webhook form (Mail Agent → Webhooks, seen
 * 2026-10-01) sends an "authorization header" whose name and value we choose:
 * we name it `X-Webhook-Key` and give it ZEPTOMAIL_WEBHOOK_KEY, compared in
 * constant time. Its help pages also describe a signed
 *
 *   producer-signature: ts=<ms>;s=<base64, URL-encoded>;s-algorithm=HmacSHA256
 *
 * — HMAC-SHA256 over the event, keyed with the same key — so a request that
 * carries a valid one of those is accepted too. Either proof needs the key.
 *
 * THE SHAPE, as the form's own preview shows it: `event_name` is a list
 * (`["hardbounce"]`, `["fbl_compliant"]` — sic, not "complaint"),
 * `event_message` a list of `{ email_info, event_data }`, and the address an
 * event is ABOUT is in `event_data[].details[]` (`bounced_recipient` for a
 * bounce, `to` for a complaint) — `email_info.to` lists every recipient of the
 * message, so it is only the fallback.
 */

/** The header Zoho is configured to send the webhook key in. */
export const ZEPTOMAIL_KEY_HEADER = "x-webhook-key";

/** A signature older than this is refused; retries arrive well inside it. */
export const ZEPTOMAIL_SIGNATURE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Clock skew tolerated the other way. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export type ZeptomailAction =
  | {
      readonly kind: "suppress";
      readonly recipient: string;
      readonly reason: "bounce" | "complaint";
      readonly note: string;
    }
  | {
      /** The generic callback JSON `parseEmailCallback` reads. */
      readonly kind: "report";
      readonly raw: string;
    };

interface ProducerSignature {
  readonly ts: number;
  readonly signature: Buffer;
  readonly algorithm: string;
}

export function parseProducerSignature(header: string | null): ProducerSignature | null {
  if (header === null) return null;
  const parts = new Map<string, string>();
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) parts.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  const ts = Number(parts.get("ts"));
  const encoded = parts.get("s");
  const algorithm = parts.get("s-algorithm") ?? "HmacSHA256";
  if (!Number.isFinite(ts) || encoded === undefined || encoded === "") return null;
  let base64: string;
  try {
    base64 = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  const signature = Buffer.from(base64, "base64");
  return signature.length === 0 ? null : { ts, signature, algorithm };
}

/** Java's `URLDecoder.decode`: `+` is a space, `%xx` a byte. */
function formDecode(text: string): string | null {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/**
 * The payload a valid signature covers, or null when none does. Candidates,
 * in order: the documented form (URL-decoded body, after its first `=`), then
 * the body exactly as received.
 */
export function verifyZeptomailSignature(
  rawBody: string,
  header: string | null,
  key: string,
  now: number,
): string | null {
  const parsed = parseProducerSignature(header);
  if (parsed === null || parsed.algorithm !== "HmacSHA256") return null;
  if (now - parsed.ts > ZEPTOMAIL_SIGNATURE_MAX_AGE_MS || parsed.ts - now > FUTURE_SKEW_MS) {
    return null;
  }
  const decoded = formDecode(rawBody);
  const at = decoded?.indexOf("=") ?? -1;
  const candidates = [...(decoded !== null && at >= 0 ? [decoded.slice(at + 1)] : []), rawBody];
  for (const candidate of candidates) {
    const mac = createHmac("sha256", key).update(candidate, "utf8").digest();
    if (mac.length === parsed.signature.length && timingSafeEqual(mac, parsed.signature)) {
      return candidate;
    }
  }
  return null;
}

/** The configured header carries the key: constant time, length first. */
export function zeptomailKeyMatches(provided: string | null, key: string): boolean {
  if (provided === null || key === "") return false;
  const a = Buffer.from(provided.trim());
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
/** Zoho sends some of these as one object and some as a list of them. */
const list = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(record) : value === undefined ? [] : [record(value)];
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Every address in `to`, whichever of Zoho's nestings it arrived in. */
function recipients(to: unknown): string[] {
  const found: string[] = [];
  for (const entry of list(to)) {
    for (const mailbox of list(entry["email_address"] ?? entry)) {
      const address = text(mailbox["address"]).trim();
      if (address.includes("@")) found.push(address);
    }
  }
  return found;
}

/** Addresses named by one `details` field — a string or a list of strings. */
function named(details: Json[], field: string): string[] {
  return details
    .flatMap((d) => (Array.isArray(d[field]) ? (d[field] as unknown[]) : [d[field]]))
    .map((value) => text(value).trim())
    .filter((address) => address.includes("@"));
}

/** `hard bounce`, `hardbounce`, `hard_bounce` → `hardbounce`. */
function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * What one webhook body asks of us. Pure, and every action idempotent where
 * it lands: the suppression is deduplicated, the report keyed on the event.
 */
export function zeptomailEventActions(payload: string): {
  type: string;
  actions: ZeptomailAction[];
} {
  let body: Json;
  try {
    body = record(JSON.parse(payload));
  } catch {
    return { type: "unparseable", actions: [] };
  }
  const names = (Array.isArray(body["event_name"]) ? body["event_name"] : [body["event_name"]])
    .map((name) => normalise(text(name)))
    .filter((name) => name !== "");
  const type = names[0] ?? "unknown";
  const actions: ZeptomailAction[] = [];

  for (const message of list(body["event_message"])) {
    const info = record(message["email_info"]);
    const data = list(message["event_data"]);
    const objects = data.map((entry) => normalise(text(entry["object"])));
    const details = data.flatMap((entry) => list(entry["details"]));
    const reason = details.map((d) => text(d["reason"])).find((r) => r !== "") ?? "";
    const dispatchId = text(info["client_reference"]);
    const emailRef = text(info["email_reference"]) || text(body["webhook_request_id"]);

    const hard = names.includes("hardbounce") || objects.includes("hardbounce");
    // Zoho spells it `fbl_compliant`; the help pages say "feedback loop" and
    // `fbl_complaint`. Any of them is a person marking our mail as spam.
    const complaint = [...names, ...objects].some((name) =>
      ["fblcompliant", "fblcomplaint", "feedbackloop", "fbl"].includes(name),
    );
    if (!hard && !complaint) continue; // soft bounce, open, click: nothing to suppress

    const report = (event: string, recipient: string): void => {
      if (dispatchId === "" || emailRef === "") return;
      actions.push({
        kind: "report",
        raw: JSON.stringify({
          event,
          providerRef: `email:${dispatchId}`,
          eventId: `zeptomail:${emailRef}:${event}:${recipient}`,
          recipient,
        }),
      });
    };

    const about = named(details, complaint ? "to" : "bounced_recipient");
    for (const recipient of about.length > 0 ? about : recipients(info["to"])) {
      actions.push({
        kind: "suppress",
        recipient,
        reason: complaint ? "complaint" : "bounce",
        note: complaint
          ? "zeptomail complaint: feedback loop"
          : `zeptomail hard bounce${reason === "" ? "" : `: ${reason.slice(0, 120)}`}`,
      });
      report(complaint ? "complained" : "bounced", recipient);
    }
  }
  return { type, actions };
}

export interface ZeptomailWebhookDeps {
  readonly key: string;
  readonly now: () => number;
  readonly suppress: (action: Extract<ZeptomailAction, { kind: "suppress" }>) => Promise<unknown>;
  readonly report: (raw: string) => Promise<unknown>;
  readonly log: (fields: Record<string, unknown>, message: string) => void;
}

export interface ZeptomailWebhookResult {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

/**
 * One webhook POST, start to finish. A request without the key gets 403 (no
 * retry is due it). A proved request always gets 200 — Zoho's form requires
 * it, and its Verify button posts no event — whether it suppressed something,
 * ignored a soft bounce, or carried nothing readable. Only OUR database
 * failing is a 5xx, and that is the route's to answer (it catches what this
 * throws).
 */
export async function handleZeptomailWebhook(
  raw: string,
  headers: { readonly key: string | null; readonly signature: string | null },
  deps: ZeptomailWebhookDeps,
): Promise<ZeptomailWebhookResult> {
  const payload = zeptomailKeyMatches(headers.key, deps.key)
    ? raw
    : verifyZeptomailSignature(raw, headers.signature, deps.key, deps.now());
  if (payload === null) {
    deps.log(
      { keyed: headers.key !== null, signed: headers.signature !== null },
      "zeptomail_webhook.unproven",
    );
    return { status: 403, body: null };
  }
  const { type, actions } = zeptomailEventActions(payload);
  if (type === "unparseable" || type === "unknown") {
    deps.log({ event: type }, "zeptomail_webhook.no_event");
    return { status: 200, body: { status: "ignored" } };
  }
  // Suppressions first: a fact about an address, kept even if the finops
  // report after it is refused (the SES route's rule).
  for (const action of actions) {
    if (action.kind === "suppress") await deps.suppress(action);
  }
  for (const action of actions) {
    if (action.kind === "report") await deps.report(action.raw);
  }
  const suppressed = actions.filter((a) => a.kind === "suppress").length;
  deps.log({ event: type, suppressed }, "zeptomail_webhook.event");
  return { status: 200, body: { status: suppressed > 0 ? "suppressed" : "ignored" } };
}
