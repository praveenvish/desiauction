"use server";

import { isCapabilitySet } from "@desiauction/core";
import {
  auctions,
  auditLog,
  competitions,
  grants,
  newId,
  organizations,
  orgMembers,
  people,
  teams,
  withTenantDb,
} from "@desiauction/db";
import { isFinopsCapabilitySet } from "@desiauction/financial-operations";
import { isSettlementCapabilitySet } from "@desiauction/settlement";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { personLabel } from "../../lib/person-label";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { canFinops } from "../financial-operations/authz";
import { canSettlement } from "../settlement/authz";
import { ForbiddenError, can, requireCapability } from "./authz";
import {
  acceptInvite,
  createInvite,
  inviteLanding,
  pendingInvitesOf,
  previewInvite,
  revokeInvite,
  type InviteLanding,
  type PendingInvite,
} from "./invites";
import {
  createOrg,
  holdersOf,
  issueGrant,
  memberCountOf,
  membersOf,
  orgsFor,
  removeMember,
  resolveTenant,
  revokeGrants,
  wouldOrphanOrg,
  type MemberRow,
  type OrgSummary,
} from "./orgs";

// Org-scoped internal RPC (IP-2 D7). Every action resolves the tenant from
// the slug, requires the capability, then acts — no other path exists.
//
// PRP-1 §1: every step runs inside a withTenantDb boundary. Resolution runs
// under person context (organizations carries no RLS; the org_members
// membership check passes on the person arm); org-scoped work runs under
// {personId, orgId} set only AFTER resolveTenant proved membership. The two
// pre-tenant token paths (invite preview/accept) are the documented exception
// and run on the system pool — the invite token itself is the capability.

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

/** Membership-checked slug → org under person-only tenant context. */
async function resolveTenantScoped(personId: string, slug: string): Promise<OrgSummary | null> {
  return withTenantDb(dbHandle, { personId }, (db) => resolveTenant(db, personId, slug));
}

export async function myOrgs(): Promise<OrgSummary[]> {
  const session = await requireSession();
  return withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    orgsFor(db, session.personId),
  );
}

export interface OrgCard extends OrgSummary {
  /**
   * Seasons, not tournaments. A club with two seasons and seven members read
   * "0 tourns · 6 teams" — the one figure it led with was the one that stays
   * zero for anybody running one-off seasons, which is most people.
   */
  seasons: number;
  teams: number;
  members: number;
  /** The viewer's standing here — "Owner", "Staff", or "Member". */
  role: string;
}

/**
 * The organizations list with the two counts and the role badge the design
 * shows. Counts are grouped reads over the whole membership set, not a query
 * per card.
 *
 * Role comes from the viewer's own capability sets on THIS org, so the badge
 * states what they can do rather than repeating a name they can already read.
 */
