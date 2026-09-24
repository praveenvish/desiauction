"use server";

import { currentSession } from "../../server/auth/actions";
import { posterGateFor } from "../../server/competition/posters";
import { publicPlayerCard, publicTeam } from "../../server/competition/public";

/**
 * May the person looking at this public card save it as a Status image?
 *
 * The pages are public and cached, so they cannot ask who is looking; the share
 * sheet asks this after it mounts. The answer is the poster route's own rule
 * (`posterGateFor`): the player themselves or the team's owner, or whoever
 * holds `registration.review` over the season. It returns only an ADDRESS — the
 * route behind it runs the gate again and writes the audit row when the bytes
 * are drawn, so this answer is a convenience, never the authorization.
 *
 * Null for a stranger, a signed-out visitor, or anything that fails: the sheet
 * then offers the link, which is theirs to share anyway.
 */
export async function ownPlayerStatusHref(slug: string, number: string): Promise<string | null> {
  try {
    const session = await currentSession();
    if (session === null) {
      return null;
    }
    const card = await publicPlayerCard(slug, number);
    if (card === null) {
      return null;
    }
    const gate = await posterGateFor(session.personId, slug);
    if ("ok" in gate) {
      return null;
    }
    const registrationId = card.player.registrationId;
    const mine = gate.grant.organizer || gate.grant.ownRegistrationIds.includes(registrationId);
    return mine
      ? `/seasons/${encodeURIComponent(slug)}/posters/player/${encodeURIComponent(registrationId)}?size=story`
      : null;
  } catch {
    return null;
  }
}

/** The same question for a squad sheet: its owner, or the organizer. */
export async function ownTeamStatusHref(slug: string, teamSlug: string): Promise<string | null> {
  try {
    const session = await currentSession();
    if (session === null) {
      return null;
    }
    const team = await publicTeam(slug, teamSlug);
    if (team === null) {
      return null;
    }
    const gate = await posterGateFor(session.personId, slug);
    if ("ok" in gate) {
      return null;
    }
    const mine = gate.grant.organizer || gate.grant.ownTeamIds.includes(team.team.id);
    return mine
      ? `/seasons/${encodeURIComponent(slug)}/posters/team/${encodeURIComponent(team.team.id)}?size=story`
      : null;
  } catch {
    return null;
  }
}
