import { withTenantDb } from "@desiauction/db";
import { NextResponse } from "next/server";
import { currentSession } from "../../../../../server/auth/actions";
import { publicCompetitionBySlug } from "../../../../../server/competition/resolve";
import { dbHandle } from "../../../../../server/db";
import { grantsOfPerson } from "../../../../../server/request-cache";
import { rolesOf } from "../../../../../server/roles/roles";
import { revalidateScoredMatch } from "../../../../../server/scoring/finalize";
import { prepareScoring } from "../../../../../server/scoring/prepare";
import { resumeScoring } from "../../../../../server/scoring/claim";
import { appendScoringEvents } from "../../../../../server/scoring/append";
import { recoverableTossDispatch } from "../../../../../server/scoring/toss-reminder-delivery";
import { recoverableResultDispatch } from "../../../../../server/scoring/result-notice-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ fixtureId: string }> },
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
    const result = await withTenantDb(dbHandle, { personId: session.personId, orgId }, (db) =>
      appendScoringEvents(db, fixtureId, session.personId, body),
    );
    if (!result.ok && result.error === "not_found") continue;
    if (result.ok) {
      const { finalized, voided, tossAccepted, ...response } = result;
      if (finalized) {
        revalidateScoredMatch(finalized);
        await recoverableResultDispatch(orgId, fixtureId);
      }
      if (voided) revalidateScoredMatch(voided);
      if (tossAccepted) await recoverableTossDispatch(tossAccepted.orgId, fixtureId);
      return NextResponse.json(response);
    }
    return NextResponse.json(
      { error: result.error, message: result.message },
      {
        status:
          result.error === "forbidden"
            ? 403
            : result.error === "rate_limited"
              ? 429
              : result.error === "wrong_attempt"
                ? 409
                : 400,
      },
    );
  }
  return NextResponse.json({ error: "not_found", message: "Match not found." }, { status: 404 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ fixtureId: string }> },
): Promise<NextResponse> {
  const session = await currentSession();
  if (!session)
    return privateScoringJson(
      { error: "forbidden", message: "Sign in to score." },
      { status: 401 },
    );
  const rawSince = new URL(request.url).searchParams.get("since") ?? "0";
  if (!/^\d+$/.test(rawSince) || !Number.isSafeInteger(Number(rawSince)))
    return privateScoringJson(
      { error: "bad_payload", message: "Check the resume sequence." },
      { status: 400 },
    );
  const since = Number(rawSince);
  const preparing = new URL(request.url).searchParams.get("prepare") === "1";
  if (preparing && since !== 0)
    return privateScoringJson(
      { error: "bad_payload", message: "Preparation starts at sequence zero." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
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
    const result = await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId },
      async (db) => {
        if (preparing) return await prepareScoring(db, fixtureId, session.personId);
        return await resumeScoring(db, fixtureId, session.personId, since);
      },
    );
    if (!result.ok && result.error === "not_found") continue;
    if (result.ok)
      return privateScoringJson(
        {
          attempt: result.attempt,
          lastSeq: result.lastSeq,
          events: result.events,
          ...(preparing && "bootstrap" in result
            ? { bootstrap: result.bootstrap, preparation: result.preparation }
            : {}),
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    return privateScoringJson(
      { error: result.error, message: result.message },
      { status: result.error === "forbidden" ? 403 : 400 },
    );
  }
  return privateScoringJson({ error: "not_found", message: "Match not found." }, { status: 404 });
}

function privateScoringJson(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "private, no-store");
  return NextResponse.json(body, { ...init, headers });
}
