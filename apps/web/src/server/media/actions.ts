"use server";

import {
  isAllowedImageType,
  mediaKeyBelongsTo,
  validateUpload,
  type AllowedImageType,
  type MediaSubject,
} from "@desiauction/core";
import { auditLog, newId, people, withTenantDb } from "@desiauction/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { currentSession } from "../auth/actions";
import { resolveCompetition } from "../competition/competitions";
import { dbHandle, systemDb } from "../db";
import {
  ForbiddenError,
  clearPlayerPhoto,
  persistMediaKey,
  requireMediaWrite,
  resolveMediaSubject,
} from "./authz";
import { storage } from "./index";

// Media writes (parity §3.1). Every action: session → membership-gated
// competition → tenant boundary → subject resolve + R6 authz → storage/db.
// Image bytes never pass through here — the browser PUTs to the returned URL.

export interface UploadRequestInput {
  slug: string;
  subject: MediaSubject; // "player" | "team" | "competition"
  subjectId: string; // registrationId | teamId | competitionId
  contentType: string;
  byteSize: number;
}

export type UploadRequestResult =
  | { ok: true; uploadUrl: string; key: string }
  | { ok: false; error: string };

export async function requestMediaUpload(input: UploadRequestInput): Promise<UploadRequestResult> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "Please sign in to upload." };
  }
  if (!isAllowedImageType(input.contentType)) {
    return { ok: false, error: "Only JPEG, PNG or WebP images are allowed." };
  }
  const check = validateUpload({ contentType: input.contentType, byteSize: input.byteSize });
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  const competition = await resolveCompetition(systemDb, session.personId, input.slug);
  if (competition === null) {
    return { ok: false, error: "Competition not found." };
  }
  const contentType: AllowedImageType = input.contentType;
  try {
    const storageSubjectId = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: competition.orgId },
      async (db) => {
        const resolved = await resolveMediaSubject(db, competition, input.subject, input.subjectId);
        if (resolved === null) {
          throw new ForbiddenError();
        }
        await requireMediaWrite(db, session.personId, competition, input.subject, resolved);
        return resolved.storageSubjectId;
      },
    );
    const upload = await storage.presignUpload({
      orgId: competition.orgId,
      subject: input.subject,
      subjectId: storageSubjectId,
      contentType,
      token: newId(),
    });
    return { ok: true, uploadUrl: upload.uploadUrl, key: upload.key };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You don't have permission to upload this image." };
    }
    throw error;
  }
}

export interface AttachInput {
  slug: string;
  subject: MediaSubject;
  subjectId: string;
  key: string;
}

export type AttachResult = { ok: true; url: string } | { ok: false; error: string };

export async function attachMedia(input: AttachInput): Promise<AttachResult> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "Please sign in." };
  }
  const competition = await resolveCompetition(systemDb, session.personId, input.slug);
  if (competition === null) {
    return { ok: false, error: "Competition not found." };
  }
  try {
    await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: competition.orgId },
      async (db) => {
        const resolved = await resolveMediaSubject(db, competition, input.subject, input.subjectId);
        if (resolved === null) {
          throw new ForbiddenError();
        }
        await requireMediaWrite(db, session.personId, competition, input.subject, resolved);
        // Bind the key to what was just authorized (S2): reject any key that is
        // malformed or whose org/subject/subjectId doesn't match this target,
        // so a client cannot attach an arbitrary or cross-tenant object.
        if (
          !mediaKeyBelongsTo(input.key, {
            orgId: competition.orgId,
            subject: input.subject,
            subjectId: resolved.storageSubjectId,
          })
        ) {
          throw new ForbiddenError();
        }
        const via =
          resolved.ownerPersonId === session.personId
            ? "self_upload"
            : "organizer_upload_attestation";
        await persistMediaKey(db, input.subject, resolved, input.key, new Date(), via);
        // Append-only evidence (S3, DPDP §6): who attached media to what, and how
        // consent was captured. Metadata only — never the image or PII content.
        await db.insert(auditLog).values({
          id: newId(),
          actor: session.personId,
          action: "media.attached",
          scopeType: "org",
          scopeId: competition.orgId,
          subject: resolved.storageSubjectId,
          meta: { subject: input.subject, competitionId: competition.id, via },
        });
      },
    );
    revalidatePath(`/c/${competition.slug}`);
    revalidatePath(`/competitions/${competition.slug}/teams`);
    revalidatePath(`/competitions/${competition.slug}/registrations`);
    return { ok: true, url: storage.readUrl(input.key) };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You don't have permission to attach this image." };
    }
    throw error;
  }
}

export interface RemovePhotoInput {
  slug: string;
  registrationId: string;
}

/**
 * Consent withdrawal (PR1, DPDP §5): null the photo + all consent fields AND
 * delete the storage object so a withdrawn photo is not left publicly fetchable.
 * Same authorization as attach (registrant-self or organizer with review).
 */
export async function removePlayerPhoto(
  input: RemovePhotoInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "Please sign in." };
  }
  const competition = await resolveCompetition(systemDb, session.personId, input.slug);
  if (competition === null) {
    return { ok: false, error: "Competition not found." };
  }
  try {
    const removedKey = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: competition.orgId },
      async (db) => {
        const resolved = await resolveMediaSubject(db, competition, "player", input.registrationId);
        if (resolved === null) {
          throw new ForbiddenError();
        }
        await requireMediaWrite(db, session.personId, competition, "player", resolved);
        const [row] = await db
          .select({ photoUrl: people.photoUrl })
          .from(people)
          .where(eq(people.id, resolved.storageSubjectId))
          .limit(1);
        await clearPlayerPhoto(db, resolved.storageSubjectId);
        await db.insert(auditLog).values({
          id: newId(),
          actor: session.personId,
          action: "media.removed",
          scopeType: "org",
          scopeId: competition.orgId,
          subject: resolved.storageSubjectId,
          meta: { subject: "player", competitionId: competition.id },
        });
        return row?.photoUrl ?? null;
      },
    );
    // Consent is already withdrawn (DB committed). Object deletion is best-effort
    // — a malformed legacy key must not block the withdrawal itself.
    if (removedKey !== null) {
      try {
        await storage.delete(removedKey);
      } catch {
        // Object already gone or key not deletable; consent removal stands.
      }
    }
    revalidatePath(`/c/${competition.slug}`);
    revalidatePath(`/competitions/${competition.slug}/registrations`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You don't have permission to remove this photo." };
    }
    throw error;
  }
}
