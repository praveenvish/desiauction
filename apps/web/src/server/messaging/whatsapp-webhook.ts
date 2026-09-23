import { createHmac, timingSafeEqual } from "node:crypto";

import { messageOutbox, people, whatsappInbound, type Db } from "@desiauction/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

import { recordConsent } from "./consent";
import { classifyInbound, type InboundIntent } from "./inbound";
import { providerFetch, type ProviderResponse } from "./provider-fetch";
import { WHATSAPP_CONSENT_PURPOSE } from "./whatsapp";

/**
 * WHATSAPP'S CALLBACK URL — the half of the channel Meta talks back on.
 *
 * Sending on WhatsApp is one direction. Everything that comes BACK arrives here:
 * what became of each message we sent (sent → delivered → read, or failed), and
 * whatever a person typed in reply — "STOP" among it. Without this receiver the
 * platform could not tell a message that reached a phone from one that did not,
 * and, worse, could not be told to stop: a WhatsApp number with no opt-out
 * receiver is a Meta policy breach and, under the DPDP Act, a withdrawal of
 * consent we accepted and dropped.
 *
 * This file is the logic; `app/api/webhooks/whatsapp/route.ts` is the door. The
 * split exists so the parts that decide things — the signature, the payload
 * shape, which status may follow which — are pure and tested without a server.
 *
 * NOTHING HERE LOGS A BODY OR A NUMBER. Callers log counts and ids only.
 */

// --- Signature -----------------------------------------------------------------

/**
 * Did Meta sign exactly these bytes with our app secret?
 *
 * `X-Hub-Signature-256: sha256=<hex>` is HMAC-SHA256 over the RAW body — the
 * bytes as sent, not a re-serialisation of the parsed JSON (Meta escapes
 * non-ASCII as `\uXXXX`, so re-encoding the parsed object would not reproduce
 * them). Compared in constant time so the response time says nothing about how
 * much of a forged signature was right.
 */
