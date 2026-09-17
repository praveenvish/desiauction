import { newId, problemReportScreenshots, problemReports, type Db } from "@desiauction/db";
import { and, eq, gt, sql } from "drizzle-orm";

/**
 * A PROBLEM REPORT, VALIDATED AND RATE-LIMITED — everything except the IO
 * (FR-1 Phase 1).
 *
 * Shaped like `server/marketing/demo-requests.ts` on purpose: the rules are
 * testable without a server action harness, and the throttle is one function.
 *
 * NO RLS AND NO TENANT (migration 0064). A guest can file one; a signed-in
 * report is about the platform, not an organization. Writes ride the app pool.
 *
 * EVERYTHING HERE ARRIVES FROM A BROWSER AND IS ECHOED INTO AN OPERATOR'S
 * QUEUE AND INBOX. So nothing is stored as sent: the URL is rebuilt from its
 * parts with secrets removed, the context is a closed set of keys with capped
 * values, and the screenshot is identified by its bytes, not its label.
 */

export const PROBLEM_CATEGORIES = ["bug", "confusing", "idea", "other"] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

export const PROBLEM_STATUSES = ["new", "triaged", "fixed", "wont_fix", "duplicate"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** Kept in step with the CHECKs in 0064. */
export const DESCRIPTION_LIMIT = 4000;
export const SCREENSHOT_MAX_BYTES = 1024 * 1024;

/**
 * Limits. Per person (or per connection, for a guest) — somebody hitting three
 * different bugs in an evening is the feature working, so these are loose. They
 * exist to stop a script filling the support inbox, not to ration people.
 */
const MAX_PER_PERSON_PER_HOUR = 10;
const MAX_PER_IP_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * THE CONTEXT, AS A CLOSED SET.
 *
 * Anything else the client sends is dropped. Each value is a short string: a
 * user agent is the longest honest one, and 300 characters holds every real
 * user agent while refusing a megabyte of "context".
 */
export const CONTEXT_KEYS = ["viewport", "userAgent", "theme", "language", "timezone"] as const;
export type ContextKey = (typeof CONTEXT_KEYS)[number];
const CONTEXT_VALUE_LIMIT = 300;

/**
 * Route segments that ARE a credential. Somebody reporting a broken invite link
 * must not mail the working invite to the support inbox, or store it in a table
 * every operator can read. Keep in step with `app/*\/[token]`; the unit test
 * reads the app directory so a new token route cannot be forgotten silently.
 */
export const TOKEN_ROUTE_PREFIXES = ["join", "owner-join", "demo"] as const;

export const REDACTED = "[redacted]";

/**
 * Rebuild the page address with nothing secret left in it.
 *
 * Origin is replaced by ours (a report cannot claim to be about another site),
 * the query string and fragment are dropped (sign-in `next=`, filters, and
 * anything a future feature decides to put there), and the segment after a
 * token route is replaced. Returns null for anything that is not a path on
 * this site.
 */
export function redactPageUrl(raw: string, baseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  const base = new URL(baseUrl);
  if (parsed.origin !== base.origin) {
    return null;
  }
  const segments = parsed.pathname.split("/");
  for (let index = 1; index < segments.length - 1; index += 1) {
    if ((TOKEN_ROUTE_PREFIXES as readonly string[]).includes(segments[index] ?? "")) {
      if ((segments[index + 1] ?? "") !== "") {
        segments[index + 1] = REDACTED;
      }
    }
  }
  const path = segments.join("/").slice(0, 500);
  return `${base.origin}${path === "" ? "/" : path}`;
}

/** Keep the keys we know, cap the values, drop the rest. */
export function sanitizeContext(raw: unknown): Record<ContextKey, string> | Record<string, never> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Partial<Record<ContextKey, string>> = {};
  for (const key of CONTEXT_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string") {
      // Control characters would survive into a plain-text email and a table
      // cell; nothing honest in a user agent needs them.
      // eslint-disable-next-line no-control-regex
      const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      if (clean !== "") {
        out[key] = clean.slice(0, CONTEXT_VALUE_LIMIT);
      }
    }
  }
  return out as Record<ContextKey, string>;
}

export type ScreenshotType = "image/jpeg" | "image/png" | "image/webp";

/**
 * What the bytes ARE, by their magic numbers — never by the `type` the browser
 * attached, which is whatever the sender says. A file that is none of these
 * three is refused, so the operator's page can only ever render an image.
 */
export function sniffImageType(bytes: Uint8Array): ScreenshotType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export interface ProblemReportInput {
  readonly category: string;
  readonly description: string;
  readonly replyEmail: string;
  readonly pageUrl: string;
  readonly context: unknown;
  readonly personId: string | null;
  readonly requestIp: string | null;
  /** Null when the person removed the screenshot or none was taken. */
  readonly screenshot: Uint8Array | null;
}

