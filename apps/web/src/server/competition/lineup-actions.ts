"use server";

import { roleLabelIn, sportPackFor } from "@desiauction/core";
import { withTenantDb } from "@desiauction/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { canCompetition } from "./authz";
import {
  lineupFixtures,
  lineupSides,
  saveLineup,
  type LineupFixture,
  type LineupSide,
} from "./lineups";
import { resolveMemberCompetition } from "./resolve";

/**
 * Lineups are an organizer's record, gated on `fixture.manage` — the same key
 * that records a result. Squads are rosters, and a roster is not something a
 * plain member or a rival owner reads (teams tab, canSeeRoster), so this page
 * is a 404 for anyone who cannot manage fixtures rather than a read-only view.
 */
export interface LineupPageView {
  competition: { name: string; slug: string };
  fixtures: LineupFixture[];
  selected: LineupFixture | null;
  sides: LineupSide[];
}

async function gate(slug: string) {
  const session = await currentSession();
  if (session === null) {
    redirect(`/login?next=/seasons/${slug}/lineups`);
  }
  const competition = await resolveMemberCompetition(session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const allowed = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    (db) => canCompetition(db, session.personId, scope, "fixture.manage"),
  );
  return allowed ? { personId: session.personId, competition } : null;
}

export async function lineupPageView(
  slug: string,
  fixtureId: string | null,
): Promise<LineupPageView | null> {
  const gated = await gate(slug);
  if (gated === null) {
    return null;
  }
  const { personId, competition } = gated;
  return withTenantDb(dbHandle, { personId, orgId: competition.orgId }, async (db) => {
    const list = await lineupFixtures(db, competition.id);
    // The match asked for, else the first one still missing a side's lineup,
    // else the first — the page always opens on something worth doing.
    const selected =
      list.find((fixture) => fixture.id === fixtureId) ??
      list.find((fixture) => fixture.recorded.home === null || fixture.recorded.away === null) ??
      list[0] ??
      null;
    const pack = sportPackFor(competition.sport);
    const sides =
      selected === null
        ? []
        : (await lineupSides(db, competition.id, selected)).map((side) => ({
            ...side,
            // The season's own role words ("Raider", "Striker"), never the key.
            players: side.players.map((player) => ({
              ...player,
              role: player.role === null ? null : roleLabelIn(pack, player.role),
            })),
          }));
    return {
      competition: { name: competition.name, slug: competition.slug },
      fixtures: list,
      selected,
      sides,
    };
  });
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
  revalidatePath(`/seasons/${slug}/lineups`);
  return { ok: true, played: result.played };
}