export async function myOrgCards(): Promise<OrgCard[]> {
  const session = await requireSession();
  const orgs = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    orgsFor(db, session.personId),
  );
  if (orgs.length === 0) {
    return [];
  }
  const orgIds = orgs.map((org) => org.id);
  // Cross-org union scoped by the membership already proven above — the same
  // system-pool pattern the competitions and tournaments lists use.
  const [seasonRows, teamRows, memberRows, grantRows] = await Promise.all([
    systemDb
      .select({ orgId: competitions.orgId, count: sql<number>`count(*)::int` })
      .from(competitions)
      .where(inArray(competitions.orgId, orgIds))
      .groupBy(competitions.orgId),
    systemDb
      .select({ orgId: teams.orgId, count: sql<number>`count(*)::int` })
      .from(teams)
      .where(inArray(teams.orgId, orgIds))
      .groupBy(teams.orgId),
    systemDb
      .select({ orgId: orgMembers.orgId, count: sql<number>`count(*)::int` })
      .from(orgMembers)
      .where(inArray(orgMembers.orgId, orgIds))
      .groupBy(orgMembers.orgId),
    systemDb
      .select({ scopeId: grants.scopeId, capabilitySet: grants.capabilitySet })
      .from(grants)
      .where(
        and(
          eq(grants.personId, session.personId),
          eq(grants.scopeType, "org"),
          inArray(grants.scopeId, orgIds),
          isNull(grants.revokedAt),
        ),
      ),
  ]);
  const seasonsBy = new Map(seasonRows.map((row) => [row.orgId, row.count]));
  const teamsBy = new Map(teamRows.map((row) => [row.orgId, row.count]));
  const membersBy = new Map(memberRows.map((row) => [row.orgId, row.count]));
  const setsBy = new Map<string, string[]>();
  for (const row of grantRows) {
    setsBy.set(row.scopeId, [...(setsBy.get(row.scopeId) ?? []), row.capabilitySet]);
  }
  return orgs.map((org) => {
    const sets = setsBy.get(org.id) ?? [];
    return {
      ...org,
      seasons: seasonsBy.get(org.id) ?? 0,
      teams: teamsBy.get(org.id) ?? 0,
      members: membersBy.get(org.id) ?? 0,
      role: sets.includes("org:owner") ? "Owner" : sets.includes("org:staff") ? "Staff" : "Member",
    };
  });
}

/**
 * Edit the About banner. Gated on `org.manage` (owners): the description is the
 * club's public-facing words, so who may set them is the same trust as who runs
 * the org. Capped so a paragraph stays a paragraph.
 */
export async function updateOrgDescriptionAction(
  slug: string,
  description: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return { ok: false, error: "Not available." };
  }
  const trimmed = description.trim().slice(0, 600);
  try {
    await withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
      await requireCapability(
        db,
        session.personId,
        { scopeType: "org", scopeId: org.id },
        "org.manage",
      );
      await db
        .update(organizations)
        .set({ description: trimmed === "" ? null : trimmed })
        .where(eq(organizations.id, org.id));
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You can't edit this organization." };
    }
    return { ok: false, error: "Could not save." };
  }
}

/**
 * WHY THIS RETURNS A DESTINATION INSTEAD OF CALLING `redirect()`.
 *
 * It used to end in `redirect(`/org/${slug}`)`, which is the idiomatic shape
 * and which DOES issue a correct 303 — the organization is created and the
 * server names where to go. The client never got there.
 *
 * The form lives in a `FormDialog` rendered by the `@action` PARALLEL ROUTE
 * slot (`app/@action/orgs/page.tsx`). Completing a server-action redirect away
 * from `/orgs` requires that slot to swap to its `default`, which unmounts the
 * component whose action is still awaiting the transition — and the router
 * abandons the navigation instead. The RSC request for the destination is
 * aborted, no error is raised on either side, and `useActionState` is left
 * `pending` forever: a submit button disabled for good on a form whose write
 * already succeeded.
 *
 * Measured, not guessed. With the slot's `page.tsx` removed the identical
 * redirect completes; with it present it never does, whether the form sits in
 * the slot or in the page's own children, whether the dialog is open or closed,
 * and with `RedirectType.replace` as well as the default push. A segment-level
 * `default.tsx` does not help either.
 *
 * So the navigation is handed to the client, which owns the router and is not
 * torn down by its own transition. `createOrgAction` reports WHERE to go;
 * `CreateOrgForm` goes there. Do the same for any other action that redirects
 * off `/home`, `/orgs` or `/tournaments` — the three routes with an action slot.
 */
export async function createOrgAction(
  _previous: { error?: string; created?: string; name?: string },
  formData: FormData,
): Promise<{ error?: string; created?: string; name?: string }> {
  const session = await requireSession();
  const name = formData.get("name");
  const typed = typeof name === "string" ? name : "";
  const orgId = newId();
  try {
    const org = await withTenantDb(dbHandle, { personId: session.personId, orgId }, (db) =>
      createOrg(db, session.personId, typed, orgId),
    );
    return { created: org.slug };
  } catch {
    /*
     * The name comes back with the refusal. The field is uncontrolled, so React
     * resets it when the action returns — a name typed and rejected was wiped,
     * and the reader had to type it again to read what was wrong with it.
     */
    return { error: "Give the organization a name of at least 3 characters.", name: typed };
  }
}

