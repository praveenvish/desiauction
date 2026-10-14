import { noticeParticipants } from "./notice-participants";
import { isPlacementState, replayScoringState } from "./family-state";
import { persistedMatchEvent } from "./persisted-event";
import { historicalAuthority, trustEvidence } from "./trust-ledger";
import { eligibleConfirmationNotice } from "./confirmation-notice-state";
import {
  auditLog,
  competitions,
  matches,
  fixtures,
  matchEvents,
  teamManagers,
  registrations,
  people,
  matchAwards,
  newId,
  type Db,
} from "@desiauction/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { env } from "../../env";
import { notificationGate } from "../messaging/gate";
import { renderNotificationEmail } from "../messaging/notification-email";
import { enqueueMail, enqueueWhatsApp, kickDrain } from "../messaging/outbox";
import { logger } from "../logger";
import { reminderBoundaries, type ReminderBoundaries } from "./reminder-boundaries";
import { eligibleMatchNotice, type MatchNoticeAddress } from "./result-notice-state";
import { SCORING_SYSTEM_ACTOR } from "./system-actor";

/** Committed finalization is recoverable; inbox and permitted queues are atomic and match-serialized. */
export async function dispatchResultNotices(
  orgId: string,
  fixtureId: string,
  boundaries: ReminderBoundaries = reminderBoundaries,
  now = new Date(),
) {
  const audience = await boundaries.inOrg(SCORING_SYSTEM_ACTOR, orgId, async (db) => {
    const [match] = await db
      .select()
      .from(matches)
      .where(and(eq(matches.fixtureId, fixtureId), eq(matches.orgId, orgId)))
      .for("update");
    if (!match?.finishedAt || match.phase === "void") return null;
    const [season] = await db
      .select({ name: competitions.name })
      .from(competitions)
      .where(and(eq(competitions.id, match.competitionId), eq(competitions.orgId, orgId)));
    if (!season) return null;
    const participants = await noticeParticipants(db, fixtureId, orgId, match.competitionId);
    const recipients = [...new Set(participants.map((row) => row.personId))];
    const addresses: MatchNoticeAddress[] = recipients.map((personId) => ({
      fixtureId,
      personId,
      kind: "match.result",
    }));
    const awards = await db
      .select()
      .from(matchAwards)
      .where(
        and(
          eq(matchAwards.fixtureId, fixtureId),
          eq(matchAwards.scope, "match"),
          eq(matchAwards.orgId, orgId),
          eq(matchAwards.competitionId, match.competitionId),
        ),
      )
      .orderBy(desc(matchAwards.createdAt), desc(matchAwards.id));
    for (const awardKind of ["player_of_match", "fighter_of_match", "top_fragger"] as const) {
      const pick = awards.find((row) => row.kind === awardKind);
      const winner = participants.find((row) => row.registrationId === pick?.winnerRegistrationId);
      if (winner)
        addresses.push({ fixtureId, personId: winner.personId, kind: "match.award", awardKind });
    }
    const revisions = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeType, "org"),
          eq(auditLog.scopeId, orgId),
          eq(auditLog.subject, fixtureId),
          inArray(auditLog.action, ["match.finalized", "match.award.overridden"]),
        ),
      );
    return { addresses, season, revisions };
  });
  if (!audience) return 0;
  let queued = 0;
  for (const address of audience.addresses) {
    const created = await boundaries.inOrg(address.personId, orgId, async (db) => {
      await db
        .select({ id: matches.fixtureId })
        .from(matches)
        .where(and(eq(matches.fixtureId, fixtureId), eq(matches.orgId, orgId)))
        .for("update");
      if (!(await eligibleMatchNotice(db, orgId, address))) return false;
      const key =
        address.kind === "match.result"
          ? `match.result:${fixtureId}:${address.personId}`
          : `match.award:${fixtureId}:${address.awardKind ?? ""}:${address.personId}`;
      const action = address.kind === "match.result" ? "match.result_published" : "match.award_won";
      const [already] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            inArray(auditLog.action, [action, "match.notice_dispatched"]),
            eq(auditLog.scopeType, "person"),
            eq(auditLog.scopeId, address.personId),
            eq(auditLog.subject, key),
          ),
        )
        .limit(1);
      if (already) return false;
      const [person] = await db
        .select({ email: people.email, phone: people.phone, language: people.language })
        .from(people)
        .where(eq(people.id, address.personId));
      const noticeId = newId();
      const inbox = await notificationGate(db, {
        kind: address.kind,
        channel: "in_app",
        recipient: { personId: address.personId, contact: "" },
        orgId,
        now,
      });
      await db.insert(auditLog).values({
        id: noticeId,
        actor: address.personId,
        action: inbox.send ? action : "match.notice_dispatched",
        scopeType: "person",
        scopeId: address.personId,
        subject: key,
        meta: {
          orgId,
          fixtureId,
          noticeId,
          kind: address.kind,
          ...(address.awardKind ? { awardKind: address.awardKind } : {}),
        },
        at: now,
      });
      const email = await notificationGate(db, {
        kind: address.kind,
        channel: "email",
        recipient: { personId: address.personId, contact: person?.email ?? "" },
        orgId,
        now,
      });
      if (email.send && person?.email) {
        const mail = await renderNotificationEmail(
          address.kind,
          person.language === "hi" ? "hi" : "en",
          {},
          {
            action: {
              id: "match",
              url: new URL(`/inbox?matchNotice=${noticeId}`, env.PUBLIC_BASE_URL).href,
            },
          },
          db,
        );
        await enqueueMail(
          [
            {
              ...mail,
              kind: address.kind,
              personId: address.personId,
              orgId,
              dedupeKey: `email:${key}`,
            },
          ],
          db,
        );
      }
      if (address.kind === "match.award") {
        const whatsapp = await notificationGate(db, {
          kind: address.kind,
          channel: "whatsapp",
          recipient: { personId: address.personId, contact: person?.phone ?? "" },
          orgId,
          now,
        });
        if (whatsapp.send && person?.phone)
          await enqueueWhatsApp(
            [
              {
                kind: "match.award",
                personId: address.personId,
                orgId,
                dedupeKey: key,
                slots: { competition: audience.season.name },
              },
            ],
            db,
          );
      }
      return true;
    });
    if (created) queued++;
  }
  await boundaries.inOrg(SCORING_SYSTEM_ACTOR, orgId, async (db) => {
    await db
      .select({ id: matches.fixtureId })
      .from(matches)
      .where(eq(matches.fixtureId, fixtureId))
      .for("update");
    for (const revision of audience.revisions) {
      const [existing] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "match.notices_dispatched"),
            eq(auditLog.scopeType, "org"),
            eq(auditLog.scopeId, orgId),
            eq(auditLog.subject, revision.id),
          ),
        )
        .limit(1);
      if (!existing)
        await db.insert(auditLog).values({
          id: newId(),
          actor: SCORING_SYSTEM_ACTOR,
          action: "match.notices_dispatched",
          scopeType: "org",
          scopeId: orgId,
          subject: revision.id,
          meta: { fixtureId },
          at: now,
        });
    }
  });
  if (queued) kickDrain();
  return queued;
}
/** Bounded identity-only discovery; every recipient/winner is resolved again inside tenant boundaries. */
export async function recoverResultNotices(
  readDb: import("@desiauction/db").Db,
  boundaries: ReminderBoundaries,
  fixtureIds?: readonly string[],
) {
  const revisions = await readDb
    .select({ orgId: auditLog.scopeId, fixtureId: auditLog.subject })
    .from(auditLog)
    .innerJoin(
      matches,
      and(eq(matches.fixtureId, auditLog.subject), eq(matches.orgId, auditLog.scopeId)),
    )
    .where(
      and(
        sql`${matches.phase} <> 'void' and ${matches.finishedAt} is not null`,
        eq(auditLog.scopeType, "org"),
        inArray(auditLog.action, ["match.finalized", "match.award.overridden"]),
        sql`not exists (select 1 from audit_log receipt where receipt.action = 'match.notices_dispatched' and receipt.scope_type = 'org' and receipt.scope_id = ${auditLog.scopeId} and receipt.subject = ${auditLog.id})`,
        ...(fixtureIds ? [inArray(auditLog.subject, [...fixtureIds])] : []),
      ),
    )
    .orderBy(auditLog.at)
    .limit(100);
  const seen = new Set<string>();
  for (const revision of revisions) {
    if (!revision.fixtureId || seen.has(revision.fixtureId)) continue;
    seen.add(revision.fixtureId);
    await recoverableResultDispatch(revision.orgId, revision.fixtureId, boundaries);
  }
}
export async function recoverableResultDispatch(
  orgId: string,
  fixtureId: string,
  boundaries: ReminderBoundaries = reminderBoundaries,
) {
  try {
    const queued = await dispatchResultNotices(orgId, fixtureId, boundaries);
    await dispatchConfirmationNotices(orgId, fixtureId, boundaries);
    return queued;
  } catch (error) {
    logger().warn({ err: error, fixtureId }, "scoring.result_notices_deferred");
    return 0;
  }
}

