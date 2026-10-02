import { randomBytes } from "node:crypto";

import { auctionOf } from "@desiauction/auction";
import {
  auctionOwnerInvites,
  auditLog,
  competitions,
  grants,
  newId,
  organizations,
  orgMembers,
  people,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { parseGrantTarget } from "../admin/grant-target";
import { assignAuctioneer, removeAuctioneer } from "../auction/auctioneers";
import { sendEngineCommand } from "../auction/engine-client";
import { hashInviteToken } from "../auction/owner-invite-lookup";
import { createInvite } from "../orgs/invites";
import { holdersOf, issueGrant, lastOwnerRefuses, revokeGrants } from "../orgs/orgs";
import { inOrg } from "../tenant";

/*
 * THE CLUB ROLES DESK — writers behind /admin/orgs/[slug] (AC-1.3).
 *
 * For a club that is stuck: its only owner lost their phone, the person who
 * set it up left, an auctioneer must be swapped on the night, a team owner's
 * link went to the wrong number. Called ONLY from `club-actions.ts`, after
 * `operatorFor` (superadmin capability, a written reason, a fresh step-up).
 *
 * Every write goes through the club's OWN functions (issueGrant, revokeGrants,
 * assignAuctioneer, the engine's owner-link commands) inside the club's
 * boundary on the APP role (`inOrg`) — never the RLS-exempt system pool, which
 * is read-only for tenant data in production. So every rule the club itself
 * lives by (a grant goes to a member; a club always keeps an owner; an
 * auctioneer never owns a team) holds for support too. Each act adds one audit
 * row in the club's own log, with the reason, saying support did it.
 */

export type DeskResult =
  { ok: true; message: string; link?: string } | { ok: false; error: string };

export type ClubRole = "org:owner" | "org:staff";

const ROLE_WORDS: Record<ClubRole, string> = { "org:owner": "an owner", "org:staff": "staff" };

/** OWNER links and club invites are pasted by support into a chat: absolute only at the edge. */
const OWNER_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function clubBySlug(system: Db, slug: string) {
  const [org] = await system
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return org ?? null;
}

/** A person by a PROVEN contact: their phone, or a verified email. */
async function personByContact(system: Db, contact: string) {
  const target = parseGrantTarget(contact);
  if (target.kind === "invalid") {
    return { error: "Enter a 10-digit Indian mobile number or an email address." } as const;
  }
  const [person] = await system
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(
      target.kind === "phone"
        ? eq(people.phone, target.phone)
        : and(sql`lower(${people.email}) = ${target.email}`, isNotNull(people.emailVerifiedAt)),
    )
    .limit(1);
  return { person: person ?? null } as const;
}

async function deskAudit(
  tx: Db,
  orgId: string,
  input: {
    operator: string;
    action: string;
    subject: string;
    reason: string;
    meta?: Record<string, string>;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(),
    actor: input.operator,
    action: input.action,
    scopeType: "org",
    scopeId: orgId,
    subject: input.subject,
    meta: { via: "admin", reason: input.reason, ...input.meta },
  });
}

/**
 * Give someone a club role. A person already on DesiAuction becomes a member
 * (if they were not) and holds the role now; anyone else gets the club's own
 * invitation link for that role, which support forwards and they accept after
 * signing in — the same door every club invite uses.
 */