export function verifyWhatsAppSignature(
  rawBody: Uint8Array,
  header: string | null,
  appSecret: string,
): boolean {
  if (header === null) {
    return false;
  }
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (match === null) {
    return false;
  }
  const provided = Buffer.from(match[1] ?? "", "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  // Both are 32 bytes by construction (the regex pins 64 hex chars), so the
  // length check never short-circuits on attacker input; it guards the throw.
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/**
 * Meta's subscription handshake: answer with `hub.challenge` when the token is
 * the one we gave it, and nothing otherwise. Returns the challenge to echo, or
 * null for "refuse".
 */
export function verifyHandshake(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get("hub.mode") !== "subscribe") {
    return null;
  }
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (token === null || challenge === null) {
    return null;
  }
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}

// --- Payload -------------------------------------------------------------------

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export interface StatusUpdate {
  /** The wamid Meta answered our send with. */
  readonly id: string;
  readonly status: DeliveryStatus;
  readonly at: Date;
  /** `<code> <title>` of the first error, for a failure. Never the details. */
  readonly error: string | null;
}

export interface InboundMessage {
  readonly id: string;
  /** Digits as Meta sends them — country code, no `+`. */
  readonly from: string;
  /** The words to classify; "" for a message with none (an image, a sticker). */
  readonly text: string;
}

export interface WhatsAppCallback {
  readonly statuses: readonly StatusUpdate[];
  readonly messages: readonly InboundMessage[];
}

const STATUSES = new Set<string>(["sent", "delivered", "read", "failed"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/** Meta's timestamps are unix SECONDS, as a string. */
function fromUnixSeconds(value: unknown): Date | null {
  const seconds = typeof value === "number" ? value : Number(asString(value));
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

/**
 * The words in an inbound message, wherever its type keeps them.
 *
 * `text` is typed; `button` is a tap on a template's quick-reply (its label,
 * or the payload we set); `interactive` is a reply button or a list row. A tap
 * on a "Stop updates" quick reply must count as a STOP just as the typed word
 * does. Anything else — media, location, a reaction — has no words.
 */
export function inboundText(message: Record<string, unknown>): string {
  const type = asString(message["type"]);
  if (type === "text" && isRecord(message["text"])) {
    return asString(message["text"]["body"]);
  }
  if (type === "button" && isRecord(message["button"])) {
    return asString(message["button"]["text"]) || asString(message["button"]["payload"]);
  }
  if (type === "interactive" && isRecord(message["interactive"])) {
    const interactive = message["interactive"];
    const reply = isRecord(interactive["button_reply"])
      ? interactive["button_reply"]
      : isRecord(interactive["list_reply"])
        ? interactive["list_reply"]
        : null;
    return reply === null ? "" : asString(reply["title"]) || asString(reply["id"]);
  }
  return "";
}

/**
 * Read a callback body into the two things we act on. Tolerant by design:
 * anything malformed is skipped rather than thrown, because a callback Meta
 * cannot get a 200 for is retried for days, and no retry will make a shape we
 * do not understand into one we do. Only the `messages` field is read — the
 * account, template-quality and billing fields are other subscriptions.
 */
export function parseWhatsAppCallback(payload: unknown): WhatsAppCallback {
  const statuses: StatusUpdate[] = [];
  const messages: InboundMessage[] = [];
  if (!isRecord(payload)) {
    return { statuses, messages };
  }
  for (const entry of asArray(payload["entry"])) {
    if (!isRecord(entry)) continue;
    for (const change of asArray(entry["changes"])) {
      if (!isRecord(change) || change["field"] !== "messages" || !isRecord(change["value"])) {
        continue;
      }
      const value = change["value"];
      for (const raw of asArray(value["statuses"])) {
        if (!isRecord(raw)) continue;
        const id = asString(raw["id"]);
        const status = asString(raw["status"]);
        const at = fromUnixSeconds(raw["timestamp"]);
        if (id === "" || !STATUSES.has(status) || at === null) continue;
        const first = asArray(raw["errors"])[0];
        statuses.push({
          id,
          status: status as DeliveryStatus,
          at,
          error: status === "failed" ? describeError(first) : null,
        });
      }
      for (const raw of asArray(value["messages"])) {
        if (!isRecord(raw)) continue;
        const id = asString(raw["id"]);
        const from = asString(raw["from"]);
        if (id === "" || from === "") continue;
        messages.push({ id, from, text: inboundText(raw) });
      }
    }
  }
  return { statuses, messages };
}

/**
 * `131026 Message undeliverable` — the code and Meta's generic title, and
 * nothing else. `message` and `error_data.details` can quote the recipient, so
 * they are not kept.
 */
function describeError(raw: unknown): string {
  if (!isRecord(raw)) {
    return "unknown";
  }
  const code = typeof raw["code"] === "number" ? String(raw["code"]) : asString(raw["code"]);
  const title = asString(raw["title"]).slice(0, 120);
  return [code, title].filter((part) => part !== "").join(" ") || "unknown";
}

/**
 * Meta's `from` (digits, country code, no `+`) as the E.164 `people.phone` is
 * stored in. Not `normaliseInboundNumber` from the SMS path: that one reads ten
 * bare digits as an Indian mobile, which an SMS operator sends and Meta never
 * does — here a short number is malformed, not local.
 */
export function normaliseWhatsAppNumber(from: string): string | null {
  const digits = from.trim().replace(/^\+/, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

// --- Status order --------------------------------------------------------------

/**
 * WHICH STATUS MAY FOLLOW WHICH. Meta delivers callbacks in whatever order its
 * queues drain, so "read" can arrive before "delivered", and a retried "sent"
 * can arrive after both. The row only ever moves forward:
 *
 *   (none) → sent → delivered → read
 *   (none) → failed,   sent → failed
 *
 * FAILED IS TERMINAL, and it does not overwrite a delivery. Meta's own model:
 * a failed message is one it gave up on, and it sends no later status for it.
 * The only way to see "failed" after "delivered" is a contradiction in the
 * feed, and the phone having said "delivered" is the stronger evidence — so the
 * delivery stands and the failure is dropped. Choosing it this way round means
 * a message is never reported failed that a person actually received.
 */
const MAY_FOLLOW: Readonly<Record<DeliveryStatus, readonly (DeliveryStatus | null)[]>> = {
  sent: [null],
  delivered: [null, "sent"],
  read: [null, "sent", "delivered"],
  failed: [null, "sent"],
};

/** Pure: may a row at `current` move to `next`? */
export function mayAdvance(current: DeliveryStatus | null, next: DeliveryStatus): boolean {
  return MAY_FOLLOW[next].includes(current);
}

export type StatusOutcome = "applied" | "stale" | "unknown";

/**
 * Apply one status to the outbox row that carries its wamid.
 *
 * ONE conditional UPDATE, not read-then-write: the guard is in the WHERE, so two
 * callbacks racing for the same row cannot both pass a check made before either
 * wrote. Zero rows touched means either the id is not ours — sign-in codes are
 * sent outside the outbox and report here too — or the row has already moved
 * past this status; one read afterwards tells the two apart for the counts.
 *
 * The outbox's own `status` is left alone. "sent" there means the provider
 * accepted it, which is still true of a message the phone never got; delivery
 * truth lives in `delivery_status` beside it.
 */
export async function applyStatus(db: Db, update: StatusUpdate): Promise<StatusOutcome> {
  const predecessors = MAY_FOLLOW[update.status];
  const named = predecessors.filter((value): value is DeliveryStatus => value !== null);
  const set: PgUpdateSetSource<typeof messageOutbox> = { deliveryStatus: update.status };
  if (update.status === "delivered") {
    set.deliveredAt = update.at;
  }
  if (update.status === "read") {
    set.readAt = update.at;
    // Read implies delivered. If "delivered" never arrives (or arrives later
    // and is refused as stale), the read time is the latest it can have been.
    set.deliveredAt = sql`coalesce(${messageOutbox.deliveredAt}, ${update.at.toISOString()}::timestamptz)`;
  }
  if (update.status === "failed") {
    set.deliveryError = update.error ?? "unknown";
  }
  const updated = await db
    .update(messageOutbox)
    .set(set)
    .where(
      and(
        eq(messageOutbox.providerMessageId, update.id),
        or(
          isNull(messageOutbox.deliveryStatus),
          named.length > 0 ? inArray(messageOutbox.deliveryStatus, named) : undefined,
        ),
      ),
    )
    .returning({ id: messageOutbox.id });
  if (updated.length > 0) {
    return "applied";
  }
  const [exists] = await db
    .select({ id: messageOutbox.id })
    .from(messageOutbox)
    .where(eq(messageOutbox.providerMessageId, update.id))
    .limit(1);
  return exists === undefined ? "unknown" : "stale";
}

// --- Inbound -------------------------------------------------------------------

/**
 * THE CONSENT ROW'S `source`: a WhatsApp reply is filed as one (0085 widened
 * 0044's closed set), so an audit can tell a STOP on WhatsApp from a STOP by SMS
 * without opening the evidence.
 */
export const WHATSAPP_REPLY_SOURCE = { stop: "whatsapp_stop", start: "whatsapp_start" } as const;

export interface InboundOutcome {
  /** False when Meta retried a message already handled — nothing was done. */
  readonly first: boolean;
  readonly intent: InboundIntent;
  /** A consent row was appended (a STOP/START from a number we know). */
  readonly consentRecorded: boolean;
  /** What to send back, if anything. The caller sends it after the write. */
  readonly reply: string | null;
}

export const STOP_REPLY =
  "You won't get DesiAuction updates on WhatsApp any more. Reply START to turn them back on.";
export const START_REPLY = "WhatsApp updates from DesiAuction are back on. Reply STOP any time.";

/**
 * WHAT A WHATSAPP REPLY MEANS — narrower than an SMS reply, on purpose.
 *
 * STOP keeps every word the SMS side honours (inbound.ts): withdrawing has to
 * be as easy as it can be. Turning updates back ON takes the word START and
 * nothing else (founder decision, 2026-09-23). On WhatsApp people chat — "yes",
 * "ok, subscribe me to the scores" — and the SMS list's "yes"/"subscribe"/
 * "resume" would re-enable messages somebody had deliberately stopped, from a
 * reply that was never meant as consent.
 */
export function classifyWhatsAppReply(body: string): InboundIntent {
  const intent = classifyInbound(body);
  if (intent !== "start") {
    return intent;
  }
  const first = body.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return first.replace(/[^a-z]/g, "") === "start" ? "start" : "unknown";
}

/**
 * Record one inbound message, and act on it the FIRST time only.
 *
 * The `whatsapp_inbound` row is both the record and the lock: its primary key
 * is Meta's message id, so a retried callback inserts nothing and returns
 * `first: false` before any consent is written or any reply is sent. The
 * insert and the consent row share one transaction — if the consent write
 * failed and the insert stood, the retry would find the id taken and the STOP
 * would be lost for good; rolled back together, the retry does it properly.
 *
 * The body is never stored. What is kept is the keyword it was read as.
 */
export async function recordInbound(db: Db, message: InboundMessage): Promise<InboundOutcome> {
  const phone = normaliseWhatsAppNumber(message.from);
  const intent = classifyWhatsAppReply(message.text);
  if (phone === null) {
    return { first: false, intent, consentRecorded: false, reply: null };
  }
  return db.transaction(async (tx) => {
    // A person is anchored by a unique phone (0062), so this is one row or none.
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.phone, phone))
      .limit(1);
    const personId = person?.id ?? null;
    const inserted = await tx
      .insert(whatsappInbound)
      .values({ providerMessageId: message.id, phone, intent, personId })
      .onConflictDoNothing({ target: whatsappInbound.providerMessageId })
      .returning({ id: whatsappInbound.providerMessageId });
    if (inserted.length === 0) {
      return { first: false, intent, consentRecorded: false, reply: null };
    }
    if (intent === "unknown") {
      // Recorded, and deliberately not answered: this is an opt-out receiver,
      // not a chatbot, and a reply to "thanks" would be a message nobody asked for.
      return { first: true, intent, consentRecorded: false, reply: null };
    }
    if (personId !== null) {
      await recordConsent(tx, {
        personId,
        purpose: WHATSAPP_CONSENT_PURPOSE,
        granted: intent === "start",
        source: WHATSAPP_REPLY_SOURCE[intent],
        evidence: { channel: "whatsapp", keyword: firstWord(message.text), messageId: message.id },
      });
    }
    /*
     * The confirmation. A STOP is confirmed whether or not the number is known:
     * the promise ("you won't get updates") is true either way, because a number
     * with no person has no opt-in to send on. A START is confirmed only when a
     * consent row was written — telling a stranger "updates are back on" would
     * be a promise nothing backs.
     */
    const reply = intent === "stop" ? STOP_REPLY : personId !== null ? START_REPLY : null;
    return { first: true, intent, consentRecorded: personId !== null, reply };
  });
}

/** The keyword as the person typed it, for the evidence — never the sentence. */
function firstWord(text: string): string {
  return (text.trim().split(/\s+/)[0] ?? "").slice(0, 32);
}

// --- The confirmation reply ------------------------------------------------------

export type ReplyTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<ProviderResponse>;

/** Pinned like the senders': a vendor's "latest" must not move this path. */
const WHATSAPP_API_BASE = "https://graph.facebook.com/v21.0";

export interface WhatsAppReplier {
  /** Resolves true when Meta accepted it. Never throws. */
  reply(to: string, text: string): Promise<boolean>;
}

/**
 * A free-form text back to someone who has just written to us.
 *
 * Free-form (not a template) is allowed only inside the customer-service
 * window a person's own message opens, which is exactly when this runs. It is
 * deadline-bound (provider-fetch.ts) and swallows every failure: the opt-out is
 * already recorded by the time this is called, and a confirmation that could
 * not be sent must not turn into a non-2xx that makes Meta retry the callback.
 */
export function createWhatsAppReplier(config: {
  phoneNumberId: string;
  accessToken: string;
  apiBase?: string;
  transport?: ReplyTransport;
}): WhatsAppReplier {
  const transport = config.transport ?? providerFetch;
  const base = config.apiBase ?? WHATSAPP_API_BASE;
  return {
    async reply(to, text) {
      try {
        const response = await transport(
          `${base}/${encodeURIComponent(config.phoneNumberId)}/messages`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: to.replace(/^\+/, ""),
              type: "text",
              text: { body: text, preview_url: false },
            }),
          },
        );
        return response.status < 400 && !response.body.includes('"error"');
      } catch {
        return false;
      }
    },
  };
}

// --- One callback, end to end -----------------------------------------------------

export interface CallbackSummary {
  readonly statusesApplied: number;
  readonly statusesStale: number;
  readonly statusesUnknown: number;
  readonly inboundNew: number;
  readonly inboundRepeat: number;
  readonly consentsRecorded: number;
  readonly repliesSent: number;
  readonly repliesFailed: number;
}

/**
 * Everything one verified callback asks for, in order: statuses, then inbound
 * messages, each confirmed as soon as its own write has committed. Bounded by
 * the payload — Meta batches a handful of changes per POST — so it runs inline
 * and the route answers when it is done. Returns counts only; that is all
 * anyone may log.
 *
 * WHY THE REPLY GOES RIGHT AFTER ITS OWN COMMIT, and not after the batch: if a
 * later message in the same callback throws, Meta retries the whole callback,
 * and the retry finds the earlier message already recorded (`first: false`)
 * and does nothing — so a confirmation deferred to the end of the batch would
 * never be sent at all. Sent per message, each one goes exactly once.
 *
 * A throw propagates. The route turns it into a retryable answer, which is
 * safe because every write here is idempotent: statuses are a forward-only
 * conditional update, inbound rows are keyed by Meta's own message id.
 */
export async function handleWhatsAppCallback(
  db: Db,
  callback: WhatsAppCallback,
  replier: WhatsAppReplier | null,
): Promise<CallbackSummary> {
  let statusesApplied = 0;
  let statusesStale = 0;
  let statusesUnknown = 0;
  for (const update of callback.statuses) {
    const outcome = await applyStatus(db, update);
    if (outcome === "applied") statusesApplied += 1;
    else if (outcome === "stale") statusesStale += 1;
    else statusesUnknown += 1;
  }
  let inboundNew = 0;
  let inboundRepeat = 0;
  let consentsRecorded = 0;
  let repliesSent = 0;
  let repliesFailed = 0;
  for (const message of callback.messages) {
    const outcome = await recordInbound(db, message);
    if (!outcome.first) {
      inboundRepeat += 1;
      continue;
    }
    inboundNew += 1;
    if (outcome.consentRecorded) consentsRecorded += 1;
    if (outcome.reply !== null && replier !== null) {
      if (await replier.reply(message.from, outcome.reply)) repliesSent += 1;
      else repliesFailed += 1;
    }
  }
  return {
    statusesApplied,
    statusesStale,
    statusesUnknown,
    inboundNew,
    inboundRepeat,
    consentsRecorded,
    repliesSent,
    repliesFailed,
  };
}
