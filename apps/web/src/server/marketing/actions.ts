"use server";

import { headers } from "next/headers";

import { env } from "../../env";
import { clientIp } from "../../lib/client-ip";
import { db } from "../db";
import { sendDemoRequestMail } from "./demo-mail";
import { isSubscribeThrottled, subscribe, unsubscribe } from "./newsletter";
import { pickHandleFor } from "./demo-booking";
import {
  acknowledgementsSpent,
  isThrottled,
  recordDemoRequest,
  validateDemoRequest,
  type ValidationField,
} from "./demo-requests";
import { logger } from "../logger";

// Anonymous, unauthenticated capture — newsletter_subscribers carries no
// tenant data and no RLS (schema.ts), so a plain pool write is correct here,
// the same way auth/actions.ts writes pre-session rows directly through `db`.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * THE FOOTER'S SIGN-UP — limited, retained for a stated time, and reversible.
 *
 * The limit is a row count per network address, like every other anonymous
 * write here (see `server/marketing/newsletter.ts`); it used to live in process
 * memory, which a restart forgot. A refused sign-up reads as the ordinary
 * success, as `requestOtp` and `requestDemo` do: telling a script which of its
 * attempts counted is telling it the shape of the limit.
 */
export async function subscribeNewsletterAction(
  _previous: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const email = formData.get("email");
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    return { error: "Enter a valid email address." };
  }
  const ip = await requestIp();
  if (await isSubscribeThrottled(db, ip)) {
    return { success: true };
  }
  await subscribe(db, email, ip);
  return { success: true };
}

/**
 * Take an address off the list. The answer is the same whether or not it was on
 * it, so this page cannot be used to learn who subscribed.
 */
export async function unsubscribeNewsletterAction(
  _previous: { error?: string; done?: boolean },
  formData: FormData,
): Promise<{ error?: string; done?: boolean }> {
  const email = formData.get("email");
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    return { error: "Enter a valid email address." };
  }
  await unsubscribe(db, email);
  return { done: true };
}

/**
 * A DEMO REQUEST — the form that replaced a mailto link.
 *
 * Same pool and same reasoning as the newsletter above: `demo_requests` carries
 * no tenant data and no RLS (migration 0031), so a plain pool write is correct.
 *
 * THE ORDER OF WORK IS THE DESIGN.
 *
 *   honeypot → validate → throttle → INSERT → acknowledge
 *
 * The insert lands before anything is sent, so a mail provider that is down,
 * unconfigured, or refusing cannot cost us a lead the person believes they have
 * given us. The acknowledgement is awaited rather than floated — a server
 * action's process may be frozen the moment it returns, and a dangling promise
 * is how "we emailed you" becomes a coin flip — but its outcome cannot fail the
 * submission. What the person is told on screen is the contract; the mail is a
 * convenience layered on top of it.
 */
export interface DemoRequestState {
  readonly error?: string;
  readonly field?: ValidationField;
  readonly success?: boolean;
  /**
   * The SIGNED handle the picker books with (`pickHandleFor`), never the bare
   * request id — see demo-booking.ts for why the id alone is not enough.
   */
  readonly pickHandle?: string;
}

async function requestIp(): Promise<string | null> {
  // PRR P2/F32: the same spoof-resistant client-IP resolution as the OTP throttle
  // — never trust the leftmost, client-controlled x-forwarded-for entry.
  return clientIp(await headers(), env.TRUSTED_PROXY_COUNT);
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function requestDemoAction(
  _previous: DemoRequestState,
  formData: FormData,
): Promise<DemoRequestState> {
  // THE HONEYPOT. A field no human sees and every naive bot fills. The refusal
  // is a plain success: telling a scraper which of its submissions were binned
  // is telling it how to stop being binned. No captcha — the platform's CSP
  // admits no third-party script, and that is worth more than this form is.
  if (field(formData, "company_website").trim() !== "") {
    return { success: true };
  }

  const validated = validateDemoRequest({
    name: field(formData, "name"),
    phone: field(formData, "phone"),
    email: field(formData, "email"),
    orgName: field(formData, "orgName"),
    sport: field(formData, "sport"),
    tournamentSize: field(formData, "tournamentSize"),
    auctionOn: field(formData, "auctionOn"),
    preferredWindow: field(formData, "preferredWindow"),
    note: field(formData, "note"),
    source: field(formData, "source"),
    requestIp: await requestIp(),
  });
  if (!validated.ok) {
    return { error: validated.message, field: validated.field };
  }
  const request = validated.value;

  // Silent on refusal, deliberately: see `isThrottled`. Someone who has already
  // asked three times today sees the same screen as someone who has asked once,
  // and we do not learn about the fourth.
  if (await isThrottled(db, request.phone, request.requestIp)) {
    return { success: true };
  }

  const requestId = await recordDemoRequest(db, request);

  const outcomes = await sendDemoRequestMail(request, requestId, {
    acknowledge: !(await acknowledgementsSpent(db)),
  });
  if (outcomes.founder === "failed" || outcomes.requester === "failed") {
    // The lead is safe in the database and the person has been told on screen.
    // This is an operational problem, and an operational problem that is not
    // written down is one nobody fixes.
    logger().error({ demoRequestId: requestId, ...outcomes }, "demo.request_mail_failed");
  }

  return { success: true, pickHandle: pickHandleFor(requestId) };
}
