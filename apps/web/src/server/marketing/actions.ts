"use server";

import { headers } from "next/headers";

import { newId, newsletterSubscribers } from "@desiauction/db";

import { env } from "../../env";
import { clientIp } from "../../lib/client-ip";
import { db } from "../db";
import { sendDemoRequestMail } from "./demo-mail";
import {
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
 * THE ONE PUBLIC WRITE WITH NO CEILING ON IT.
 *
 * Every other anonymous write in this product is throttled — `requestOtp`
 * counts codes per phone and per IP, `isThrottled` counts demo requests per
 * phone and per day — and this one, reachable by anyone from the footer of
 * every public page, was not. Each distinct address is a new row, so the unique
 * index does not bound anything: a script can write as many rows as it can
 * invent addresses, and the table has no retention sweep to age them out.
 *
 * IN MEMORY, AND THE LIMITATION IS THE POINT RATHER THAN AN OVERSIGHT. The
 * database-backed throttles above count rows in the table they protect;
 * `newsletter_subscribers` has no `request_ip` column, so counting per address
 * there would need a migration, and a migration is a heavier change than this
 * risk justifies. A per-process bucket is exact on the one-replica topology
 * `ops/deploy/docker-compose.production.yml` actually runs, and degrades to
 * "per instance" rather than to "none" if that ever becomes two. When the
 * column lands, this should become the same row count as its neighbours.
 */
const SUBSCRIBE_MAX_PER_IP_PER_HOUR = 5;
const SUBSCRIBE_WINDOW_MS = 60 * 60 * 1000;
const subscribeBuckets = new Map<string, number[]>();

function subscribeThrottled(ip: string | null, now: number): boolean {
  if (ip === null) {
    return false;
  }
  // Sweep every bucket, not only this caller's: without it the map grows by one
  // entry per distinct address forever, which is the same unbounded growth one
  // level up.
  for (const [key, stamps] of subscribeBuckets) {
    const live = stamps.filter((at) => now - at < SUBSCRIBE_WINDOW_MS);
    if (live.length === 0) {
      subscribeBuckets.delete(key);
    } else {
      subscribeBuckets.set(key, live);
    }
  }
  const recent = subscribeBuckets.get(ip) ?? [];
  if (recent.length >= SUBSCRIBE_MAX_PER_IP_PER_HOUR) {
    return true;
  }
  subscribeBuckets.set(ip, [...recent, now]);
  return false;
}

export async function subscribeNewsletterAction(
  _previous: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const email = formData.get("email");
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    return { error: "Enter a valid email address." };
  }
  // A refusal reads as the ordinary success screen, exactly as `requestOtp` and
  // `requestDemo` do: telling a script which of its attempts were counted is
  // telling it the shape of the limit.
  if (subscribeThrottled(await requestIp(), Date.now())) {
    return { success: true };
  }
  try {
    await db
      .insert(newsletterSubscribers)
      .values({ id: newId(), email: email.trim().toLowerCase() });
  } catch {
    // Duplicate email (unique constraint) — treated as success, not an error;
    // the person is already subscribed.
    return { success: true };
  }
  return { success: true };
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
  /** Phase 2: the picker needs the id of the request it is booking against. */
  readonly requestId?: string;
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

  const outcomes = await sendDemoRequestMail(request, requestId);
  if (outcomes.founder === "failed" || outcomes.requester === "failed") {
    // The lead is safe in the database and the person has been told on screen.
    // This is an operational problem, and an operational problem that is not
    // written down is one nobody fixes.
    logger().error({ demoRequestId: requestId, ...outcomes }, "demo.request_mail_failed");
  }

  return { success: true, requestId };
}