export async function dispatchConfirmationNotices(
  orgId: string,
  fixtureId: string,
  boundaries: ReminderBoundaries = reminderBoundaries,
  now = new Date(),
) {
  const audience = await boundaries.inOrg(SCORING_SYSTEM_ACTOR, orgId, async (db) => {
    const [match] = await db
      .select()
      .from(matches)
      .where(and(eq(matches.fixtureId, fixtureId), eq(matches.orgId, orgId)))
      .for("update");
    if (!match?.finishedAt || match.phase === "void") return [];
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!fixture) return [];
    const rows = await db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, fixtureId))
      .orderBy(matchEvents.seq);
    const [season] = await db
      .select({ sport: competitions.sport })
      .from(competitions)
      .where(and(eq(competitions.id, match.competitionId), eq(competitions.orgId, orgId)));
    if (!season) return [];
    let state;
    try {
      state = replayScoringState(season.sport, rows.map(persistedMatchEvent));
    } catch {
      return [];
    }
    if (!state.finished || state.attempt !== match.attempt || state.lastSeq !== match.lastSeq)
      return [];
    const authority = historicalAuthority(await trustEvidence(db, fixture), state.eventHistory);
    const teamId =
      authority.representedTeamId === fixture.homeTeamId
        ? fixture.awayTeamId
        : authority.representedTeamId === fixture.awayTeamId
          ? fixture.homeTeamId
          : null;
    const opponentIds = isPlacementState(state)
      ? state.teamIds.filter((id) => id !== authority.representedTeamId)
      : teamId
        ? [teamId]
        : [];
    if (
      !authority.complete ||
      !authority.authority.d ||
      !authority.representedTeamId ||
      !opponentIds.length
    )
      return [];
    const managers = await db
      .select({ personId: teamManagers.personId, teamId: teamManagers.teamId })
      .from(teamManagers)
      .where(
        and(
          eq(teamManagers.orgId, orgId),
          eq(teamManagers.competitionId, match.competitionId),
          inArray(teamManagers.teamId, opponentIds),
          isNull(teamManagers.revokedAt),
        ),
      );
    return managers
      .filter(
        (row, index) =>
          managers.findIndex(
            (other) => other.personId === row.personId && other.teamId === row.teamId,
          ) === index,
      )
      .map(({ personId, teamId }) => ({
        fixtureId,
        attempt: match.attempt,
        lastSeq: match.lastSeq,
        teamId,
        personId,
      }));
  });
  let queued = 0;
  for (const address of audience) {
    const created = await boundaries.inOrg(address.personId, orgId, async (db) => {
      const context = await eligibleConfirmationNotice(db, address, now);
      if (!context) return false;
      const key = `match.confirm_request:${fixtureId}:${String(address.attempt)}:${String(address.lastSeq)}:${address.teamId}:${address.personId}`;
      const [existing] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.scopeType, "person"),
            eq(auditLog.scopeId, address.personId),
            eq(auditLog.subject, key),
          ),
        );
      if (existing) return false;
      const [person] = await db
        .select({ email: people.email, language: people.language })
        .from(people)
        .where(eq(people.id, address.personId));
      const inbox = await notificationGate(db, {
        kind: "match.confirm_request",
        channel: "in_app",
        recipient: { personId: address.personId, contact: "" },
        orgId,
        now,
      });
      const noticeId = newId();
      await db.insert(auditLog).values({
        id: noticeId,
        actor: address.personId,
        action: inbox.send ? "match.confirm_requested" : "match.confirm_notice_dispatched",
        scopeType: "person",
        scopeId: address.personId,
        subject: key,
        meta: { orgId, fixtureId, noticeId, competitionId: context.fixture.competitionId },
        at: now,
      });
      const email = await notificationGate(db, {
        kind: "match.confirm_request",
        channel: "email",
        recipient: { personId: address.personId, contact: person?.email ?? "" },
        orgId,
        now,
      });
      if (email.send && person?.email) {
        const mail = await renderNotificationEmail(
          "match.confirm_request",
          person.language === "hi" ? "hi" : "en",
          {},
          {
            action: {
              id: "match",
              url: new URL(`/inbox?confirmation=${noticeId}`, env.PUBLIC_BASE_URL).href,
            },
          },
          db,
        );
        await enqueueMail(
          [
            {
              ...mail,
              kind: "match.confirm_request",
              personId: address.personId,
              orgId,
              dedupeKey: `email:${key}`,
            },
          ],
          db,
        );
      }
      return true;
    });
    if (created) queued += 1;
  }
  if (queued) kickDrain();
  return queued;
}

