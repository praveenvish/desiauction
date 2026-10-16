"use server";

import { organizations } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { systemDb } from "../db";
import { platformGrantGate } from "../admin/authz";
import {
  addClubRole,
  clubDesk,
  reissueTeamOwnerLink,
  removeClubRole,
  setAuctioneer,
  transferOwnership,
  type ClubDesk,
  type ClubRole,
  type DeskResult,
} from "./club";
import { createClubAsOperator } from "./create-club";
import { operatorFor, type OperatorRefusal } from "./guard";
import { moveDesk, moveTournament, type MoveDesk } from "./move-tournament";

/*
 * THE CLUB ROLES DESK'S BUTTONS (AC-1.3). Superadmin only (`platform.grant`):
 * making somebody a club's owner hands them its money, so it is not a desk
 * for every support operator. Each passes `operatorFor` — capability, reason,
 * fresh step-up — before `club.ts` writes inside the club's own boundary.
 */

export type ClubDeskResult = DeskResult | OperatorRefusal;

function isClubRole(value: string): value is ClubRole {
  return value === "org:owner" || value === "org:staff";
}

/* No server-side revalidation: the desk refreshes itself (router.refresh), like
   every admin desk — the page is dynamic, so there is no cache to invalidate. */
function done(_slug: string, result: DeskResult): ClubDeskResult {
  return result;
}

export async function addClubRoleAction(input: {
  slug: string;
  contact: string;
  role: string;
  reason: string;
}): Promise<ClubDeskResult> {
  const gate = await operatorFor("platform.grant", { reason: input.reason });
  if (!gate.ok) {
    return gate;
  }
  if (!isClubRole(input.role)) {
    return { ok: false, error: "Pick owner or staff." };
  }
  return done(
    input.slug,
    await addClubRole(systemDb, {
      operator: gate.operator.personId,
      slug: input.slug,
      contact: input.contact,
      role: input.role,
      reason: gate.operator.reason,
    }),
  );
}

export async function removeClubRoleAction(input: {
  slug: string;
  personId: string;
  role: string;
  reason: string;
}): Promise<ClubDeskResult> {
  const gate = await operatorFor("platform.grant", { reason: input.reason });
  if (!gate.ok) {
    return gate;
  }
  if (!isClubRole(input.role)) {
    return { ok: false, error: "Pick owner or staff." };
  }
  return done(
    input.slug,
    await removeClubRole(systemDb, {
      operator: gate.operator.personId,
      slug: input.slug,
      personId: input.personId,
      role: input.role,
      reason: gate.operator.reason,
    }),
  );
}

export async function transferOwnershipAction(input: {
  slug: string;
  fromPersonId: string;
  toContact: string;
  reason: string;
}): Promise<ClubDeskResult> {
  const gate = await operatorFor("platform.grant", { reason: input.reason });
  if (!gate.ok) {
    return gate;
  }
  return done(
    input.slug,
    await transferOwnership(systemDb, {
      operator: gate.operator.personId,
      slug: input.slug,
      fromPersonId: input.fromPersonId,
      toContact: input.toContact,
      reason: gate.operator.reason,
    }),
  );
}

export async function setAuctioneerAction(input: {
  slug: string;
  seasonId: string;
  personId: string;
  assign: boolean;
  reason: string;
}): Promise<ClubDeskResult> {
  const gate = await operatorFor("platform.grant", { reason: input.reason });
  if (!gate.ok) {
    return gate;
  }
  return done(
    input.slug,
    await setAuctioneer(systemDb, {
      operator: gate.operator.personId,
      slug: input.slug,
      seasonId: input.seasonId,
      personId: input.personId,
      assign: input.assign,
      reason: gate.operator.reason,
    }),
  );
}

export async function reissueOwnerLinkAction(input: {
  slug: string;
  seasonId: string;
  teamId: string;
  reason: string;
}): Promise<ClubDeskResult> {
  const gate = await operatorFor("platform.grant", { reason: input.reason });
  if (!gate.ok) {
    return gate;
  }
  return done(
    input.slug,
    await reissueTeamOwnerLink(systemDb, {
      operator: gate.operator.personId,
      slug: input.slug,
      seasonId: input.seasonId,
      teamId: input.teamId,
      reason: gate.operator.reason,
    }),
  );
}

/** The desk's read, for the club page — null for anyone but a superadmin. */
export async function adminClubDesk(slug: string): Promise<ClubDesk | null> {
  if ((await platformGrantGate()) === null) {
    return null;
  }
  const [org] = await systemDb
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return org === undefined ? null : clubDesk(systemDb, org.id);
}

/**
 * Move a tournament (every season under it) or a one-off season to another
 * club. Superadmin, reason, step-up — then the database's own move function.
 */
export async function moveTournamentAction(input: {
  slug: string;
  subjectKind: string;
  subjectId: string;
  targetSlug: string;
  reason: string;
}): Promise<ClubDeskResult & { targetSlug?: string }> {
  const gate = await operatorFor("platform.grant", { reason: input.reason });
  if (!gate.ok) {
    return gate;
  }
  if (input.subjectKind !== "tournament" && input.subjectKind !== "season") {
    return { ok: false, error: "Pick a tournament or season to move." };
  }
  return moveTournament(systemDb, {
    operator: gate.operator.personId,
    slug: input.slug,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    targetSlug: input.targetSlug,
    reason: gate.operator.reason,
  });
}

/** Start a club from /admin/orgs; the operator owns it, like any organizer. */
export async function createClubAction(input: {
  name: string;
  reason: string;
}): Promise<ClubDeskResult & { slug?: string }> {
  const gate = await operatorFor("platform.grant", { reason: input.reason });
  if (!gate.ok) {
    return gate;
  }
  return createClubAsOperator({
    operator: gate.operator.personId,
    name: input.name,
    reason: gate.operator.reason,
  });
}

/** The move desk's read — null for anyone but a superadmin. */
export async function adminMoveDesk(slug: string): Promise<MoveDesk | null> {
  if ((await platformGrantGate()) === null) {
    return null;
  }
  const [org] = await systemDb
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return org === undefined ? null : moveDesk(systemDb, org.id);
}

/** Whether this viewer may start clubs from /admin/orgs. */
export async function canCreateClubFromAdmin(): Promise<boolean> {
  return (await platformGrantGate()) !== null;
}