export async function addClubRole(
  system: Db,
  input: { operator: string; slug: string; contact: string; role: ClubRole; reason: string },
): Promise<DeskResult> {
  const org = await clubBySlug(system, input.slug);
  if (org === null) {
    return { ok: false, error: "That club doesn't exist." };
  }
  const found = await personByContact(system, input.contact);
  if ("error" in found) {
    return { ok: false, error: found.error };
  }
  if (found.person === null) {
    const invite = await inOrg(input.operator, org.id, async (db) => {
      const created = await createInvite(db, org.id, input.operator, input.role);
      await deskAudit(db, org.id, {
        operator: input.operator,
        action: "admin.club.invite_created",
        subject: created.reference,
        reason: input.reason,
        meta: { capabilitySet: input.role },
      });
      return created;
    });
    return {
      ok: true,
      message: `Nobody has signed in with ${input.contact.trim()} yet. Send them this link: they join ${org.name} as ${ROLE_WORDS[input.role]} after signing in. It works for 7 days.`,
      link: `/join/${invite.token}`,
    };
  }
  const person = found.person;
  return inOrg(input.operator, org.id, async (db) => {
    await db
      .insert(orgMembers)
      .values({ orgId: org.id, personId: person.id })
      .onConflictDoNothing();
    if ((await holdersOf(db, org.id, input.role)).includes(person.id)) {
      return {
        ok: true,
        message: `${person.name ?? "They"} already ${input.role === "org:owner" ? "own" : "are staff at"} ${org.name}.`,
      };
    }
    await issueGrant(db, org.id, person.id, input.role, input.operator);
    await deskAudit(db, org.id, {
      operator: input.operator,
      action: "admin.club.role_added",
      subject: person.id,
      reason: input.reason,
      meta: { capabilitySet: input.role },
    });
    return {
      ok: true,
      message: `${person.name ?? "They"} ${input.role === "org:owner" ? "now own" : "are now staff at"} ${org.name}.`,
    };
  });
}

/** Take a club role away. The last owner is never removed (`lastOwnerRefuses`). */
export async function removeClubRole(
  system: Db,
  input: { operator: string; slug: string; personId: string; role: ClubRole; reason: string },
): Promise<DeskResult> {
  const org = await clubBySlug(system, input.slug);
  if (org === null) {
    return { ok: false, error: "That club doesn't exist." };
  }
  return inOrg(input.operator, org.id, async (db) => {
    if (input.role === "org:owner" && (await lastOwnerRefuses(db, org.id, input.personId))) {
      return {
        ok: false,
        error: "That's the club's last owner. Add another owner first, or use Transfer ownership.",
      } as const;
    }
    if (!(await holdersOf(db, org.id, input.role)).includes(input.personId)) {
      return { ok: false, error: "They don't hold that role." } as const;
    }
    await revokeGrants(db, org.id, input.personId, input.role, input.operator);
    await deskAudit(db, org.id, {
      operator: input.operator,
      action: "admin.club.role_removed",
      subject: input.personId,
      reason: input.reason,
      meta: { capabilitySet: input.role },
    });
    return { ok: true, message: "Role removed." } as const;
  });
}

/**
 * Hand the club to someone else in ONE transaction: the new owner is added,
 * then the old one stepped down. Never a moment with no owner; never a
 * transfer to someone who has not signed in (a club cannot wait on a link).
 */
export async function transferOwnership(
  system: Db,
  input: {
    operator: string;
    slug: string;
    fromPersonId: string;
    toContact: string;
    reason: string;
  },
): Promise<DeskResult> {
  const org = await clubBySlug(system, input.slug);
  if (org === null) {
    return { ok: false, error: "That club doesn't exist." };
  }
  const found = await personByContact(system, input.toContact);
  if ("error" in found) {
    return { ok: false, error: found.error };
  }
  if (found.person === null) {
    return {
      ok: false,
      error: `Nobody has signed in with ${input.toContact.trim()} yet. Ask them to sign in to DesiAuction once, then try again.`,
    };
  }
  const to = found.person;
  if (to.id === input.fromPersonId) {
    return { ok: false, error: "That's the same person." };
  }
  return inOrg(input.operator, org.id, async (db) => {
    const owners = await holdersOf(db, org.id, "org:owner", { lock: true });
    if (!owners.includes(input.fromPersonId)) {
      return { ok: false, error: "The person you're transferring from isn't an owner." } as const;
    }
    await db.insert(orgMembers).values({ orgId: org.id, personId: to.id }).onConflictDoNothing();
    if (!owners.includes(to.id)) {
      await issueGrant(db, org.id, to.id, "org:owner", input.operator);
    }
    await revokeGrants(db, org.id, input.fromPersonId, "org:owner", input.operator);
    await deskAudit(db, org.id, {
      operator: input.operator,
      action: "admin.club.ownership_transferred",
      subject: to.id,
      reason: input.reason,
      meta: { from: input.fromPersonId },
    });
    return { ok: true, message: `${to.name ?? "They"} now own ${org.name}.` } as const;
  });
}

