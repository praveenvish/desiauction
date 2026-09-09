import { demoRequests, newId, type Db } from "@desiauction/db";
import { normalizePhone } from "@desiauction/core";
import { and, gt, eq, sql } from "drizzle-orm";

/**
 * THE REQUEST, VALIDATED AND RATE-LIMITED — everything except the IO.
 *
 * Separate from `actions.ts` so the rules are testable without a server action
 * harness, and so the throttle is one function rather than a paragraph inlined
 * in a form handler.
 *
 * NO RLS AND NO TENANT (migration 0031). The person filling this form has no
 * session; the write goes through the app pool exactly the way
 * `subscribeNewsletterAction` and the pre-session auth writes do.
 */

/** The bands the form offers. Kept in step with the CHECK in 0031. */
export const TOURNAMENT_SIZES = ["under-8", "8-16", "16-32", "over-32", "unsure"] as const;
export const PREFERRED_WINDOWS = [
  "weekday-evening",
  "weekend-morning",
  "weekend-evening",
  "any",
] as const;
export const DEMO_SOURCES = ["schedule-demo", "pricing", "landing", "help", "other"] as const;

/**
 * WHAT THEY ASKED FOR — the SP-1 gate's only instrument (migration 0045).
 *
 * NOT the sport registry, and it must never be wired to one. `core`'s registry
 * names the sports the platform can RUN, which is cricket and nothing else;
 * this list is what somebody came here WANTING, so it has to offer sports we
 * cannot run yet. Pointing it at the registry would show a single option and
 * measure nothing — and the measurement is the entire reason the column exists.
 *
 * Ordered by expected volume, not alphabetically, because the top of a select
 * is where an honest answer is cheapest to give.
 *
 * `other` is deliberately last and deliberately vague. It is a tail-catcher:
 * the form's note field is where an unlisted sport gets named, and its help
 * text says so.
 */
export const DEMO_SPORTS = [
  "cricket",
  /*
   * Underscored, unlike "table-tennis" beside it, because this one IS a pack
   * key (`box_cricket`) and a test holds every runnable sport to appearing
   * here. The hyphenated entries name sports we cannot run yet and answer to
   * nothing but this list.
   */
  "box_cricket",
  "football",
  "kabaddi",
  "volleyball",
  "badminton",
  "basketball",
  "hockey",
  "table_tennis",
  "pickleball",
  "esports",
  "other",
] as const;

export type TournamentSize = (typeof TOURNAMENT_SIZES)[number];
export type PreferredWindow = (typeof PREFERRED_WINDOWS)[number];
export type DemoSource = (typeof DEMO_SOURCES)[number];
export type DemoSport = (typeof DEMO_SPORTS)[number];

/**
 * Limits, in the shape `server/auth/otp.ts` set. Per-phone is the tight one
 * because a phone is the thing we would ring; per-IP is looser because a club
 * secretary and a treasurer on one office connection are not an attack.
 */
const MAX_PER_PHONE_PER_DAY = 3;
const MAX_PER_IP_PER_HOUR = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTE_LIMIT = 2000;
const NAME_LIMIT = 120;

export interface DemoRequestInput {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly orgName: string;
  readonly sport: string;
  readonly tournamentSize: string;
  readonly auctionOn: string | null;
  readonly preferredWindow: string;
  readonly note: string | null;
  readonly source: string;
  readonly requestIp: string | null;
}

export interface ValidDemoRequest {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly orgName: string;
  readonly sport: DemoSport;
  readonly tournamentSize: TournamentSize;
  readonly auctionOn: string | null;
  readonly preferredWindow: PreferredWindow;
  readonly note: string | null;
  readonly source: DemoSource;
  readonly requestIp: string | null;
}

export type ValidationField = "name" | "phone" | "email" | "orgName" | "auctionOn" | "form";

export type ValidationResult =
  | { readonly ok: true; readonly value: ValidDemoRequest }
  | { readonly ok: false; readonly field: ValidationField; readonly message: string };

function isMember<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

/**
 * The date arrives as an `<input type="date">` string. It is accepted only as
 * `YYYY-MM-DD` and only in the future — a demo for an auction that already
 * happened is a typo, and storing it would put a lie in the operator's queue.
 * A generous ceiling (three years) catches the fat-fingered century without
 * arguing with anyone planning a long way ahead.
 */
function validateAuctionDate(raw: string, today: Date): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  // Round-trips only for a real calendar date: 2026-02-31 parses and then
  // disagrees with itself.
  if (parsed.toISOString().slice(0, 10) !== raw) {
    return null;
  }
  const floor = new Date(today.toISOString().slice(0, 10));
  const ceiling = new Date(floor.getTime() + 3 * 365 * DAY_MS);
  if (parsed < floor || parsed > ceiling) {
    return null;
  }
  return raw;
}

