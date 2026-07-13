"use server";

import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { db } from "../db";
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

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

export async function myOrgs(): Promise<OrgSummary[]> {
  const session = await requireSession();
  return orgsFor(db, session.personId);
}

export async function createOrgAction(
  _previous: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const session = await requireSession();
  const name = formData.get("name");
  let slug: string;
  try {
    const org = await createOrg(db, session.personId, typeof name === "string" ? name : "");
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
  const org = await resolveTenant(db, session.personId, slug);
  if (org === null) {
    return null;
  }
  const scope = { scopeType: "org" as const, scopeId: org.id };
  const [members, canInvite, canIssueGrants] = await Promise.all([
    membersOf(db, org.id),
    can(db, session.personId, scope, "org.members.invite"),
    can(db, session.personId, scope, "grant.issue"),
  ]);
  return { org, members, viewer: { personId: session.personId, canInvite, canIssueGrants } };
}

export async function createInviteAction(
  slug: string,
  capabilitySet: string,
): Promise<{ url: string } | { error: string }> {
  const session = await requireSession();
  const org = await resolveTenant(db, session.personId, slug);
  if (org === null) {
    return { error: "Not available." };
  }
  try {
    await requireCapability(
      db,
      session.personId,
      { scopeType: "org", scopeId: org.id },
      "org.members.invite",
    );
    const invite = await createInvite(db, org.id, session.personId, capabilitySet);
    return { url: `/join/${invite.token}` };
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
  const org = await resolveTenant(db, session.personId, slug);
  if (org === null) {
    return { ok: false };
  }
  try {
    await requireCapability(
      db,
      session.personId,
      { scopeType: "org", scopeId: org.id },
      "grant.issue",
    );
    await issueGrant(db, org.id, targetPersonId, capabilitySet, session.personId);
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
  const org = await resolveTenant(db, session.personId, slug);
  if (org === null) {
    return { ok: false };
  }
  try {
    await requireCapability(
      db,
      session.personId,
      { scopeType: "org", scopeId: org.id },
      "grant.revoke",
    );
    await revokeGrants(db, org.id, targetPersonId, capabilitySet, session.personId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function invitePreview(token: string) {
  return previewInvite(db, token);
}

export async function acceptInviteAction(token: string): Promise<void> {
  const session = await requireSession();
  const result = await acceptInvite(db, session.personId, token);
  if (result.ok) {
    redirect(`/org/${result.orgSlug}`);
  }
  redirect("/orgs?invite=invalid");
}
