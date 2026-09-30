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
 * HOW A CALL IS PROVED. Each POST carries
 *
 *   producer-signature: ts=<ms>;s=<base64, URL-encoded>;s-algorithm=HmacSHA256
 *
 * where `s` is HMAC-SHA256, keyed with the webhook's authentication key, over
 * the event notification. Zoho's reference validator URL-decodes the body and
 * signs what follows its first `=` (a form-encoded body); a raw JSON body is
 * accepted too, signed over as it arrived. Either way the MAC needs the key,
 * so which of the two a request used proves nothing to a forger.
 */

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
    const objects = data.map((entry) => text(entry["object"]).toLowerCase());
    const details = data.flatMap((entry) => list(entry["details"]));
    const reason = details.map((d) => text(d["reason"])).find((r) => r !== "") ?? "";
    const dispatchId = text(info["client_reference"]);
    const emailRef = text(info["email_reference"]) || text(body["webhook_request_id"]);

    const hard = names.includes("hardbounce");
    const complaint = names.includes("feedbackloop") || objects.includes("fbl_complaint");
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

    for (const recipient of recipients(info["to"])) {
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
 * One webhook POST, start to finish. A forgery gets 403 and an unreadable
 * body 400 (no retry is due either); an event we understood — acted on or
 * deliberately ignored — gets 200. Only OUR database failing is a 5xx, and
 * that is the route's to answer (it catches what this throws).
 */
export async function handleZeptomailWebhook(
  raw: string,
  signatureHeader: string | null,
  deps: ZeptomailWebhookDeps,
): Promise<ZeptomailWebhookResult> {
  const payload = verifyZeptomailSignature(raw, signatureHeader, deps.key, deps.now());
  if (payload === null) {
    deps.log({ signed: signatureHeader !== null }, "zeptomail_webhook.bad_signature");
    return { status: 403, body: null };
  }
  const { type, actions } = zeptomailEventActions(payload);
  if (type === "unparseable") {
    deps.log({}, "zeptomail_webhook.unparseable");
    return { status: 400, body: null };
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
