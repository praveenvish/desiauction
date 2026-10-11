import { reminderBoundaries, type ReminderBoundaries } from "./reminder-boundaries";
import { auditLog, fixtures, newId, people } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { env } from "../../env";
import { logger } from "../logger";
import { notificationGate } from "../messaging/gate";
import { renderNotificationEmail } from "../messaging/notification-email";
import { enqueueMail } from "../messaging/outbox";
import { pushInboxNotice } from "../messaging/push";
import { eligibleTossReminder, reminderMeta, REQUEST_ACTION } from "./toss-reminder-state";
import { SCORING_SYSTEM_ACTOR } from "./system-actor";

/** Request-id dedupe and notice/email enqueue commit together under the fixture lock. */
export async function dispatchTossReminders(
  orgId: string,
  fixtureId: string,
  options: { now?: Date; push?: typeof pushInboxNotice; boundaries?: ReminderBoundaries } = {},
) {
  const boundaries = options.boundaries ?? reminderBoundaries;
  const now = options.now ?? new Date();
  const requests = await boundaries.inOrg(SCORING_SYSTEM_ACTOR, orgId, (db) =>
    db
      .select({ id: auditLog.id, actor: auditLog.actor, meta: auditLog.meta })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, REQUEST_ACTION),
          eq(auditLog.scopeType, "org"),
          eq(auditLog.scopeId, orgId),
          eq(auditLog.subject, fixtureId),
        ),
      ),
  );
  let queued = 0;
  for (const request of requests) {
    const meta = reminderMeta(request.meta);
    if (
      !meta ||
      request.actor !== meta.personId ||
      meta.orgId !== orgId ||
      meta.fixtureId !== fixtureId
    )
      continue;
    const personId = meta.personId;
    const created = await boundaries.inOrg(personId, orgId, async (db) => {
      await db
        .select({ id: fixtures.id })
        .from(fixtures)
        .where(and(eq(fixtures.id, fixtureId), eq(fixtures.orgId, orgId)))
        .for("update");
      if (!(await eligibleTossReminder(db, request.id, personId, orgId, meta.channel)))
        return false;
      const [existing] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "match.toss_reminder"),
            eq(auditLog.scopeType, "person"),
            eq(auditLog.scopeId, personId),
            eq(auditLog.subject, request.id),
          ),
        )
        .limit(1);
      if (existing) return false;
      const [person] = await db
        .select({ email: people.email, language: people.language })
        .from(people)
        .where(eq(people.id, personId))
        .limit(1);
      const channel = meta.channel === "email" ? ("email" as const) : ("in_app" as const);
      const decision = await notificationGate(db, {
        kind: "match.toss_reminder",
        channel,
        recipient: { personId, contact: person?.email ?? "" },
        orgId,
        now,
      });
      if (!decision.send) return false;
      await db.insert(auditLog).values({
        id: newId(),
        actor: personId,
        scopeType: "person",
        scopeId: personId,
        subject: request.id,
        action: "match.toss_reminder",
        meta: { requestId: request.id },
        at: now,
      });
      if (meta.channel === "email") {
        const mail = await renderNotificationEmail(
          "match.toss_reminder",
          person?.language === "hi" ? "hi" : "en",
          {},
          {
            action: {
              id: "match",
              url: new URL(`/inbox?reminder=${request.id}`, env.PUBLIC_BASE_URL).href,
            },
          },
          db,
        );
        await enqueueMail(
          [
            {
              ...mail,
              kind: "match.toss_reminder",
              personId,
              orgId,
              dedupeKey: `match.toss_reminder:${request.id}`,
            },
          ],
          db,
        );
      }
      return true;
    });
    if (!created) continue;
    queued += 1;
    if (meta.channel === "push") {
      const stillEligible = await boundaries.inOrg(
        personId,
        orgId,
        async (db) =>
          (await eligibleTossReminder(db, request.id, personId, orgId, "push")) !== null &&
          (
            await notificationGate(db, {
              kind: "match.toss_reminder",
              channel: "in_app",
              recipient: { personId, contact: "" },
              orgId,
              now: new Date(),
            })
          ).send,
      );
      if (stillEligible) {
        try {
          await (options.push ?? pushInboxNotice)(personId, "match.toss_reminder", {
            requestId: request.id,
          });
        } catch (error) {
          logger().warn({ err: error, requestId: request.id }, "scoring.toss_push_failed");
        }
      }
    }
  }
  return queued;
}

/** Accepted scoring must stay accepted if delivery is temporarily unavailable. */
export async function recoverableTossDispatch(
  orgId: string,
  fixtureId: string,
  boundaries: ReminderBoundaries = reminderBoundaries,
) {
  try {
    await dispatchTossReminders(orgId, fixtureId, { boundaries });
  } catch (error) {
    logger().warn({ err: error, fixtureId }, "scoring.toss_reminder_deferred");
  }
}
