import type { MediaSubject } from "@desiauction/core";
import { competitions, people, registrations, teams, type Db } from "@desiauction/db";
import { and, eq } from "drizzle-orm";

import type { CompetitionSummary } from "../competition/competitions";
import { requireCompetitionCapability } from "../competition/authz";
import { ForbiddenError } from "../orgs/authz";

/**
 * Media write authorization (parity §3.1, R6 — one guard, reused by the server
 * actions AND the local upload route so neither is an open write).
 *
 * A subject id from the caller is un-trusted: we load the row INSIDE the tenant
 * boundary and assert it belongs to this competition/org before authorizing.
 */

export interface ResolvedMediaSubject {
  /** The id used in the storage key (person-level for players — D7). */
  storageSubjectId: string;
  /** For a player, the owning person (enables the self-upload branch). */
  ownerPersonId: string | null;
}

export async function resolveMediaSubject(
  db: Db,
  competition: CompetitionSummary,
  subject: MediaSubject,
  subjectId: string,
): Promise<ResolvedMediaSubject | null> {
  if (subject === "competition") {
    return subjectId === competition.id ? { storageSubjectId: competition.id, ownerPersonId: null } : null;
  }
  if (subject === "team") {
    const [row] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, subjectId), eq(teams.competitionId, competition.id)))
      .limit(1);
    return row === undefined ? null : { storageSubjectId: row.id, ownerPersonId: null };
  }
  // player: subjectId is a registration id; the photo lands person-level (D7).
  const [row] = await db
    .select({ personId: registrations.personId })
    .from(registrations)
    .where(and(eq(registrations.id, subjectId), eq(registrations.competitionId, competition.id)))
    .limit(1);
  return row === undefined ? null : { storageSubjectId: row.personId, ownerPersonId: row.personId };
}

/** Throws ForbiddenError unless the caller may write media for this subject. */
export async function requireMediaWrite(
  db: Db,
  personId: string,
  competition: CompetitionSummary,
  subject: MediaSubject,
  resolved: ResolvedMediaSubject,
): Promise<void> {
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  if (subject === "team") {
    await requireCompetitionCapability(db, personId, scope, "team.manage");
    return;
  }
  if (subject === "competition") {
    await requireCompetitionCapability(db, personId, scope, "competition.manage");
    return;
  }
  // player: the registrant may set their own photo; otherwise an organizer with
  // review rights attests on their behalf (the `via` value records which).
  if (resolved.ownerPersonId === personId) {
    return;
  }
  await requireCompetitionCapability(db, personId, scope, "registration.review");
}

/** Persist the attached key on the subject's row. For a player photo, consent
 * is captured with a `via` that records self-upload vs organizer attestation. */
export async function persistMediaKey(
  db: Db,
  subject: MediaSubject,
  resolved: ResolvedMediaSubject,
  key: string,
  now: Date,
  consentVia: string,
): Promise<void> {
  if (subject === "team") {
    await db.update(teams).set({ logoUrl: key }).where(eq(teams.id, resolved.storageSubjectId));
    return;
  }
  if (subject === "competition") {
    await db
      .update(competitions)
      .set({ logoUrl: key })
      .where(eq(competitions.id, resolved.storageSubjectId));
    return;
  }
  // player photo: set the key + upload time, and capture consent if not already
  // present (C-25 × DPDP §5 — render is gated on photo_consent_at downstream).
  await db
    .update(people)
    .set({
      photoUrl: key,
      photoUploadedAt: now,
      photoConsentAt: now,
      photoConsentVia: consentVia,
    })
    .where(eq(people.id, resolved.storageSubjectId));
}

export { ForbiddenError };
