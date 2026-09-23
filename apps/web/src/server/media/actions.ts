"use server";

import {
  isAllowedImageType,
  mediaKeyBelongsTo,
  validateUpload,
  type AllowedImageType,
  type MediaSubject,
} from "@desiauction/core";
import { auditLog, newId, withTenantDb } from "@desiauction/db";
import { revalidatePath } from "next/cache";

import { currentSession } from "../auth/actions";
import { publicCompetitionBySlug, resolveMemberCompetition } from "../competition/resolve";
import { dbHandle } from "../db";
import {
  ForbiddenError,
  clearCompetitionImage,
  clearEntryPhoto,
  currentCompetitionImageKey,
  clearPlayerPhoto,
  currentPlayerPhotoKey,
  persistMediaKey,
  requireMediaWrite,
  resolveMediaSubject,
  type CompetitionImageSlot,
} from "./authz";
import { storage } from "./index";
import { discard, ingestUpload } from "./ingest";
import { takePresignQuota } from "./presign-quota";

// Media writes (parity §3.1). Every action: session → membership-gated
// competition → tenant boundary → subject resolve + R6 authz → storage/db.
// The upload itself never passes through here — the browser PUTs to the
// returned URL — but the ATTACH reads it back, sanitizes it and stores our own
// re-encode (ingest.ts, P0-6): what the client sent is never what is served.

/** A presign refused by the hourly budget (presign-quota.ts). */
class QuotaError extends Error {}

const QUOTA_MESSAGE = "Too many uploads in the last hour. Please try again later.";

export interface UploadRequestInput {
  slug: string;
  subject: MediaSubject; // "player" | "team" | "competition"
  subjectId: string; // registrationId | teamId | competitionId
  contentType: string;
  byteSize: number;
}

export type UploadRequestResult =
  { ok: true; uploadUrl: string; key: string } | { ok: false; error: string };

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
  const competition = await resolveMemberCompetition(session.personId, input.slug);
  if (competition === null) {
    return { ok: false, error: "Competition not found." };
  }
  const contentType: AllowedImageType = input.contentType;
  try {
    const storageSubjectId = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: competition.orgId },
      async (db) => {
        const resolved = await resolveMediaSubject(
          db,
          competition,
          input.subject,
          input.subjectId,
          session.personId,
        );
        if (resolved === null) {
          throw new ForbiddenError();
        }
        await requireMediaWrite(db, session.personId, competition, input.subject, resolved);
        const allowed = await takePresignQuota(db, session.personId, "media.upload_requested", {
          subject: input.subject,
          competitionId: competition.id,
        });
        if (!allowed) {
          throw new QuotaError();
        }
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
    if (error instanceof QuotaError) {
      return { ok: false, error: QUOTA_MESSAGE };
    }
    throw error;
  }
}

export interface AttachInput {
  slug: string;
  subject: MediaSubject;
  subjectId: string;
  key: string;
  /**
   * For a `competition` subject only: the crest (default) or the wide cover
   * photo (0082). Refused on any other subject rather than ignored.
   */
  slot?: CompetitionImageSlot;
}

export type AttachResult = { ok: true; url: string } | { ok: false; error: string };