/** The caller has atomically attached the exact guest registration to this person. */
async function notifyGuestClaim(
  db: Db,
  input: { orgId: string; registrationId: string; personId: string },
  now = new Date(),
) {
  const [registration] = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(
        eq(registrations.id, input.registrationId),
        eq(registrations.orgId, input.orgId),
        eq(registrations.personId, input.personId),
      ),
    )
    .for("update");
  if (!registration) return false;
  const key = `player.claim_invite:${input.registrationId}:${input.personId}`;
  const [existing] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.scopeType, "person"),
        eq(auditLog.scopeId, input.personId),
        eq(auditLog.subject, key),
      ),
    );
  if (existing) return false;
  const [person] = await db
    .select({ email: people.email, language: people.language })
    .from(people)
    .where(eq(people.id, input.personId));
  const inbox = await notificationGate(db, {
    kind: "player.claim_invite",
    channel: "in_app",
    recipient: { personId: input.personId, contact: "" },
    orgId: input.orgId,
    now,
  });
  await db.insert(auditLog).values({
    id: newId(),
    actor: input.personId,
    action: inbox.send ? "player.claim_invited" : "player.claim_notice_dispatched",
    scopeType: "person",
    scopeId: input.personId,
    subject: key,
    meta: { orgId: input.orgId, registrationId: input.registrationId },
    at: now,
  });
  const email = await notificationGate(db, {
    kind: "player.claim_invite",
    channel: "email",
    recipient: { personId: input.personId, contact: person?.email ?? "" },
    orgId: input.orgId,
    now,
  });
  if (email.send && person?.email) {
    const mail = await renderNotificationEmail(
      "player.claim_invite",
      person.language === "hi" ? "hi" : "en",
      {},
      { action: { id: "career", url: new URL("/me/cricket", env.PUBLIC_BASE_URL).href } },
      db,
    );
    await enqueueMail(
      [
        {
          ...mail,
          kind: "player.claim_invite",
          personId: input.personId,
          orgId: input.orgId,
          dedupeKey: `email:${key}`,
        },
      ],
      db,
    );
  }
  return true;
}

