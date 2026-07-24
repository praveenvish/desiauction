"use server";

import {
  auctions,
  auditLog,
  competitions,
  grants,
  newId,
  organizations,
  teams,
  tournaments,
  withTenantDb,
} from "@desiauction/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { dbHandle, systemDb } from "../db";
import { ForbiddenError, can, requireCapability } from "./authz";
import { acceptInvite, createInvite, previewInvite } from "./invites";
import {
  createOrg,
  issueGrant,
  membersOf,
  orgsFor,
  resolveTenant,
  revokeGrants,
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
  tournaments: number;
  teams: number;
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
  const [tournamentRows, teamRows, grantRows] = await Promise.all([
    systemDb
      .select({ orgId: tournaments.orgId, count: sql<number>`count(*)::int` })
      .from(tournaments)
      .where(inArray(tournaments.orgId, orgIds))
      .groupBy(tournaments.orgId),
    systemDb
      .select({ orgId: teams.orgId, count: sql<number>`count(*)::int` })
      .from(teams)
      .where(inArray(teams.orgId, orgIds))
      .groupBy(teams.orgId),
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
  const tournamentsBy = new Map(tournamentRows.map((row) => [row.orgId, row.count]));
  const teamsBy = new Map(teamRows.map((row) => [row.orgId, row.count]));
  const setsBy = new Map<string, string[]>();
  for (const row of grantRows) {
    setsBy.set(row.scopeId, [...(setsBy.get(row.scopeId) ?? []), row.capabilitySet]);
  }
  return orgs.map((org) => {
    const sets = setsBy.get(org.id) ?? [];
    return {
      ...org,
      tournaments: tournamentsBy.get(org.id) ?? 0,
      teams: teamsBy.get(org.id) ?? 0,
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

export async function createOrgAction(
  _previous: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const session = await requireSession();
  const name = formData.get("name");
  const orgId = newId();
  let slug: string;
  try {
    const org = await withTenantDb(dbHandle, { personId: session.personId, orgId }, (db) =>
      createOrg(db, session.personId, typeof name === "string" ? name : "", orgId),
    );
    slug = org.slug;
  } catch {
    return { error: "Give the organization a name of at least 3 characters." };
  }
  redirect(`/org/${slug}`);
}

export interface OrgView {
  org: OrgSummary;
  members: MemberRow[];
  viewer: { personId: string; canInvite: boolean; canIssueGrants: boolean };
}

/** Tenant resolution + view assembly; non-members see nothing (null). */
export async function orgView(slug: string): Promise<OrgView | null> {
  const session = await requireSession();
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return null;
  }
  const scope = { scopeType: "org" as const, scopeId: org.id };
  return withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
    const [members, canInvite, canIssueGrants] = await Promise.all([
      membersOf(db, org.id),
      can(db, session.personId, scope, "org.members.invite"),
      can(db, session.personId, scope, "grant.issue"),
    ]);
    return { org, members, viewer: { personId: session.personId, canInvite, canIssueGrants } };
  });
}

export interface OrgActivityRow {
  id: string;
  action: string;
  subject: string;
  at: string;
}

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
  const canManage = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: org.id },
    (db) => can(db, session.personId, { scopeType: "org", scopeId: org.id }, "org.manage"),
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
    systemDb
      .select({
        id: auditLog.id,
        action: auditLog.action,
        subject: auditLog.subject,
        at: auditLog.at,
      })
      .from(auditLog)
      .where(and(eq(auditLog.scopeType, "org"), eq(auditLog.scopeId, org.id)))
      .orderBy(desc(auditLog.at))
      .limit(6),
  ]);
  const sets = grantRows.map((row) => row.capabilitySet);
  // createdAt is a Date column; the guard only covers a missing org row (which
  // resolveTenant has already ruled out — belt and braces).
  const createdAt = orgRow?.createdAt;
  return {
    createdAt: (createdAt instanceof Date ? createdAt : new Date()).toISOString(),
    role: sets.includes("org:owner") ? "Owner" : sets.includes("org:staff") ? "Staff" : "Member",
    description: orgRow?.description ?? null,
    canManage,
    liveAuctions: liveRows.map((row) => ({ slug: row.slug, name: row.name })),
    activity: activityRows.map((row) => ({
      id: row.id,
      action: row.action,
      subject: row.subject ?? "",
      at: (row.at instanceof Date ? row.at : new Date(String(row.at))).toISOString(),
    })),
  };
}

export async function createInviteAction(
  slug: string,
  capabilitySet: string,
): Promise<{ url: string } | { error: string }> {
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
        return { url: `/join/${invite.token}` };
      },
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You can't invite members to this organization." };
    }
    return { error: "Invite could not be created." };
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

export async function revokeGrantAction(
  slug: string,
  targetPersonId: string,
  capabilitySet: string,
): Promise<{ ok: boolean }> {
  const session = await requireSession();
  const org = await resolveTenantScoped(session.personId, slug);
  if (org === null) {
    return { ok: false };
  }
  try {
    await withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
      await requireCapability(
        db,
        session.personId,
        { scopeType: "org", scopeId: org.id },
        "grant.revoke",
      );
      await revokeGrants(db, org.id, targetPersonId, capabilitySet, session.personId);
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function invitePreview(token: string) {
  // Pre-tenant token path (documented exception): runs on the system pool.
  return previewInvite(systemDb, token);
}

export async function acceptInviteAction(token: string): Promise<void> {
  const session = await requireSession();
  // Pre-tenant token path (documented exception): runs on the system pool.
  const result = await acceptInvite(systemDb, session.personId, token);
  if (result.ok) {
    redirect(`/org/${result.orgSlug}`);
  }
  redirect("/orgs?invite=invalid");
}
