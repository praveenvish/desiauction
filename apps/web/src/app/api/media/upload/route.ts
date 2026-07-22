import { isValidMediaKey, validateUpload } from "@desiauction/core";
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
  const isMember = await withTenantDb(dbHandle, { personId: session.personId }, async (db) => {
    const orgs = await orgsFor(db, session.personId);
    return orgs.some((org) => org.id === orgId);
  });
  if (!isMember) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await request.arrayBuffer());
  const check = validateUpload({ contentType, byteSize: bytes.byteLength });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }
  await localMediaStore.writeLocal(key, contentType, bytes);
  return NextResponse.json({ ok: true, key });
}