export interface ValidProblemReport {
  readonly category: ProblemCategory;
  readonly description: string;
  readonly replyEmail: string | null;
  readonly pageUrl: string;
  readonly context: Record<string, string>;
  readonly personId: string | null;
  readonly requestIp: string | null;
  readonly screenshot: { readonly bytes: Uint8Array; readonly contentType: ScreenshotType } | null;
}

export type ProblemReportField = "description" | "replyEmail" | "screenshot" | "form";

export type ProblemReportValidation =
  | { readonly ok: true; readonly value: ValidProblemReport }
  | { readonly ok: false; readonly field: ProblemReportField; readonly message: string };

function isCategory(value: string): value is ProblemCategory {
  return (PROBLEM_CATEGORIES as readonly string[]).includes(value);
}

export function validateProblemReport(
  input: ProblemReportInput,
  baseUrl: string,
): ProblemReportValidation {
  const description = input.description.trim();
  if (description.length < 5) {
    return {
      ok: false,
      field: "description",
      message: "Tell us what happened — a sentence is plenty.",
    };
  }
  if (description.length > DESCRIPTION_LIMIT) {
    return {
      ok: false,
      field: "description",
      message: `Keep it under ${String(DESCRIPTION_LIMIT)} characters.`,
    };
  }

  const replyEmail = input.replyEmail.trim().toLowerCase();
  if (replyEmail !== "" && (!EMAIL_PATTERN.test(replyEmail) || replyEmail.length > 254)) {
    return { ok: false, field: "replyEmail", message: "That email address doesn't look right." };
  }

  // A tampered category is folded, not refused: the report is the thing of
  // value, and "other" loses nothing an operator needs.
  const category: ProblemCategory = isCategory(input.category) ? input.category : "other";

  // A page we cannot place is recorded as the site root rather than refused —
  // the description still says what went wrong.
  const pageUrl = redactPageUrl(input.pageUrl, baseUrl) ?? `${new URL(baseUrl).origin}/`;

  let screenshot: ValidProblemReport["screenshot"] = null;
  if (input.screenshot !== null && input.screenshot.length > 0) {
    if (input.screenshot.length > SCREENSHOT_MAX_BYTES) {
      return {
        ok: false,
        field: "screenshot",
        message: "That image is too large. Remove it, or attach one under 1 MB.",
      };
    }
    const contentType = sniffImageType(input.screenshot);
    if (contentType === null) {
      return {
        ok: false,
        field: "screenshot",
        message: "Attach a JPEG, PNG or WebP image, or remove the attachment.",
      };
    }
    screenshot = { bytes: input.screenshot, contentType };
  }

  return {
    ok: true,
    value: {
      category,
      description,
      replyEmail: replyEmail === "" ? null : replyEmail,
      pageUrl,
      context: sanitizeContext(input.context),
      personId: input.personId,
      requestIp: input.requestIp,
      screenshot,
    },
  };
}

/**
 * Has this person, or this connection, filed too many in the last hour?
 *
 * Like the demo throttle, the caller does NOT say so: the refusal renders as
 * the ordinary success. A throttle that announces itself tells a script
 * exactly how fast it may go.
 */
export async function isReportThrottled(
  db: Db,
  personId: string | null,
  requestIp: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - HOUR_MS);
  if (personId !== null) {
    const [byPerson] = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(problemReports)
      .where(and(eq(problemReports.personId, personId), gt(problemReports.createdAt, since)))) as [
      { count: number },
    ];
    if (byPerson.count >= MAX_PER_PERSON_PER_HOUR) {
      return true;
    }
  }
  if (requestIp === null) {
    return false;
  }
  const [byIp] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(problemReports)
    .where(and(eq(problemReports.requestIp, requestIp), gt(problemReports.createdAt, since)))) as [
    { count: number },
  ];
  return byIp.count >= MAX_PER_IP_PER_HOUR;
}

/** The report and its picture land together or not at all. */
export async function recordProblemReport(db: Db, report: ValidProblemReport): Promise<string> {
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(problemReports).values({
      id,
      personId: report.personId,
      replyEmail: report.replyEmail,
      category: report.category,
      description: report.description,
      pageUrl: report.pageUrl,
      context: report.context,
      requestIp: report.requestIp,
    });
    if (report.screenshot !== null) {
      await tx.insert(problemReportScreenshots).values({
        reportId: id,
        contentType: report.screenshot.contentType,
        bytes: Buffer.from(report.screenshot.bytes),
      });
    }
  });
  return id;
}