export interface OrgView {
  org: OrgSummary;
  /**
   * The directory — EMPTY unless the viewer is allowed to hold it. Membership
   * gets you the org; it does not get you everybody's phone number.
   */
  members: MemberRow[];
  /** How many people belong here, whether or not the directory came with it. */
  memberCount: number;
  /** Live invite links, for whoever may mint them. Never the token itself. */
  pendingInvites: PendingInvite[];
  viewer: {
    personId: string;
    canInvite: boolean;
    canIssueGrants: boolean;
    /** True exactly when `members` is populated — the page must not guess. */
    canSeeMembers: boolean;
    /** `org.members.remove` — offboarding, owners only. */
    canRemove: boolean;
    /** `tournament.create` — whether the hero's CTA can actually succeed. */
    canCreateTournament: boolean;
  };
}

/**
 * Tenant resolution + view assembly; non-members see nothing (null).
 *
 * The directory is gated HERE, in the payload, not in the markup. A plain
 * member used to receive every colleague's name, raw E.164 phone, join date and
 * full grant set because `membersOf` ran unconditionally and only the buttons
 * were permission-checked. Hiding a phone book with CSS does not hide it: it is
 * in the RSC payload, in view-source, in the network tab.
 */
export async function orgView(slug: string): Promise<OrgView | null> {
  const session = await requireSession();
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return null;
  }
  const scope = { scopeType: "org" as const, scopeId: org.id };
  return withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
    const [canInvite, canIssueGrants, canRemove, canCreateTournament, memberCount] =
      await Promise.all([
        can(db, session.personId, scope, "org.members.invite"),
        can(db, session.personId, scope, "grant.issue"),
        can(db, session.personId, scope, "org.members.remove"),
        can(db, session.personId, scope, "tournament.create"),
        memberCountOf(db, org.id),
      ]);
    // Whoever may invite or may hand out roles needs to see who is already
    // here — that is the whole job. Nobody else does.
    const canSeeMembers = canInvite || canIssueGrants;
    const [members, pendingInvites] = await Promise.all([
      canSeeMembers ? membersOf(db, org.id) : Promise.resolve([]),
      canInvite ? pendingInvitesOf(db, org.id) : Promise.resolve([]),
    ]);
    return {
      org,
      members,
      memberCount,
      pendingInvites,
      viewer: {
        personId: session.personId,
        canInvite,
        canIssueGrants,
        canSeeMembers,
        canRemove,
        canCreateTournament,
      },
    };
  });
}

export interface OrgActivityRow {
  id: string;
  action: string;
  subject: string;
  /** Who the entry is ABOUT, named — null when the viewer may not be told. */
  subjectName: string | null;
  /** Who did it, named — same gate. */
  actorName: string | null;
  at: string;
}

/**
 * Audit actions that describe the MONEY: what was collected, closed, attested
 * or exported. Reading them is `settlement.view` / `finops.view` work — they
 * were on the Overview of every member of every org.
 */
function isMoneyAction(action: string): boolean {
  const domain = action.split(".")[0] ?? "";
  return domain === "finops" || domain === "settlement" || domain === "payment";
}

/** Rows shown, and rows read so the capability filter still fills the panel. */
const ACTIVITY_PAGE = 6;
const ACTIVITY_SCAN = 40;

