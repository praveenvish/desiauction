import { createHmac, timingSafeEqual } from "node:crypto";

import {
  notificationOf,
  personTopics,
  type NotificationKind,
  type NotificationTopic,
} from "@desiauction/messaging/catalogue";

import { env } from "../../env";

/**
 * ONE-CLICK UNSUBSCRIBE (RFC 8058) FOR THE MAIL A PERSON CAN SWITCH OFF.
 *
 * Gmail and Yahoo show their own "Unsubscribe" beside the sender when a mail
 * carries `List-Unsubscribe` + `List-Unsubscribe-Post`, and they count a mail
 * without it that people mark as spam against us instead. So every mail the
 * reader has a switch for carries a link that turns that switch off in one
 * POST — no sign-in, because the link itself is the proof: it is an HMAC of
 * the person and the topic, derived (never stored) so a leaked backup holds no
 * working links.
 *
 * WHICH MAIL. Exactly the ones with "Manage emails" in the footer: the kind's
 * topic is one of the person's /account switches. A sign-in code, a security
 * alert, a demo booking (a stranger, no account) and a staff notice have no
 * switch, so they carry no header — offering an unsubscribe that cannot work
 * is worse than offering none.
 *
 * WHAT IT TURNS OFF is the same switch /account shows: the topic, for email
 * and text together (catalogue PERSON_SWITCH_CHANNELS). Stopping only the email
 * would leave the account page saying "on" about mail that has stopped.
 *
 * Keyed with DEMO_TOKEN_SECRET under its own prefix, as the newsletter's
 * removal link is (marketing/newsletter.ts): one derived-link key, separated by
 * purpose, so no new secret has to reach production first.
 */

const MANAGEABLE_TOPICS: ReadonlySet<NotificationTopic> = new Set(
  personTopics().map((entry) => entry.topic),
);

/**
 * The reader has an /account switch for this kind: its topic is one of their
 * switches AND the kind obeys it. A moderation notice sits under "club" but no
 * switch stops it, so it must not offer one.
 */
export function isSelfManagedKind(kind: NotificationKind): boolean {
  const entry = notificationOf(kind);
  return entry.personControllable && MANAGEABLE_TOPICS.has(entry.topic);
}

export function isSelfManagedTopic(topic: string): topic is NotificationTopic {
  return MANAGEABLE_TOPICS.has(topic as NotificationTopic);
}

export function unsubscribeToken(personId: string, topic: string): string {
  return createHmac("sha256", env.DEMO_TOKEN_SECRET)
    .update(`email-unsubscribe:${personId}:${topic}`)
    .digest("base64url")
    .slice(0, 32);
}

/** Constant-time; anything malformed, or a topic nobody can switch, is no. */
export function unsubscribeTokenMatches(
  personId: unknown,
  topic: unknown,
  token: unknown,
): boolean {
  if (
    typeof personId !== "string" ||
    typeof topic !== "string" ||
    typeof token !== "string" ||
    !/^[0-9A-Z]{26}$/.test(personId) ||
    !isSelfManagedTopic(topic)
  ) {
    return false;
  }
  const expected = Buffer.from(unsubscribeToken(personId, topic));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function query(personId: string, topic: string): string {
  return new URLSearchParams({
    p: personId,
    topic,
    t: unsubscribeToken(personId, topic),
  }).toString();
}

/** The link mail clients POST to (List-Unsubscribe). A GET here shows the page instead. */
export function oneClickUnsubscribeUrl(personId: string, topic: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/email/unsubscribe?${query(personId, topic)}`;
}

/** The page a person lands on to confirm (and undo) by hand. */
export function unsubscribePageUrl(personId: string, topic: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/email/unsubscribe?${query(personId, topic)}`;
}

/**
 * The two headers, for a mail to a person about a kind they can switch off —
 * else undefined, and the mail goes without them.
 */
export function unsubscribeHeaders(
  kind: NotificationKind,
  personId: string | null | undefined,
): Readonly<Record<string, string>> | undefined {
  if (personId === null || personId === undefined || !isSelfManagedKind(kind)) {
    return undefined;
  }
  return {
    "List-Unsubscribe": `<${oneClickUnsubscribeUrl(personId, notificationOf(kind).topic)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
