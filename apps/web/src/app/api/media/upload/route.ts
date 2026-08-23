import { bytesMatchImageType, isValidMediaKey, validateUpload } from "@desiauction/core";
import { withTenantDb } from "@desiauction/db";
import { NextResponse } from "next/server";

import { currentSession } from "../../../../server/auth/actions";
import { dbHandle } from "../../../../server/db";
import { localMediaStore } from "../../../../server/media";
import { orgsFor } from "../../../../server/orgs/orgs";

/**
 * DEV/e2e local media upload (parity §3.1, R4 — this path exists ONLY in
 * MEDIA_STORAGE=local; production PUTs presigned URLs straight to the bucket).
 *
 * R6 guard: a valid session AND membership in the org embedded in the key. The
 * key format is `org/{orgId}/{subject}/{subjectId}/{token}.{ext}`; the orgId is
 * the isolation boundary, so we verify the caller belongs to that org before
 * writing a single byte.
 */
export const dynamic = "force-dynamic";

function orgIdFromKey(key: string): string | null {
  const parts = key.split("/");
  return parts[0] === "org" && parts.length >= 5 && parts[1] !== "" ? (parts[1] as string) : null;
}

/**
 * The caller's OWN player photo — `org/{org}/player/{personId}/…`.
 *
 * A player registering from a WhatsApp link is not a member of the organizer's
 * club and never will be, so the membership check below refuses them. But
 * `requestOwnPhotoUpload` deliberately does not ask for membership either: it
 * resolves the season publicly and mints a key whose subjectId IS the caller,
 * and `attachOwnPhoto` re-checks exactly that binding before the row is written.
 * This end of the same path was checking a different question, so under the
 * default MEDIA_STORAGE=local every self-registered photo died on a 403 and the
 * player saw "Upload failed. Please try again." for ever. The e2e suite covers
 * the ORGANIZER's photo import, whose actor is a member, so nothing went red.
 *
 * Ownership is the weaker-looking gate and the stronger one: the key names the
 * person, and the person is the session.
 */
function isOwnPlayerKey(key: string, personId: string): boolean {
  const parts = key.split("/");
  return parts[2] === "player" && parts[3] === personId;
}

export async function PUT(request: Request): Promise<NextResponse> {
  if (localMediaStore === null) {
    return NextResponse.json({ error: "Local uploads are disabled." }, { status: 404 });
  }
  const session = await currentSession();
  if (session === null) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const key = new URL(request.url).searchParams.get("key");
  if (key === null) {
    return NextResponse.json({ error: "Missing key." }, { status: 400 });
  }
  // Reject anything that is not the exact, traversal-safe key shape BEFORE the
  // orgId is trusted or the path is touched (S1). `..` cannot pass this gate.
  if (!isValidMediaKey(key)) {
    return NextResponse.json({ error: "Malformed key." }, { status: 400 });
  }
  const orgId = orgIdFromKey(key);
  if (orgId === null) {
    return NextResponse.json({ error: "Malformed key." }, { status: 400 });
  }
  const allowed =
    isOwnPlayerKey(key, session.personId) ||
    (await withTenantDb(dbHandle, { personId: session.personId }, async (db) => {
      const orgs = await orgsFor(db, session.personId);
      return orgs.some((org) => org.id === orgId);
    }));
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await request.arrayBuffer());
  const check = validateUpload({ contentType, byteSize: bytes.byteLength });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }
  // The declared type is the caller's claim; these are the file's own bytes.
  // Without this a text file (or a script) was stored under a .png key and
  // served from the media origin (P3-3).
  if (!bytesMatchImageType(contentType, bytes)) {
    return NextResponse.json(
      { error: "That file is not the image type it claims to be." },
      { status: 400 },
    );
  }
  await localMediaStore.writeLocal(key, contentType, bytes);
  return NextResponse.json({ ok: true, key });
}