/**
 * An account holder is offered a guest registration a scorer tied to their
 * number (F09). The registration has NOT moved; the notice opens /me/claims,
 * where they accept or say it is not them.
 */
async function notifyGuestClaimOffer(
  db: Db,
  input: { orgId: string; registrationId: string; personId: string; offerId: string },
  now = new Date(),
) {
  const key = `player.claim_offer:${input.offerId}:${input.personId}`;
  const [existing] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.scopeType, "person"),
        eq(auditLog.scopeId, input.personId),
        eq(auditLog.subject, key),
      ),
    );
  if (existing) return false;
  const [person] = await db
    .select({ email: people.email, language: people.language })
    .from(people)
    .where(eq(people.id, input.personId));
  const inbox = await notificationGate(db, {
    kind: "player.claim_offer",
    channel: "in_app",
    recipient: { personId: input.personId, contact: "" },
    orgId: input.orgId,
    now,
  });
  // Written either way: /me/claims finds open offers through this row, so a
  // muted inbox still leaves the offer answerable.
  await db.insert(auditLog).values({
    id: newId(),
    actor: input.personId,
    action: inbox.send ? "player.claim_offered" : "player.claim_offer_dispatched",
    scopeType: "person",
    scopeId: input.personId,
    subject: key,
    meta: { orgId: input.orgId, registrationId: input.registrationId, offerId: input.offerId },
    at: now,
  });
  const email = await notificationGate(db, {
    kind: "player.claim_offer",
    channel: "email",
    recipient: { personId: input.personId, contact: person?.email ?? "" },
    orgId: input.orgId,
    now,
  });
  if (email.send && person?.email) {
    const mail = await renderNotificationEmail(
      "player.claim_offer",
      person.language === "hi" ? "hi" : "en",
      {},
      { action: { id: "claims", url: new URL("/me/claims", env.PUBLIC_BASE_URL).href } },
      db,
    );
    await enqueueMail(
      [
        {
          ...mail,
          kind: "player.claim_offer",
          personId: input.personId,
          orgId: input.orgId,
          dedupeKey: `email:${key}`,
        },
      ],
      db,
    );
  }
  return true;
}