export async function attachMedia(input: AttachInput): Promise<AttachResult> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "Please sign in." };
  }
  if (input.slot !== undefined && input.subject !== "competition") {
    return { ok: false, error: "You don't have permission to attach this image." };
  }
  // The input is untrusted wire data: anything but "cover" is the crest.
  const slot: CompetitionImageSlot = input.slot === "cover" ? "cover" : "logo";
  const competition = await resolveMemberCompetition(session.personId, input.slug);
  if (competition === null) {
    return { ok: false, error: "Competition not found." };
  }
  // Resolve + authorize, inside the tenant boundary. Run twice: once before
  // the storage IO (so an unauthorized caller never makes us read a byte) and
  // again in the write transaction (so the row is written under a fresh check,
  // without holding a connection across the bucket round-trips).
  const authorize = async (db: Parameters<typeof resolveMediaSubject>[0]) => {
    const resolved = await resolveMediaSubject(
      db,
      competition,
      input.subject,
      input.subjectId,
      session.personId,
    );
    if (resolved === null) {
      throw new ForbiddenError();
    }
    await requireMediaWrite(db, session.personId, competition, input.subject, resolved);
    return resolved;
  };
  const tenant = { personId: session.personId, orgId: competition.orgId };
  try {
    const target = await withTenantDb(dbHandle, tenant, async (db) => {
      const resolved = await authorize(db);
      // Bind the key to what was just authorized (S2): reject any key that is
      // malformed or whose org/subject/subjectId doesn't match this target,
      // so a client cannot attach an arbitrary or cross-tenant object.
      const bound = {
        orgId: competition.orgId,
        subject: input.subject,
        subjectId: resolved.storageSubjectId,
      };
      if (!mediaKeyBelongsTo(input.key, bound)) {
        throw new ForbiddenError();
      }
      return bound;
    });
    // P0-6: the object is the client's bytes until this returns our own.
    const ingested = await ingestUpload(storage, input.key, target, newId());
    if (!ingested.ok) {
      return ingested;
    }
    try {
      await withTenantDb(dbHandle, tenant, async (db) => {
        const resolved = await authorize(db);
        if (resolved.storageSubjectId !== target.subjectId) {
          // The subject moved between the two checks (a typed name, a
          // withdrawal): the key no longer belongs to what is authorized now.
          throw new ForbiddenError();
        }
        const via =
          resolved.ownerPersonId === session.personId
            ? "self_upload"
            : "organizer_upload_attestation";
        await persistMediaKey(db, input.subject, resolved, ingested.key, new Date(), via, slot);
        // Append-only evidence (S3, DPDP §6): who attached media to what, and how
        // consent was captured. Metadata only — never the image or PII content.
        await db.insert(auditLog).values({
          id: newId(),
          actor: session.personId,
          action: "media.attached",
          scopeType: "org",
          scopeId: competition.orgId,
          subject: resolved.storageSubjectId,
          meta: {
            subject: input.subject,
            competitionId: competition.id,
            via,
            ...(input.subject === "competition" ? { slot } : {}),
          },
        });
      });
    } catch (error) {
      await discard(storage, ingested.key);
      throw error;
    }
    await discard(storage, ingested.rawKey);
    revalidatePath(`/c/${competition.slug}`);
    // The season overview renders the competition's own crest and offers to
    // replace it, so it is as stale after an attach as the tabs below it.
    revalidatePath(`/seasons/${competition.slug}`);
    revalidatePath(`/seasons/${competition.slug}/teams`);
    revalidatePath(`/seasons/${competition.slug}/registrations`);
    return { ok: true, url: storage.readUrl(ingested.key) };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You don't have permission to attach this image." };
    }
    throw error;
  }
}

/**
 * Take one of the season's own pictures down — the crest or the cover photo.
 * Same gate as the upload (`competition.manage`, through the one media guard);
 * the column goes back to null, so the page falls back to the initials or the
 * designed gradient, and the storage object is deleted best-effort after the
 * row has committed.
 */