export interface OrgOverview {
  /** ISO — the header's "Est. {year}" and nothing more precise is shown. */
  createdAt: string;
  /** The viewer's standing here: "Owner" | "Staff" | "Member". */
  role: string;
  /** The club's own words for the About banner; null until someone writes them. */
  description: string | null;
  /** Whether the viewer may edit the description (org.manage — owners). */
  canManage: boolean;
  /** Tournaments with an auction running right now (the LIVE rows). */
  liveAuctions: { slug: string; name: string }[];
  /** The org's own audit trail, newest first. */
  activity: OrgActivityRow[];
}

/**
 * The Overview header + panels that the catalogue and member reads don't
 * already cover: when the club was founded, the viewer's standing, what is live
 * right now, and the recent activity. All gated behind the same tenant
 * resolution as orgView — a non-member gets null.
 */
export async function orgOverview(slug: string): Promise<OrgOverview | null> {
  const session = await requireSession();
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return null;
  }
  // createdAt/description sit outside RLS (organizations has no policy; a grant
  // read is person-scoped), so they run on the system pool like the catalogue.
  const [orgRow] = await systemDb
    .select({ createdAt: organizations.createdAt, description: organizations.description })
    .from(organizations)
    .where(eq(organizations.id, org.id))
    .limit(1);
  // One tenant boundary for every permission the Overview depends on: whether
  // the description is editable, whether the directory (and so the NAMES in the
  // activity feed) may be read, and whether the money's own trail may be.
  const [canManage, canSeeMembers, canSeeMoney] = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: org.id },
    async (db) => {
      const scope = { scopeType: "org" as const, scopeId: org.id };
      const [manage, invite, issue, settlementView, finopsView] = await Promise.all([
        can(db, session.personId, scope, "org.manage"),
        can(db, session.personId, scope, "org.members.invite"),
        can(db, session.personId, scope, "grant.issue"),
        canSettlement(db, session.personId, org.id, "settlement.view"),
        canFinops(db, session.personId, org.id, "finops.view"),
      ]);
      return [manage, invite || issue, settlementView || finopsView] as const;
    },
  );
  const [grantRows, liveRows, activityRows] = await Promise.all([
    systemDb
      .select({ capabilitySet: grants.capabilitySet })
      .from(grants)
      .where(
        and(
          eq(grants.personId, session.personId),
          eq(grants.scopeType, "org"),
          eq(grants.scopeId, org.id),
          isNull(grants.revokedAt),
        ),
      ),
    systemDb
      .select({ slug: competitions.slug, name: competitions.name })
      .from(auctions)
      .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
      .where(and(eq(auctions.orgId, org.id), eq(auctions.status, "live"))),
    // Over-read, then filter by capability and take the last six. Filtering a
    // page of six would have shown a member three rows and a hole.
    systemDb
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actor: auditLog.actor,
        subject: auditLog.subject,
        at: auditLog.at,
      })
      .from(auditLog)
      .where(and(eq(auditLog.scopeType, "org"), eq(auditLog.scopeId, org.id)))
      .orderBy(desc(auditLog.at))
      .limit(ACTIVITY_SCAN),
  ]);
  const sets = grantRows.map((row) => row.capabilitySet);
  const visible = activityRows
    .filter((row) => canSeeMoney || !isMoneyAction(row.action))
    .slice(0, ACTIVITY_PAGE);
  // "Access granted" with no who, to whom or by whom is a log line, not news.
  // The names are directory data, so they ride the directory's own gate.
  const named = new Map<string, string | null>();
  if (canSeeMembers) {
    const ids = [
      ...new Set(
        visible.flatMap((row) => [row.actor, row.subject ?? ""].filter((id) => id !== "")),
      ),
    ];
    if (ids.length > 0) {
      const peopleRows = await systemDb
        .select({ id: people.id, name: people.name })
        .from(people)
        .where(inArray(people.id, ids));
      for (const row of peopleRows) {
        named.set(row.id, row.name);
      }
    }
  }
  // createdAt is a Date column; the guard only covers a missing org row (which
  // resolveTenant has already ruled out — belt and braces).
  const createdAt = orgRow?.createdAt;
  return {
    createdAt: (createdAt instanceof Date ? createdAt : new Date()).toISOString(),
    role: sets.includes("org:owner") ? "Owner" : sets.includes("org:staff") ? "Staff" : "Member",
    description: orgRow?.description ?? null,
    canManage,
    liveAuctions: liveRows.map((row) => ({ slug: row.slug, name: row.name })),
    activity: visible.map((row) => ({
      id: row.id,
      action: row.action,
      subject: row.subject ?? "",
      subjectName: named.get(row.subject ?? "") ?? null,
      actorName: named.get(row.actor) ?? null,
      at: (row.at instanceof Date ? row.at : new Date(String(row.at))).toISOString(),
    })),
  };
}

