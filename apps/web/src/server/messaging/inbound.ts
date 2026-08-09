import { suppressions, type Db } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

import { liftSuppression, suppress } from "./consent";

/**
 * INBOUND SMS: the keyword that makes an opt-out real.
 *
 * A suppression list nobody can add themselves to is not an opt-out — it is a
 * table. This is the receiver: the operator forwards inbound messages sent to
 * our sender header, and a person texting STOP is added to the suppression list
 * within one message round-trip, with no account and no app required.
 *
 * That matters more here than in most markets. The people this product texts
 * are club cricketers who registered once from a WhatsApp link; most will never
 * sign in again, and "manage your preferences in the app" is not an opt-out
 * they can reach. The keyword is.
 *
 * DLT-registered headers must honour STOP, and under the DPDP Act withdrawing
 * consent has to be as easy as giving it. Replying to the message that bothered
 * you is as easy as it gets.
 */

/**
 * The keywords, and why this set.
 *
 * TRAI and every major operator treat STOP as the universal opt-out, and the
 * rest are what people actually send when annoyed. Matching is case-insensitive
 * on the FIRST word only: "STOP sending me this" is a stop, and a message that
 * merely contains the word ("please don't stop the auction") is not.
 */
const STOP_WORDS = new Set(["stop", "unsub", "unsubscribe", "optout", "opt-out", "cancel", "end"]);
const START_WORDS = new Set(["start", "unstop", "subscribe", "optin", "opt-in", "resume", "yes"]);

export type InboundIntent = "stop" | "start" | "unknown";

/** Classify an inbound message body. Pure, and the whole reason it is testable. */
export function classifyInbound(body: string): InboundIntent {
  const first = body.trim().toLowerCase().split(/\s+/)[0] ?? "";
  // Strip punctuation people add: "STOP." and "STOP!" are stops.
  const word = first.replace(/[^a-z-]/g, "");
  if (STOP_WORDS.has(word)) {
    return "stop";
  }
  if (START_WORDS.has(word)) {
    return "start";
  }
  return "unknown";
}

/**
 * Normalise whatever the operator hands us into the E.164 form the suppression
 * list is keyed by, because a STOP recorded against `919812345678` would never
 * match a send addressed to `+919812345678`.
 *
 * India-shaped on purpose: this product stores +91 numbers and the operator
 * delivers bare digits. Anything already carrying a `+` is left alone.
 */
export function normaliseInboundNumber(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  if (trimmed.startsWith("+")) {
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  return digits === "" ? null : `+${digits}`;
}

export type InboundResult =
  | { readonly handled: true; readonly intent: "stop" | "start" }
  | { readonly handled: false; readonly reason: "no_number" | "unknown_keyword" };

/**
 * Apply an inbound message.
 *
 * Deliberately idempotent: a second STOP from an already-suppressed number
 * writes nothing. Operators retry, people press send twice, and a suppression
 * list that grows a row per retry is a list nobody can read.
 *
 * It never reports whether the number belongs to anyone. The endpoint answers
 * the operator, not the sender, and "we have no such user" is not a fact an
 * inbound message should be able to extract.
 */
export async function applyInbound(
  db: Db,
  input: { from: string; body: string },
): Promise<InboundResult> {
  const contact = normaliseInboundNumber(input.from);
  if (contact === null) {
    return { handled: false, reason: "no_number" };
  }
  const intent = classifyInbound(input.body);
  if (intent === "unknown") {
    return { handled: false, reason: "unknown_keyword" };
  }
  if (intent === "start") {
    await liftSuppression(db, { contact, channel: "sms" });
    return { handled: true, intent };
  }
  const existing = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.contact, contact),
        eq(suppressions.channel, "sms"),
        eq(suppressions.scope, "global"),
        isNull(suppressions.liftedAt),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    await suppress(db, {
      contact,
      channel: "sms",
      reason: "stop",
      note: `inbound: ${input.body.trim().slice(0, 120)}`,
    });
  }
  return { handled: true, intent };
}
