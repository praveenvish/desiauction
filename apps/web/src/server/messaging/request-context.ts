import { headers } from "next/headers";

import type { MessageLanguage } from "@desiauction/messaging/email-templates";

import { describeUserAgent } from "../auth/user-agent";
import { whenWords } from "../marketing/demo-slots";

/**
 * WHERE AND WHEN A REQUEST CAME FROM — the facts a sign-in code or a security
 * alert shows so a person can tell at a glance whether it was them.
 *
 * "Chrome on macOS · Sun 28 Sep, 7:42 pm IST" under a code you did not ask for
 * is what turns a confusing mail into an obvious "that wasn't me". Only what we
 * can say honestly: the browser and system from the user agent (the same
 * labels the sessions list uses), never a city — we do not resolve addresses
 * to places, and a wrong guess is worse than none.
 *
 * These are code-owned FACTS (a details table), not wording: an admin editing
 * the template can reword the mail around them, never change what they say.
 */
export interface RequestContext {
  /** "Chrome on macOS", or null when the user agent says nothing honest. */
  readonly device: string | null;
  readonly at: Date;
}

/** The current request's context. Outside a request (a job, a test), no device. */
export async function currentRequestContext(now: Date = new Date()): Promise<RequestContext> {
  try {
    return { device: describeUserAgent((await headers()).get("user-agent")), at: now };
  } catch {
    return { device: null, at: now };
  }
}

const HI_MOMENT = new Intl.DateTimeFormat("hi-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

/** "Sun 28 Sep, 7:42 pm IST" / "सोम, 28 सित॰, 7:42 pm IST". */
export function momentWords(at: Date, language: MessageLanguage): string {
  return language === "hi" ? `${HI_MOMENT.format(at)} IST` : whenWords(at);
}

const LABELS: Readonly<
  Record<"code" | "change", Record<MessageLanguage, { device: string; when: string }>>
> = {
  // Short on purpose: label and value share one line on a 390 px phone.
  // A code someone ASKED for.
  code: {
    en: { device: "Device", when: "Requested" },
    hi: { device: "डिवाइस", when: "माँगा गया" },
  },
  // A change someone MADE.
  change: {
    en: { device: "Device", when: "Changed" },
    hi: { device: "डिवाइस", when: "बदला गया" },
  },
};

/** The details rows for a code or an alert, in the reader's language. */
export function requestDetails(
  context: RequestContext,
  purpose: "code" | "change",
  language: MessageLanguage,
): readonly (readonly [string, string])[] {
  const label = LABELS[purpose][language];
  return [
    ...(context.device === null ? [] : [[label.device, context.device] as const]),
    [label.when, momentWords(context.at, language)] as const,
  ];
}