export async function createInviteAction(
  slug: string,
  capabilitySet: string,
): Promise<{ url: string; reference: string; expiresAt: string } | { error: string }> {
  const session = await requireSession();
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return { error: "Not available." };
  }
  try {
    return await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: org.id },
      async (db) => {
        await requireCapability(
          db,
          session.personId,
          { scopeType: "org", scopeId: org.id },
          "org.members.invite",
        );
        const invite = await createInvite(db, org.id, session.personId, capabilitySet);
        return {
          url: `/join/${invite.token}`,
          // The handle that lets the organizer match this link to the row it
          // becomes in "waiting to be used" — the token itself never comes back.
          reference: invite.reference,
          expiresAt: invite.expiresAt.toISOString(),
        };
      },
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You can't invite members to this organization." };
    }
    return { error: "Invite could not be created." };
  }
}

/**
 * Kill an outstanding invite link. Same capability as minting one — if you may
 * hand out a key you may take an unused one back.
 */
export async function revokeInviteAction(
  slug: string,
  inviteId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
      await requireCapability(
        db,
        session.personId,
        { scopeType: "org", scopeId: org.id },
        "org.members.invite",
      );
      await revokeInvite(db, org.id, inviteId, session.personId);
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You can't manage invites for this organization." };
    }
    return { ok: false, error: "Could not revoke that invite." };
  }
}

export async function issueGrantAction(
  slug: string,
  targetPersonId: string,
  capabilitySet: string,
): Promise<{ ok: boolean }> {
  const session = await requireSession();
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return { ok: false };
  }
  // The capability set is client-supplied. It must name a real vocabulary —
  // org, settlement or finops — or the grant is a row that expands to nothing
  // and slips past each engine's own set validation and audit tagging.
  if (
    !isCapabilitySet(capabilitySet) &&
    !isSettlementCapabilitySet(capabilitySet) &&
    !isFinopsCapabilitySet(capabilitySet)
  ) {
    return { ok: false };
  }
  try {
    await withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
      await requireCapability(
        db,
        session.personId,
        { scopeType: "org", scopeId: org.id },
        "grant.issue",
      );
      await issueGrant(db, org.id, targetPersonId, capabilitySet, session.personId);
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** The refusal an org must never be able to click its way past. (Module-private:
 * a "use server" file may export async functions and nothing else.) */
const LAST_OWNER_REFUSAL =
  "This is the last owner. An organization with no owner can never grant a role, invite anyone or be edited again — make someone else an owner first.";

export async function revokeGrantAction(
  slug: string,
  targetPersonId: string,
  capabilitySet: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    return await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: org.id },
      async (db) => {
        await requireCapability(
          db,
          session.personId,
          { scopeType: "org", scopeId: org.id },
          "grant.revoke",
        );
        // The one revocation that cannot be undone by anybody, because the
        // undoing itself needs the capability being removed. Refused at the
        // ACTION, not in the button — a UI guard is a suggestion.
        if (capabilitySet === "org:owner") {
          const owners = await holdersOf(db, org.id, "org:owner");
          if (wouldOrphanOrg(owners, targetPersonId)) {
            return { ok: false, error: LAST_OWNER_REFUSAL };
          }
        }
        await revokeGrants(db, org.id, targetPersonId, capabilitySet, session.personId);
        return { ok: true };
      },
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You can't change roles in this organization." };
    }
    return { ok: false, error: "Could not change that role." };
  }
}