/** A claim that attached, and one that became an offer: both owe a notice. */
const GUEST_CLAIM_ANCHORS = ["registration.guest_claimed", "registration.guest_claim_offered"];

export async function recoverableGuestClaimDispatch(
  orgId: string,
  registrationId: string,
  boundaries: ReminderBoundaries = reminderBoundaries,
  now = new Date(),
) {
  try {
    const anchors = await boundaries.inOrg(SCORING_SYSTEM_ACTOR, orgId, (db) =>
      db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.scopeType, "org"),
            eq(auditLog.scopeId, orgId),
            eq(auditLog.subject, registrationId),
            inArray(auditLog.action, GUEST_CLAIM_ANCHORS),
            sql`not exists (select 1 from audit_log receipt where receipt.action = 'registration.guest_claim_notice_dispatched' and receipt.scope_type = 'org' and receipt.scope_id = ${auditLog.scopeId} and receipt.subject = ${auditLog.id})`,
          ),
        ),
    );
    for (const anchor of anchors) {
      const meta = anchor.meta as { personId?: unknown } | null;
      const personId = meta?.personId;
      if (typeof personId !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(personId))
        throw new Error("Invalid guest claim receipt");
      await boundaries.inOrg(personId, orgId, async (db) => {
        if (anchor.action === "registration.guest_claim_offered")
          await notifyGuestClaimOffer(
            db,
            { orgId, registrationId, personId, offerId: anchor.id },
            now,
          );
        else await notifyGuestClaim(db, { orgId, registrationId, personId }, now);
        const [receipt] = await db
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.scopeType, "org"),
              eq(auditLog.scopeId, orgId),
              eq(auditLog.action, "registration.guest_claim_notice_dispatched"),
              eq(auditLog.subject, anchor.id),
            ),
          );
        if (!receipt)
          await db.insert(auditLog).values({
            id: newId(),
            actor: personId,
            action: "registration.guest_claim_notice_dispatched",
            scopeType: "org",
            scopeId: orgId,
            subject: anchor.id,
            meta: { registrationId },
            at: now,
          });
      });
    }
    if (anchors.length) kickDrain();
  } catch (error) {
    logger().warn({ err: error, registrationId }, "scoring.guest_claim_notice_deferred");
  }
}

export async function recoverGuestClaimInvites(
  readDb: Db,
  boundaries: ReminderBoundaries,
  fixtureIds?: readonly string[],
) {
  const rows = await readDb
    .select({ orgId: auditLog.scopeId, registrationId: auditLog.subject })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.scopeType, "org"),
        inArray(auditLog.action, GUEST_CLAIM_ANCHORS),
        sql`not exists (select 1 from audit_log receipt where receipt.action = 'registration.guest_claim_notice_dispatched' and receipt.scope_type = 'org' and receipt.scope_id = ${auditLog.scopeId} and receipt.subject = ${auditLog.id})`,
        ...(fixtureIds
          ? [inArray(sql<string>`${auditLog.meta}->>'fixtureId'`, [...fixtureIds])]
          : []),
      ),
    )
    .orderBy(auditLog.at)
    .limit(100);
  for (const row of rows)
    if (row.registrationId)
      await recoverableGuestClaimDispatch(row.orgId, row.registrationId, boundaries);
}
