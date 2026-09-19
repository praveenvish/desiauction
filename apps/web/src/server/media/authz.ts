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
  /**
   * For a player: the photo belongs on the ENTRY, not the person (0077). The
   * organizer typed this entry's name (0075), so the account behind the phone
   * may be somebody the club has never met, and the club is the one acting.
   * `storageSubjectId` is then the registration id.
   */
  entryPhoto?: { registrationId: string };
}

export async function resolveMediaSubject(
  db: Db,
  competition: CompetitionSummary,
  subject: MediaSubject,
  subjectId: string,
  actorId: string,
): Promise<ResolvedMediaSubject | null> {
  if (subject === "competition") {
    return subjectId === competition.id
      ? { storageSubjectId: competition.id, ownerPersonId: null }
      : null;
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
    .select({ personId: registrations.personId, enteredName: registrations.enteredName })
    .from(registrations)
    .where(and(eq(registrations.id, subjectId), eq(registrations.competitionId, competition.id)))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  // A player photo lands on the PERSON, platform-wide (D7) — except when the
  // club typed this entry's name and someone other than that person is
  // uploading. Writing to `people` then replaced (or deleted) a stranger's
  // picture and consent everywhere; refusing would tell the club the phone has
  // an account. So the club's photo lives on the entry and only this season
  // shows it (security review, launch Phase 5).
  if (row.enteredName !== null && row.personId !== actorId) {
    return {
      storageSubjectId: subjectId,
      ownerPersonId: row.personId,
      entryPhoto: { registrationId: subjectId },
    };
  }
  return { storageSubjectId: row.personId, ownerPersonId: row.personId };
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
  if (resolved.entryPhoto !== undefined) {
    await db
      .update(registrations)
      .set({ enteredPhotoKey: key, enteredPhotoConsentAt: now, enteredPhotoConsentVia: consentVia })
      .where(eq(registrations.id, resolved.entryPhoto.registrationId));
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

/** The photo key currently attached to this player subject, for deletion. */
export async function currentPlayerPhotoKey(
  db: Db,
  resolved: ResolvedMediaSubject,
): Promise<string | null> {
  if (resolved.entryPhoto !== undefined) {
    const [row] = await db
      .select({ key: registrations.enteredPhotoKey })
      .from(registrations)
      .where(eq(registrations.id, resolved.entryPhoto.registrationId))
      .limit(1);
    return row?.key ?? null;
  }
  const [row] = await db
    .select({ key: people.photoUrl })
    .from(people)
    .where(eq(people.id, resolved.storageSubjectId))
    .limit(1);
  return row?.key ?? null;
}

/** Withdraw the club's photo from a typed-name entry (0077). */
export async function clearEntryPhoto(db: Db, registrationId: string): Promise<void> {
  await db
    .update(registrations)
    .set({ enteredPhotoKey: null, enteredPhotoConsentAt: null, enteredPhotoConsentVia: null })
    .where(eq(registrations.id, registrationId));
}

/** Consent withdrawal (PR1, DPDP §5): null the photo key + all consent fields.
 * The storage object is deleted separately (best-effort) by the caller. */
export async function clearPlayerPhoto(db: Db, personId: string): Promise<void> {
  await db
    .update(people)
    .set({ photoUrl: null, photoUploadedAt: null, photoConsentAt: null, photoConsentVia: null })
    .where(eq(people.id, personId));
}

export { ForbiddenError };