/**
 * Shape and content, with no database in sight.
 *
 * `source` is validated against a closed list rather than trusted, because it
 * arrives in a hidden input on a public page and is echoed into the operator's
 * queue: an unvalidated attribution is an attacker-controlled string in an
 * admin surface.
 */
export function validateDemoRequest(
  input: DemoRequestInput,
  now: Date = new Date(),
): ValidationResult {
  const name = input.name.trim();
  if (name.length < 2 || name.length > NAME_LIMIT) {
    return { ok: false, field: "name", message: "Tell us your name." };
  }

  const normalized = normalizePhone(input.phone);
  if (!normalized.ok) {
    return {
      ok: false,
      field: "phone",
      message: "Enter a 10-digit Indian mobile number we can call you on.",
    };
  }

  const email = input.email === null ? "" : input.email.trim().toLowerCase();
  if (email !== "" && !EMAIL_PATTERN.test(email)) {
    return { ok: false, field: "email", message: "That email address doesn't look right." };
  }

  const orgName = input.orgName.trim();
  if (orgName.length < 2 || orgName.length > NAME_LIMIT) {
    return { ok: false, field: "orgName", message: "What's the tournament or club called?" };
  }

  /*
   * Refused rather than folded to `other`, which is how `source` is treated
   * three checks below — and the difference is the point. A bad `source` is an
   * attribution we can live without; a bad `sport` is the answer this column
   * exists to hold, and quietly recording "other" for a tampered value would
   * put noise into the one number the Phase 1 decision reads.
   */
  if (!isMember(DEMO_SPORTS, input.sport)) {
    return { ok: false, field: "form", message: "Pick the sport you run." };
  }
  if (!isMember(TOURNAMENT_SIZES, input.tournamentSize)) {
    return { ok: false, field: "form", message: "Pick a tournament size." };
  }
  if (!isMember(PREFERRED_WINDOWS, input.preferredWindow)) {
    return { ok: false, field: "form", message: "Pick a time that usually suits you." };
  }

  const rawDate = input.auctionOn === null ? "" : input.auctionOn.trim();
  let auctionOn: string | null = null;
  if (rawDate !== "") {
    auctionOn = validateAuctionDate(rawDate, now);
    if (auctionOn === null) {
      return {
        ok: false,
        field: "auctionOn",
        message: "Use a date in the future, or leave it blank if you don't know yet.",
      };
    }
  }

  const note = input.note === null ? "" : input.note.trim().slice(0, NOTE_LIMIT);

  // Anything unrecognised is recorded as 'other' rather than refused: a bad
  // attribution must never cost us the lead.
  const source: DemoSource = isMember(DEMO_SOURCES, input.source) ? input.source : "other";

  return {
    ok: true,
    value: {
      name,
      phone: normalized.phone,
      email: email === "" ? null : email,
      orgName,
      sport: input.sport,
      tournamentSize: input.tournamentSize,
      auctionOn,
      preferredWindow: input.preferredWindow,
      note: note === "" ? null : note,
      source,
      requestIp: input.requestIp,
    },
  };
}

/**
 * Has this phone, or this connection, asked too often?
 *
 * The caller does NOT tell the person when this is true. A throttle that
 * announces itself is an oracle: "already asked" distinguishes a phone that has
 * requested a demo from one that has not, to anybody willing to type numbers.
 * The refusal renders as the ordinary success screen, exactly as
 * `requestOtp`'s uniform-response rule requires.
 */
export async function isThrottled(
  db: Db,
  phone: string,
  requestIp: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const [byPhone] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(demoRequests)
    .where(
      and(
        eq(demoRequests.phone, phone),
        gt(demoRequests.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    )) as [{ count: number }];
  if (byPhone.count >= MAX_PER_PHONE_PER_DAY) {
    return true;
  }

  if (requestIp === null) {
    return false;
  }
  const [byIp] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(demoRequests)
    .where(
      and(
        eq(demoRequests.requestIp, requestIp),
        gt(demoRequests.createdAt, new Date(now.getTime() - HOUR_MS)),
      ),
    )) as [{ count: number }];
  return byIp.count >= MAX_PER_IP_PER_HOUR;
}

/** The insert, and the id it produced — the booking flow needs that id. */
export async function recordDemoRequest(db: Db, request: ValidDemoRequest): Promise<string> {
  const id = newId();
  await db.insert(demoRequests).values({
    id,
    name: request.name,
    phone: request.phone,
    email: request.email,
    orgName: request.orgName,
    sport: request.sport,
    tournamentSize: request.tournamentSize,
    auctionOn: request.auctionOn,
    preferredWindow: request.preferredWindow,
    note: request.note,
    source: request.source,
    requestIp: request.requestIp,
  });
  return id;
}