export async function removeCompetitionImage(input: {
  slug: string;
  slot: CompetitionImageSlot;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "Please sign in." };
  }
  const slot: CompetitionImageSlot = input.slot === "cover" ? "cover" : "logo";
  const competition = await resolveMemberCompetition(session.personId, input.slug);
  if (competition === null) {
    return { ok: false, error: "Competition not found." };
  }
  try {
    const removedKey = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: competition.orgId },
      async (db) => {
        const resolved = await resolveMediaSubject(
          db,
          competition,
          "competition",
          competition.id,
          session.personId,
        );
        if (resolved === null) {
          throw new ForbiddenError();
        }
        await requireMediaWrite(db, session.personId, competition, "competition", resolved);
        const removed = await currentCompetitionImageKey(db, competition.id, slot);
        if (removed === null) {
          return null;
        }
        await clearCompetitionImage(db, competition.id, slot);
        await db.insert(auditLog).values({
          id: newId(),
          actor: session.personId,
          action: "media.removed",
          scopeType: "org",
          scopeId: competition.orgId,
          subject: competition.id,
          meta: { subject: "competition", competitionId: competition.id, slot },
        });
        return removed;
      },
    );
    if (removedKey !== null) {
      try {
        await storage.delete(removedKey);
      } catch {
        // Already gone or not deletable; the row no longer points at it.
      }
    }
    revalidatePath(`/c/${competition.slug}`);
    revalidatePath(`/seasons/${competition.slug}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You don't have permission to remove this image." };
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
  const competition = await resolveMemberCompetition(session.personId, input.slug);
  if (competition === null) {
    return { ok: false, error: "Competition not found." };
  }
  try {
    const removedKey = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: competition.orgId },
      async (db) => {
        const resolved = await resolveMediaSubject(
          db,
          competition,
          "player",
          input.registrationId,
          session.personId,
        );
        if (resolved === null) {
          throw new ForbiddenError();
        }
        await requireMediaWrite(db, session.personId, competition, "player", resolved);
        const removed = await currentPlayerPhotoKey(db, resolved);
        if (resolved.entryPhoto !== undefined) {
          await clearEntryPhoto(db, resolved.entryPhoto.registrationId);
        } else {
          await clearPlayerPhoto(db, resolved.storageSubjectId);
        }
        await db.insert(auditLog).values({
          id: newId(),
          actor: session.personId,
          action: "media.removed",
          scopeType: "org",
          scopeId: competition.orgId,
          subject: resolved.storageSubjectId,
          meta: { subject: "player", competitionId: competition.id },
        });
        return removed;
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
    revalidatePath(`/seasons/${competition.slug}/registrations`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You don't have permission to remove this photo." };
    }
    throw error;
  }
}

// --- Player self-service photo (registration-time; no org membership needed) ---
// A logged-in player sets their OWN photo while registration is open. subjectId
// is always session.personId (no cross-tenant surface); the competition only
// supplies the storage-key org path + open-window gate. Reuses the S2 key bind,
// persistMediaKey, and the S3 audit event.

export async function requestOwnPhotoUpload(input: {
  slug: string;
  contentType: string;
  byteSize: number;
}): Promise<UploadRequestResult> {
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
  const competition = await publicCompetitionBySlug(input.slug);
  if (competition === null || competition.status !== "registration_open") {
    return { ok: false, error: "Registration is not open for this competition." };
  }
  const contentType: AllowedImageType = input.contentType;
  const allowed = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    takePresignQuota(db, session.personId, "media.own_upload_requested", {
      competitionId: competition.id,
    }),
  );
  if (!allowed) {
    return { ok: false, error: QUOTA_MESSAGE };
  }
  const upload = await storage.presignUpload({
    orgId: competition.orgId,
    subject: "player",
    subjectId: session.personId,
    contentType,
    token: newId(),
  });
  return { ok: true, uploadUrl: upload.uploadUrl, key: upload.key };
}

export async function attachOwnPhoto(input: { slug: string; key: string }): Promise<AttachResult> {
  const session = await currentSession();
  if (session === null) {
    return { ok: false, error: "Please sign in." };
  }
  const competition = await publicCompetitionBySlug(input.slug);
  if (competition === null || competition.status !== "registration_open") {
    return { ok: false, error: "Registration is not open." };
  }
  // Bind the key to THIS person (S2): subjectId must be the caller themselves.
  if (
    !mediaKeyBelongsTo(input.key, {
      orgId: competition.orgId,
      subject: "player",
      subjectId: session.personId,
    })
  ) {
    return { ok: false, error: "Invalid image reference." };
  }
  // P0-6: sanitize before a row points at it (ingest.ts).
  const ingested = await ingestUpload(
    storage,
    input.key,
    { orgId: competition.orgId, subject: "player", subjectId: session.personId },
    newId(),
  );
  if (!ingested.ok) {
    return ingested;
  }
  try {
    await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: competition.orgId },
      async (db) => {
        const resolved = { storageSubjectId: session.personId, ownerPersonId: session.personId };
        await persistMediaKey(db, "player", resolved, ingested.key, new Date(), "self_upload");
        await db.insert(auditLog).values({
          id: newId(),
          actor: session.personId,
          action: "media.attached",
          scopeType: "org",
          scopeId: competition.orgId,
          subject: session.personId,
          meta: {
            subject: "player",
            competitionId: competition.id,
            via: "self_upload",
            self: true,
          },
        });
      },
    );
  } catch (error) {
    await discard(storage, ingested.key);
    throw error;
  }
  await discard(storage, ingested.rawKey);
  revalidatePath(`/c/${input.slug}`);
  return { ok: true, url: storage.readUrl(ingested.key) };
}