async function seasonOf(system: Db, orgId: string, seasonId: string) {
  const [season] = await system
    .select({ id: competitions.id, name: competitions.name })
    .from(competitions)
    .where(and(eq(competitions.id, seasonId), eq(competitions.orgId, orgId)))
    .limit(1);
  return season ?? null;
}

const AUCTIONEER_REFUSAL: Record<string, string> = {
  not_a_member: "They aren't a member of this club. Add them as staff first.",
  already_assigned: "They're already this season's auctioneer.",
  not_assigned: "They aren't this season's auctioneer.",
  team_owner: "They own a team in this season, and an auctioneer can't.",
};

export async function setAuctioneer(
  system: Db,
  input: {
    operator: string;
    slug: string;
    seasonId: string;
    personId: string;
    assign: boolean;
    reason: string;
  },
): Promise<DeskResult> {
  const org = await clubBySlug(system, input.slug);
  if (org === null) {
    return { ok: false, error: "That club doesn't exist." };
  }
  const season = await seasonOf(system, org.id, input.seasonId);
  if (season === null) {
    return { ok: false, error: "That season isn't this club's." };
  }
  return inOrg(input.operator, org.id, async (db) => {
    const args = {
      orgId: org.id,
      competitionId: season.id,
      personId: input.personId,
      actorId: input.operator,
    };
    const result = input.assign
      ? await assignAuctioneer(db, args)
      : await removeAuctioneer(db, args);
    if (!result.ok) {
      return { ok: false, error: AUCTIONEER_REFUSAL[result.reason] ?? "Refused." } as const;
    }
    await deskAudit(db, org.id, {
      operator: input.operator,
      action: input.assign ? "admin.club.auctioneer_assigned" : "admin.club.auctioneer_removed",
      subject: input.personId,
      reason: input.reason,
      meta: { competitionId: season.id },
    });
    return {
      ok: true,
      message: input.assign
        ? `They're now the auctioneer for ${season.name}.`
        : `They're no longer the auctioneer for ${season.name}.`,
    } as const;
  });
}

/**
 * A FRESH TEAM-OWNER LINK — when the first went to the wrong number or never
 * arrived. Every unaccepted link for the team is withdrawn, then a new one is
 * minted; both through the auction engine, the single writer of the auction's
 * owner workflow. A team whose owner already joined needs no link.
 */
export async function reissueTeamOwnerLink(
  system: Db,
  input: { operator: string; slug: string; seasonId: string; teamId: string; reason: string },
): Promise<DeskResult> {
  const org = await clubBySlug(system, input.slug);
  if (org === null) {
    return { ok: false, error: "That club doesn't exist." };
  }
  const season = await seasonOf(system, org.id, input.seasonId);
  if (season === null) {
    return { ok: false, error: "That season isn't this club's." };
  }
  const auction = await auctionOf(system, season.id);
  if (auction === null) {
    return { ok: false, error: "This season has no auction yet." };
  }
  const [team] = await system
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, input.teamId), eq(teams.competitionId, season.id)))
    .limit(1);
  if (team === undefined) {
    return { ok: false, error: "That team isn't in this season." };
  }
  const links = await system
    .select({ id: auctionOwnerInvites.id, acceptedAt: auctionOwnerInvites.acceptedAt })
    .from(auctionOwnerInvites)
    .where(
      and(
        eq(auctionOwnerInvites.auctionId, auction.id),
        eq(auctionOwnerInvites.teamId, team.id),
        isNull(auctionOwnerInvites.revokedAt),
      ),
    );
  if (links.some((link) => link.acceptedAt !== null)) {
    return { ok: false, error: `${team.name}'s owner has already joined — no new link is needed.` };
  }
  for (const link of links) {
    const revoked = await sendEngineCommand({
      auctionId: auction.id,
      type: "RevokeOwnerInvite",
      actor: input.operator,
      conduct: true,
      manage: true,
      payload: { inviteId: link.id },
    });
    if (!revoked.accepted) {
      return { ok: false, error: "Couldn't withdraw the old link. Try again in a moment." };
    }
  }
  const token = randomBytes(24).toString("base64url");
  const minted = await sendEngineCommand({
    auctionId: auction.id,
    type: "InviteOwner",
    actor: input.operator,
    conduct: true,
    payload: {
      teamId: team.id,
      tokenHash: hashInviteToken(token),
      expiresAtMs: Date.now() + OWNER_LINK_TTL_MS,
    },
  });
  if (!minted.accepted) {
    return {
      ok: false,
      error:
        minted.reason === "terminal_auction"
          ? "This season's auction is over."
          : "Couldn't make a new link. Try again in a moment.",
    };
  }
  await inOrg(input.operator, org.id, (db) =>
    deskAudit(db, org.id, {
      operator: input.operator,
      action: "admin.club.owner_link_reissued",
      subject: team.id,
      reason: input.reason,
      meta: { competitionId: season.id, withdrawn: String(links.length) },
    }),
  );
  return {
    ok: true,
    message: `A new owner link for ${team.name}. The old one${links.length === 1 ? " no longer works" : "s no longer work"}. Send this one to the team's owner; it works for 7 days.`,
    link: `/owner-join/${token}`,
  };
}

