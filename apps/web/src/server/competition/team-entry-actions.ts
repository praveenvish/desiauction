"use server";

import { teamEntries, withTenantDb } from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { canCompetition } from "./authz";
import { resolveMemberCompetition } from "./resolve";
import { reviewTeamEntry, submitTeamEntry } from "./team-entries";
import { entryCompetitionByCode } from "./team-entry-resolver";

export async function submitTeamEntryAction(code: string, raw: unknown) {
  const session = await currentSession();
  if (session === null) return { ok: false, error: "Sign in to submit your team." };
  const season = await entryCompetitionByCode(code);
  if (season === null)
    return {
      ok: false,
      error: "This team sign-up link is unavailable. Ask the organizer for a current link.",
    };
  try {
    await withTenantDb(dbHandle, { personId: session.personId, orgId: season.orgId }, (db) =>
      submitTeamEntry(
        db,
        { orgId: season.orgId, competitionId: season.id },
        session.personId,
        code,
        raw,
      ),
    );
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        "Your team could not be submitted. Check the names and mobile numbers, and ask the organizer for a current link.",
    };
  }
}

export async function teamEntriesView(slug: string) {
  const session = await currentSession();
  if (session === null) return null;
  const season = await resolveMemberCompetition(session.personId, slug);
  if (season === null || season.teamFormation !== "team_entry") return null;
  return withTenantDb(dbHandle, { personId: session.personId, orgId: season.orgId }, async (db) => {
    const allowed = await canCompetition(
      db,
      session.personId,
      { orgId: season.orgId, competitionId: season.id },
      "team.manage",
    );
    if (!allowed) return null;
    const entries = await db
      .select({
        id: teamEntries.id,
        teamName: teamEntries.teamName,
        players: teamEntries.players,
        status: teamEntries.status,
      })
      .from(teamEntries)
      .where(and(eq(teamEntries.orgId, season.orgId), eq(teamEntries.competitionId, season.id)));
    return { code: season.entryCode ?? null, entries };
  });
}

export async function reviewTeamEntryAction(
  slug: string,
  entryId: string,
  decision: string,
  reason: string,
) {
  const session = await currentSession();
  if (session === null) return { ok: false, error: "Sign in to review teams." };
  if (decision !== "approve" && decision !== "reject")
    return { ok: false, error: "Choose approve or reject." };
  const season = await resolveMemberCompetition(session.personId, slug);
  if (season === null) return { ok: false, error: "Team entry unavailable." };
  try {
    await withTenantDb(dbHandle, { personId: session.personId, orgId: season.orgId }, (db) =>
      reviewTeamEntry(
        db,
        { orgId: season.orgId, competitionId: season.id },
        session.personId,
        entryId,
        decision,
        reason,
      ),
    );
    revalidatePath(`/seasons/${slug}/teams`);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        "The team could not be reviewed. Check for duplicate players or names and give a reason when rejecting.",
    };
  }
}
