import {
  isRegistrationRole,
  registrationTransition,
  type RegistrationEvent,
  type RegistrationStatus,
} from "@desiauction/core";
import { auditLog, competitions, newId, people, registrations, type Db } from "@desiauction/db";
import { and, desc, eq } from "drizzle-orm";

// Registration persistence (IP-3 §4, doc 42). The state machine is core's; this
// module fetches/writes and audits. Approval's human gate (invariant 5) is the
// capability check at the action layer; a private reason (invariant 6) is
// required by core's machine for a reject.

export type SubmitResult =
  | { ok: true; registrationId: string }
  | { ok: false; reason: "invalid_role" | "not_open" | "duplicate" };

/**
 * A Person applies to a Competition. Any authenticated person may register while
 * intake is open (they need not be an org member — they are a player, doc 42).
 * Duplicate = same person in the same competition (unique index, invariant).
 */
export async function submitRegistration(
  db: Db,
  competitionId: string,
  orgId: string,
  personId: string,
  role: string,
  basePriceBand?: string,
): Promise<SubmitResult> {
  if (!isRegistrationRole(role)) {
    return { ok: false, reason: "invalid_role" };
  }
  const [competition] = await db
    .select({ status: competitions.status })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  if (competition === undefined || competition.status !== "registration_open") {
    return { ok: false, reason: "not_open" };
  }
  const id = newId();
  try {
    await db.insert(registrations).values({
      id,
      orgId,
      competitionId,
      personId,
      role,
      status: "submitted",
      ...(basePriceBand !== undefined && basePriceBand !== "" ? { basePriceBand } : {}),
    });
  } catch {
    return { ok: false, reason: "duplicate" };
  }
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "registration.submitted",
    scopeType: "org",
    scopeId: orgId,
    subject: id,
    meta: { competitionId, role },
  });
  return { ok: true, registrationId: id };
}

export interface RegistrationRow {
  id: string;
  personId: string;
  name: string | null;
  phone: string;
  role: string;
  status: RegistrationStatus;
  rejectionReason: string | null;
}

/** The organizer triage queue for a competition (doc 42). */
export async function registrationsOf(db: Db, competitionId: string): Promise<RegistrationRow[]> {
  return db
    .select({
      id: registrations.id,
      personId: registrations.personId,
      name: people.name,
      phone: people.phone,
      role: registrations.role,
      status: registrations.status,
      rejectionReason: registrations.rejectionReason,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(eq(registrations.competitionId, competitionId))
    .orderBy(desc(registrations.createdAt));
}

/** A person's own registration in a competition (their status page seed, doc 42). */
export async function myRegistration(
  db: Db,
  competitionId: string,
  personId: string,
): Promise<{ status: RegistrationStatus; role: string } | null> {
  const [row] = await db
    .select({ status: registrations.status, role: registrations.role })
    .from(registrations)
    .where(
      and(eq(registrations.competitionId, competitionId), eq(registrations.personId, personId)),
    )
    .limit(1);
  return row ?? null;
}

export type TriageResult =
  | { ok: true; status: RegistrationStatus }
  | { ok: false; reason: "not_found" | "illegal_transition" | "reason_required" };

/**
 * Approve / reject / waitlist / withdraw one registration. The legality decision
 * is core's machine; this writes the new state + review provenance + audit.
 */
export async function triageRegistration(
  db: Db,
  orgId: string,
  competitionId: string,
  registrationId: string,
  reviewerId: string,
  event: RegistrationEvent,
): Promise<TriageResult> {
  const [current] = await db
    .select({ status: registrations.status })
    .from(registrations)
    .where(
      and(eq(registrations.id, registrationId), eq(registrations.competitionId, competitionId)),
    )
    .limit(1);
  if (current === undefined) {
    return { ok: false, reason: "not_found" };
  }
  const decision = registrationTransition(current.status, event);
  if (!decision.ok) {
    return { ok: false, reason: decision.reason };
  }
  await db
    .update(registrations)
    .set({
      status: decision.next,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      ...(event.type === "reject"
        ? {
            rejectionReason: event.reason,
            ...(event.note !== undefined ? { rejectionNote: event.note } : {}),
          }
        : {}),
    })
    .where(eq(registrations.id, registrationId));
  await db.insert(auditLog).values({
    id: newId(),
    actor: reviewerId,
    action: `registration.${event.type}`,
    scopeType: "org",
    scopeId: orgId,
    subject: registrationId,
    // Rejection reason categories are internal provenance; never rendered publicly (invariant 6).
    meta: event.type === "reject" ? { reason: event.reason } : {},
  });
  return { ok: true, status: decision.next };
}
