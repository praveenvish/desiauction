"use server";

import { newId, withTenantDb } from "@desiauction/db";
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
