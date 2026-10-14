import { reminderBoundaries, type ReminderBoundaries } from "./reminder-boundaries";
import {
  auditLog,
  competitions,
  fixtures,
  matches,
  newId,
  people,
  pushSubscriptions,
} from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import type { PublicAccessProof, PublicViewerIdentity } from "./public";
import { publicReminderIdentity } from "./public-page";
import {
  CANCEL_ACTION,
  REQUEST_ACTION,
  latestReminder,
  reminderMeta,
  tokenDigest,
  TOSS_CONSENT_VERSION,
  TOSS_EMAIL_CONSENT,
  TOSS_PUSH_CONSENT,
  effectiveToss,
} from "./toss-reminder-state";
import { notificationGate } from "../messaging/gate";
export async function requestTossReminder(
  identity: PublicViewerIdentity,
  personId: string,
  proof: PublicAccessProof,
  channel: "push" | "email",
  consent: boolean,
  now = new Date(),
  boundaries: ReminderBoundaries = reminderBoundaries,
) {
  return boundaries.inOrg(personId, identity.orgId, async (db) => {
    const [fixture] = await db
      .select()
      .from(fixtures)
      .where(and(eq(fixtures.id, identity.fixtureId), eq(fixtures.orgId, identity.orgId)))
      .for("update");
    if (!fixture || !(await publicReminderIdentity(fixture.id, proof, db)))
      return { ok: false as const, error: "not_found" as const };
    const [match] = await db
      .select({ attempt: matches.attempt, token: matches.shareToken })
      .from(matches)
      .where(eq(matches.fixtureId, fixture.id))
      .limit(1);
    const attempt = match?.attempt ?? 1;
    if (await effectiveToss(db, fixture.id, identity.orgId, attempt))
      return { ok: false as const, error: "already_tossed" as const };
    const [person] = await db
      .select({ email: people.email, verified: people.emailVerifiedAt })
      .from(people)
      .where(eq(people.id, personId))
      .limit(1);
    if (!consent || !person) return { ok: false as const, error: "consent_required" as const };
    if (channel === "email" && (!person.email || !person.verified))
      return { ok: false as const, error: "verified_email_required" as const };
    if (
      channel === "push" &&
      !(
        await db
          .select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.personId, personId))
          .limit(1)
      ).length
    )
      return { ok: false as const, error: "device_required" as const };
    if (
      !(
        await notificationGate(db, {
          kind: "match.toss_reminder",
          channel: channel === "email" ? "email" : "in_app",
          recipient: { personId, contact: channel === "email" ? (person.email ?? "") : "" },
          orgId: identity.orgId,
          now,
        })
      ).send
    )
      return { ok: false as const, error: "notifications_off" as const };
    const [season] = await db
      .select({ visibility: competitions.visibility })
      .from(competitions)
      .where(eq(competitions.id, fixture.competitionId))
      .limit(1);
    const access =
      season?.visibility === "public" &&
      ["published", "in_progress", "completed"].includes(fixture.status)
        ? ("public" as const)
        : ("share" as const);
    const digest = access === "share" && proof.t ? tokenDigest(proof.t) : undefined;
    if (access === "share" && !digest) return { ok: false as const, error: "not_found" as const };
    const previous = await latestReminder(db, fixture.id, identity.orgId, personId);
    const old = reminderMeta(previous?.meta);
    if (
      previous?.action === REQUEST_ACTION &&
      old?.attempt === attempt &&
      old.channel === channel &&
      old.access === access &&
      old.tokenDigest === digest
    )
      return { ok: true as const, requestId: previous.id };
    const requestId = newId();
    await db.insert(auditLog).values({
      id: requestId,
      actor: personId,
      action: REQUEST_ACTION,
      scopeType: "org",
      scopeId: identity.orgId,
      subject: fixture.id,
      at: now,
      meta: {
        personId,
        fixtureId: fixture.id,
        orgId: identity.orgId,
        attempt,
        channel,
        consent: channel === "email" ? TOSS_EMAIL_CONSENT : TOSS_PUSH_CONSENT,
        consentVersion: TOSS_CONSENT_VERSION,
        access,
        ...(digest ? { tokenDigest: digest } : {}),
      },
    });
    return { ok: true as const, requestId };
  });
}
export async function cancelTossReminder(
  identity: PublicViewerIdentity,
  personId: string,
  now = new Date(),
  boundaries: ReminderBoundaries = reminderBoundaries,
) {
  return boundaries.inOrg(personId, identity.orgId, async (db) => {
    const [fixture] = await db
      .select({ id: fixtures.id })
      .from(fixtures)
      .where(and(eq(fixtures.id, identity.fixtureId), eq(fixtures.orgId, identity.orgId)))
      .for("update");
    if (!fixture) return false;
    const previous = await latestReminder(db, fixture.id, identity.orgId, personId);
    if (!previous || previous.action === CANCEL_ACTION) return true;
    await db.insert(auditLog).values({
      id: newId(),
      actor: personId,
      action: CANCEL_ACTION,
      scopeType: "org",
      scopeId: identity.orgId,
      subject: fixture.id,
      at: now,
      meta: { requestId: previous.id },
    });
    return true;
  });
}
