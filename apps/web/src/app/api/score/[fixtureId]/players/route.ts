import { withTenantDb } from "@desiauction/db";
import { NextResponse } from "next/server";
import { currentSession } from "../../../../../server/auth/actions";
import { publicCompetitionBySlug } from "../../../../../server/competition/resolve";
import { dbHandle } from "../../../../../server/db";
import { grantsOfPerson } from "../../../../../server/request-cache";
import { rolesOf } from "../../../../../server/roles/roles";
import { recoverableGuestClaimDispatch } from "../../../../../server/scoring/result-notice-delivery";
import { claimScoringGuest } from "../../../../../server/scoring/guest-claim";
import { addScoringGuest, GuestRefusal } from "../../../../../server/scoring/guests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function playerRequest(
  request: Request,
  context: { params: Promise<{ fixtureId: string }> },
  claim: boolean,
): Promise<NextResponse> {
  const session = await currentSession();
  if (!session)
    return NextResponse.json({ error: "forbidden", message: "Sign in to score." }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_payload", message: "Check the scoring entries." },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json(
      { error: "bad_payload", message: "Check the scoring entries." },
      { status: 400 },
    );
  const { fixtureId } = await context.params;
  const [roles, held] = await Promise.all([
    rolesOf(session.personId),
    grantsOfPerson(session.personId),
  ]);
  // Ownership provides a known season slug before lazy manager provisioning.
  // Reuse the existing pre-tenant season resolver; every fixture read/write
  // below stays inside a separately opened tenant boundary and AUTH-1.
  const owned = await Promise.all(
    [...new Set(roles.owns.map((team) => team.competitionSlug))].map(publicCompetitionBySlug),
  );
  const orgIds = new Set([
    ...roles.scores.map((season) => season.orgId),
    ...roles.organizes.map((club) => club.orgId),
    ...roles.memberOf.map((club) => club.orgId),
    ...owned.flatMap((season) => (season ? [season.orgId] : [])),
    ...held
      .filter((grant) => grant.revokedAt === null && grant.scopeType === "org")
      .map((grant) => grant.scopeId),
  ]);
  for (const orgId of orgIds) {
    let result;
    try {
      result = await withTenantDb(dbHandle, { personId: session.personId, orgId }, (db) =>
        claim
          ? claimScoringGuest(db, fixtureId, session.personId, body)
          : addScoringGuest(db, fixtureId, session.personId, body),
      );
    } catch (error) {
      if (!(error instanceof GuestRefusal)) throw error;
      return NextResponse.json({ error: error.reason, message: error.message }, { status: 400 });
    }
    if (!result.ok && result.error === "not_found") continue;
    if (result.ok) {
      if (claim) await recoverableGuestClaimDispatch(orgId, result.registrationId);
      return NextResponse.json(result);
    }
    return NextResponse.json(
      { error: result.error, message: result.message },
      {
        status: result.error === "forbidden" ? 403 : 400,
      },
    );
  }
  return NextResponse.json({ error: "not_found", message: "Match not found." }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ fixtureId: string }> }) {
  return playerRequest(request, context, false);
}
export async function PATCH(request: Request, context: { params: Promise<{ fixtureId: string }> }) {
  return playerRequest(request, context, true);
}
