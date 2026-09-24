"use server";

import { withTenantDb } from "@desiauction/db";
import { revalidatePath } from "next/cache";

import { currentSession } from "../auth/actions";
import { resolveMemberCompetition } from "../competition/resolve";
import { dbHandle } from "../db";
import {
  assignAuctioneer,
  auctioneerCandidates,
  auctioneersOf,
  removeAuctioneer,
  type AuctioneerRow,
} from "./auctioneers";
import { personCan } from "../request-cache";

/**
 * Who may appoint an auctioneer: whoever may issue grants in the club
 * (grant.issue — the club's owners). Everyone else sees no panel at all: a
 * control that refuses is a map of what the club can do.
 */
async function gate(slug: string) {
  const session = await currentSession();
  if (session === null) return null;
  const competition = await resolveMemberCompetition(session.personId, slug);
  if (competition === null) return null;
  const allowed = await personCan(
    session.personId,
    { scopeType: "org", scopeId: competition.orgId },
    "grant.issue",
  );
  return allowed ? { personId: session.personId, competition } : null;
}

export interface AuctioneerPanelView {
  auctioneers: AuctioneerRow[];
  candidates: { personId: string; name: string }[];
}

export async function auctioneerPanelView(slug: string): Promise<AuctioneerPanelView | null> {
  const gated = await gate(slug);
  if (gated === null) return null;
  const { personId, competition } = gated;
  return withTenantDb(dbHandle, { personId, orgId: competition.orgId }, async (db) => {
    const [auctioneers, candidates] = await Promise.all([
      auctioneersOf(db, competition.id),
      auctioneerCandidates(db, competition.orgId, competition.id),
    ]);
    return { auctioneers, candidates };
  });
}

const REFUSAL = {
  not_a_member: "They need to be a member of the club first — invite them from the club page.",
  already_assigned: "They're already an auctioneer for this season.",
  team_owner:
    "They own a team in this season. The auctioneer sees every team's purse, so it has to be someone without a team.",
  not_assigned: "They weren't an auctioneer for this season.",
} as const;

export async function assignAuctioneerAction(
  slug: string,
  personId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gated = await gate(slug);
  if (gated === null)
    return { ok: false, error: "Only the club's owners can appoint an auctioneer." };
  const { competition } = gated;
  const result = await withTenantDb(
    dbHandle,
    { personId: gated.personId, orgId: competition.orgId },
    (db) =>
      assignAuctioneer(db, {
        orgId: competition.orgId,
        competitionId: competition.id,
        personId,
        actorId: gated.personId,
      }),
  );
  if (!result.ok) return { ok: false, error: REFUSAL[result.reason] };
  revalidatePath(`/seasons/${slug}/auction`);
  return { ok: true };
}

export async function removeAuctioneerAction(
  slug: string,
  personId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gated = await gate(slug);
  if (gated === null)
    return { ok: false, error: "Only the club's owners can change the auctioneer." };
  const { competition } = gated;
  const result = await withTenantDb(
    dbHandle,
    { personId: gated.personId, orgId: competition.orgId },
    (db) =>
      removeAuctioneer(db, {
        orgId: competition.orgId,
        competitionId: competition.id,
        personId,
        actorId: gated.personId,
      }),
  );
  if (!result.ok) return { ok: false, error: REFUSAL[result.reason] };
  revalidatePath(`/seasons/${slug}/auction`);
  return { ok: true };
}
