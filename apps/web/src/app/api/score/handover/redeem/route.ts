import { withTenantDb } from "@desiauction/db";
import { NextResponse } from "next/server";
import { currentSession } from "../../../../../server/auth/actions";
import { handoverTenant } from "../../../../../server/competition/resolve";
import { dbHandle } from "../../../../../server/db";
import { redeemHandover } from "../../../../../server/scoring/handover";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<NextResponse> {
  const session = await currentSession();
  if (!session)
    return NextResponse.json(
      { error: "forbidden", message: "Sign in to take this match." },
      { status: 401 },
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }
  const token = body && typeof body === "object" && "token" in body ? body.token : undefined;
  const orgId = await handoverTenant(session.personId, token);
  if (!orgId)
    return NextResponse.json(
      { error: "bad_token", message: "This handover link is invalid or expired." },
      { status: 400 },
    );
  const result = await withTenantDb(dbHandle, { personId: session.personId, orgId }, (db) =>
    redeemHandover(db, session.personId, body),
  );
  return NextResponse.json(result, {
    status: result.ok ? 200 : result.error === "forbidden" ? 403 : 400,
  });
}
