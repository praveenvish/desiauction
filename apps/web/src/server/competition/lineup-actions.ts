"use server";

import { withTenantDb } from "@desiauction/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { saveLineup } from "./lineups";
import { announceLineup } from "./lineup-announce";
import { resolveMemberCompetition } from "./resolve";
import { personCanCompetition } from "../request-cache";

/**
 * Lineups are an organizer's record, gated on `fixture.manage` — the same key
 * that records a result. Squads are rosters, and a roster is not something a
 * plain member or a rival owner reads (teams tab, canSeeRoster). They are read
 * with the Matches screen (`scheduleView`) and written here.
 */
async function gate(slug: string) {
  const session = await currentSession();
  if (session === null) {
    redirect(`/login?next=/seasons/${slug}/fixtures`);
  }
  const competition = await resolveMemberCompetition(session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const allowed = await personCanCompetition(session.personId, scope, "fixture.manage");
  return allowed ? { personId: session.personId, competition } : null;
}

const MAX_LINEUP = 60;

export async function saveLineupAction(
  slug: string,
  fixtureId: string,
  teamId: string,
  registrationIds: string[],
): Promise<{ ok: true; played: number } | { ok: false; error: string }> {
  const gated = await gate(slug);
  if (gated === null) {
    return { ok: false, error: "You can't record lineups for this season." };
  }
  // A squad is tens of players, never hundreds. The list comes from the client,
  // and each id is checked in one IN (...) query — an unbounded array made that
  // query as large as the request body allowed (security review, Phase 5).
  if (!Array.isArray(registrationIds) || registrationIds.length > MAX_LINEUP) {
    return { ok: false, error: "That's more players than a squad holds." };
  }
  const { personId, competition } = gated;
  const result = await withTenantDb(dbHandle, { personId, orgId: competition.orgId }, (db) =>
    saveLineup(db, {
      competitionId: competition.id,
      orgId: competition.orgId,
      fixtureId,
      teamId,
      registrationIds,
      actorId: personId,
    }),
  );
  if (!result.ok) {
    const message: Record<typeof result.reason, string> = {
      not_found: "That match isn't in this season any more.",
      not_a_side: "That team isn't playing in this match.",
      not_in_squad: "Someone ticked isn't in this team's squad any more. Reload and try again.",
    };
    return { ok: false, error: message[result.reason] };
  }
  revalidatePath(`/seasons/${slug}/fixtures`);
  return { ok: true, played: result.played };
}

/**
 * Tell the players in one side's SAVED lineup that they are in it — only for a
 * match still to come, only those not told before. Same key as recording it
 * (`fixture.manage`): whoever picks the lineup announces it.
 */
export async function announceLineupAction(
  slug: string,
  fixtureId: string,
  teamId: string,
): Promise<{ ok: true; told: number } | { ok: false; error: string }> {
  const gated = await gate(slug);
  if (gated === null) {
    return { ok: false, error: "You can't announce lineups for this season." };
  }
  const { personId, competition } = gated;
  const result = await withTenantDb(dbHandle, { personId, orgId: competition.orgId }, (db) =>
    announceLineup(db, { competitionId: competition.id, fixtureId, teamId, actorId: personId }),
  );
  if (!result.ok) {
    const message: Record<typeof result.reason, string> = {
      not_found: "That match isn't in this season any more.",
      not_a_side: "That team isn't playing in this match.",
      not_upcoming: "This match has started or finished — lineups are only announced before it.",
    };
    return { ok: false, error: message[result.reason] };
  }
  revalidatePath(`/seasons/${slug}/fixtures`);
  return { ok: true, told: result.told };
}