/**
 * Take a person out of the organization: grants revoked, membership deleted.
 *
 * Gated on `org.members.remove` — the capability has existed since IP-2 and had
 * no caller, which is why offboarding did not exist. The last owner is refused
 * here too: removing them is a strictly larger act than revoking their grant.
 */
export async function removeMemberAction(
  slug: string,
  targetPersonId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    return await withTenantDb(
      dbHandle,
      { personId: session.personId, orgId: org.id },
      async (db) => {
        await requireCapability(
          db,
          session.personId,
          { scopeType: "org", scopeId: org.id },
          "org.members.remove",
        );
        if (targetPersonId === session.personId) {
          return { ok: false, error: "You can't remove yourself from this organization." };
        }
        const owners = await holdersOf(db, org.id, "org:owner");
        if (wouldOrphanOrg(owners, targetPersonId)) {
          return { ok: false, error: LAST_OWNER_REFUSAL };
        }
        await removeMember(db, org.id, targetPersonId, session.personId);
        return { ok: true };
      },
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You can't remove people from this organization." };
    }
    return { ok: false, error: "Could not remove that member." };
  }
}

export async function invitePreview(token: string) {
  // Pre-tenant token path (documented exception): runs on the system pool.
  return previewInvite(systemDb, token);
}

/**
 * The /join landing, resolved for the signed-in viewer.
 *
 * Also reports the viewer's own phone so the page can say "Signed in as …" —
 * an invite link is a bearer token and the person opening it may well be signed
 * in as somebody else's account on a shared handset.
 */
export async function inviteLandingView(token: string): Promise<{
  landing: InviteLanding;
  /** Who the handset is signed in as, in words — see `ownerJoinLandingView`. */
  viewerLabel: string;
}> {
  const session = await requireSession();
  // Pre-tenant token path (documented exception): runs on the system pool.
  const landing = await inviteLanding(systemDb, session.personId, token);
  return { landing, viewerLabel: personLabel(session) };
}

export async function acceptInviteAction(token: string): Promise<void> {
  const session = await requireSession();
  // Pre-tenant token path (documented exception): runs on the system pool.
  const result = await acceptInvite(systemDb, session.personId, token);
  if (result.ok) {
    // Land on the club WITH a confirmation. Acceptance used to redirect in
    // silence — and an unnamed account was then bounced straight onward to
    // /onboarding, whose heading is written for a founder creating an auction,
    // with nothing anywhere in the product saying the invitation had worked.
    //
    // A short-lived cookie, matching `da_created_season`: the org URL is copied
    // and extended by people and tests, so a `?joined=1` hanging off it would
    // corrupt every one of those — AND the flag has to survive the name gate's
    // interruption, which a query parameter on the ORIGINAL destination does
    // not reliably do. The client reads it once and deletes it.
    (await cookies()).set("da_joined_org", result.orgName, {
      maxAge: 120,
      path: "/",
      sameSite: "lax",
    });
    // KEEP THE DESTINATION ACROSS THE NAME GATE.
    //
    // A brand-new member accepting an invitation has no name yet, so the org
    // layout's `requireOnboarded()` interrupts them — and it interrupts with no
    // `next`, whose default is /home. So the one thing they were invited to do
    // ended somewhere else entirely, with only a cookie hinting it had worked
    // (audit 2026-08-18, P3-1). Handing the gate the destination up front means
    // the interruption is exactly one question long and puts them back.
    const destination = `/org/${result.orgSlug}`;
    if (session.name === null || session.name.trim() === "") {
      redirect(`/onboarding?next=${encodeURIComponent(destination)}`);
    }
    redirect(destination);
  }
  redirect("/orgs?invite=invalid");
}
