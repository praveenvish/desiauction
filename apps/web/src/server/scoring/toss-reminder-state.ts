import { createHash } from "node:crypto";
import { sportPack } from "@desiauction/core";
import { replayMatch } from "@desiauction/core/scoring";
import { persistedMatchEvent } from "./persisted-event";
import {
  auditLog,
  competitions,
  fixtures,
  matches,
  matchEvents,
  people,
  pushSubscriptions,
  type Db,
} from "@desiauction/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
export async function effectiveToss(db: Db, fixtureId: string, orgId: string, attempt: number) {
  const [season] = await db
    .select({ sport: competitions.sport })
    .from(matches)
    .innerJoin(
      competitions,
      and(eq(competitions.id, matches.competitionId), eq(competitions.orgId, matches.orgId)),
    )
    .where(and(eq(matches.fixtureId, fixtureId), eq(matches.orgId, orgId)));
  if (!season || sportPack(season.sport)?.scoring?.family !== "delivery") return false;
  const events = await db
    .select()
    .from(matchEvents)
    .where(
      and(
        eq(matchEvents.fixtureId, fixtureId),
        eq(matchEvents.orgId, orgId),
        eq(matchEvents.attempt, attempt),
      ),
    )
    .orderBy(asc(matchEvents.seq));
  return replayMatch(events.map(persistedMatchEvent)).toss !== null;
}
export const TOSS_EMAIL_CONSENT = "Email me once when the toss has happened.";
export const TOSS_PUSH_CONSENT = "Notify this browser once when the toss has happened.";
export const TOSS_CONSENT_VERSION = "ls1-toss-v1";
export const REQUEST_ACTION = "match.toss_reminder.requested";
export const CANCEL_ACTION = "match.toss_reminder.cancelled";
export interface ReminderRequest {
  personId: string;
  fixtureId: string;
  orgId: string;
  attempt: number;
  channel: "push" | "email";
  consent: string;
  consentVersion: string;
  access: "public" | "share";
  tokenDigest?: string;
}
export const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");
export function reminderMeta(raw: unknown): ReminderRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    ["personId", "fixtureId", "orgId", "consent", "consentVersion"].some(
      (key) => typeof value[key] !== "string",
    ) ||
    !Number.isSafeInteger(value["attempt"]) ||
    Number(value["attempt"]) < 1 ||
    !["push", "email"].includes(String(value["channel"])) ||
    !["public", "share"].includes(String(value["access"])) ||
    (value["access"] === "share" &&
      (typeof value["tokenDigest"] !== "string" || !/^[a-f0-9]{64}$/.test(value["tokenDigest"])))
  )
    return null;
  return value as unknown as ReminderRequest;
}
export async function latestReminder(db: Db, fixtureId: string, orgId: string, personId: string) {
  const [row] = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.scopeType, "org"),
        eq(auditLog.scopeId, orgId),
        eq(auditLog.subject, fixtureId),
        eq(auditLog.actor, personId),
        inArray(auditLog.action, [REQUEST_ACTION, CANCEL_ACTION]),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(1);
  return row ?? null;
}
/** Shared by dispatcher/outbox; no imports of delivery or enqueue modules. */
export async function eligibleTossReminder(
  db: Db,
  requestId: string,
  personId: string,
  orgId: string,
  channel: "email" | "push",
  delivery = true,
) {
  const [request] = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.id, requestId),
        eq(auditLog.action, REQUEST_ACTION),
        eq(auditLog.actor, personId),
        eq(auditLog.scopeType, "org"),
        eq(auditLog.scopeId, orgId),
      ),
    )
    .limit(1);
  const meta = reminderMeta(request?.meta);
  if (
    !request ||
    !meta ||
    meta.personId !== personId ||
    meta.orgId !== orgId ||
    meta.fixtureId !== request.subject ||
    meta.channel !== channel ||
    meta.consentVersion !== TOSS_CONSENT_VERSION ||
    meta.consent !== (channel === "email" ? TOSS_EMAIL_CONSENT : TOSS_PUSH_CONSENT)
  )
    return null;
  if ((await latestReminder(db, meta.fixtureId, orgId, personId))?.id !== requestId) return null;
  const [fixture] = await db
    .select({
      id: fixtures.id,
      status: fixtures.status,
      competitionId: fixtures.competitionId,
      slug: competitions.slug,
      visibility: competitions.visibility,
      token: matches.shareToken,
      attempt: matches.attempt,
      phase: matches.phase,
    })
    .from(fixtures)
    .innerJoin(
      competitions,
      and(eq(competitions.id, fixtures.competitionId), eq(competitions.orgId, fixtures.orgId)),
    )
    .innerJoin(
      matches,
      and(
        eq(matches.fixtureId, fixtures.id),
        eq(matches.orgId, fixtures.orgId),
        eq(matches.competitionId, fixtures.competitionId),
      ),
    )
    .where(and(eq(fixtures.id, meta.fixtureId), eq(fixtures.orgId, orgId)))
    .limit(1);
  if (!fixture || fixture.attempt !== meta.attempt || fixture.phase === "void") return null;
  const allowed =
    meta.access === "public"
      ? fixture.visibility === "public" &&
        ["published", "in_progress", "completed"].includes(fixture.status)
      : tokenDigest(fixture.token) === meta.tokenDigest;
  if (!allowed) return null;
  if (!(await effectiveToss(db, meta.fixtureId, orgId, meta.attempt))) return null;
  const [person] = await db
    .select({ email: people.email, verified: people.emailVerifiedAt })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  if (delivery && channel === "email" && (!person?.email || !person.verified)) return null;
  if (
    delivery &&
    channel === "push" &&
    !(
      await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.personId, personId))
        .limit(1)
    ).length
  )
    return null;
  return {
    requestId,
    meta,
    url:
      meta.access === "public"
        ? `/c/${fixture.slug}/m/${encodeURIComponent((await db.select({ number: fixtures.fixtureNumber }).from(fixtures).where(eq(fixtures.id, meta.fixtureId)).limit(1))[0]?.number ?? "")}`
        : `/m/${fixture.token}`,
  };
}
export function tossRequestId(dedupeKey: string): string | null {
  const match = /^match\.toss_reminder:([0-9A-HJKMNP-TV-Z]{26})$/.exec(dedupeKey);
  return match?.[1] ?? null;
}