// --- The desk's read: seasons, their auctioneers and teams ------------------------------

export interface ClubDesk {
  readonly owners: readonly string[];
  readonly staff: readonly string[];
  readonly seasons: readonly {
    id: string;
    name: string;
    auctioneers: readonly { personId: string; name: string | null }[];
    teams: readonly { id: string; name: string; ownerJoined: boolean }[];
  }[];
}

/** What the desk needs beyond the club page's own read. System pool, read only. */
export async function clubDesk(system: Db, orgId: string): Promise<ClubDesk> {
  const seasonRows = await system
    .select({ id: competitions.id, name: competitions.name })
    .from(competitions)
    .where(eq(competitions.orgId, orgId))
    .orderBy(asc(competitions.createdAt))
    .limit(50);
  const seasonIds = seasonRows.map((row) => row.id);
  const [teamRows, auctioneerRows, joinedRows, ownerRows, staffRows] = await Promise.all([
    seasonIds.length === 0
      ? Promise.resolve([])
      : system
          .select({ id: teams.id, name: teams.name, seasonId: teams.competitionId })
          .from(teams)
          .where(inArray(teams.competitionId, seasonIds))
          .orderBy(asc(teams.name)),
    seasonIds.length === 0
      ? Promise.resolve([])
      : system
          .select({ seasonId: grants.scopeId, personId: grants.personId, name: people.name })
          .from(grants)
          .innerJoin(people, eq(people.id, grants.personId))
          .where(
            and(
              inArray(grants.scopeId, seasonIds),
              eq(grants.capabilitySet, "auction:conductor"),
              isNull(grants.revokedAt),
            ),
          ),
    seasonIds.length === 0
      ? Promise.resolve([])
      : system
          .select({ teamId: auctionOwnerInvites.teamId })
          .from(auctionOwnerInvites)
          .where(
            and(
              isNotNull(auctionOwnerInvites.acceptedAt),
              isNull(auctionOwnerInvites.revokedAt),
              sql`${auctionOwnerInvites.auctionId} in (select a.id from auctions a where a.kind = 'real' and a.competition_id in ${seasonIds})`,
            ),
          ),
    holdersOf(system, orgId, "org:owner"),
    holdersOf(system, orgId, "org:staff"),
  ]);
  const joined = new Set(joinedRows.map((row) => row.teamId));
  return {
    owners: ownerRows,
    staff: staffRows,
    seasons: seasonRows.map((season) => ({
      id: season.id,
      name: season.name,
      auctioneers: auctioneerRows
        .filter((row) => row.seasonId === season.id)
        .map((row) => ({ personId: row.personId, name: row.name })),
      teams: teamRows
        .filter((row) => row.seasonId === season.id)
        .map((row) => ({ id: row.id, name: row.name, ownerJoined: joined.has(row.id) })),
    })),
  };
}
