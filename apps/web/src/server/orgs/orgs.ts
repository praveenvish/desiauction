import {
  auditLog,
  grants,
  newId,
  organizations,
  orgMembers,
  people,
  type Db,
} from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

// Organizations + membership (IP-2_DESIGN §4). Membership records belonging;
// grants carry permission — the two are deliberately separate (C-8).

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base === "" ? "org" : base;
}

export async function createOrg(
  db: Db,
  personId: string,
  name: string,
  // Callers inside a withTenantDb boundary must mint the id first — the org's
  // WITH CHECK'd member/grant/audit rows only pass under app.org_id = orgId.
  orgId: string = newId(),
): Promise<OrgSummary> {
  const trimmed = name.trim();
  if (trimmed.length < 3) {
    throw new Error("organization name must be at least 3 characters");
  }
  // ULID suffix keeps slugs unique without a retry loop.
  const slug = `${slugify(trimmed)}-${orgId.slice(-4).toLowerCase()}`;
  await db.insert(organizations).values({ id: orgId, name: trimmed, slug, createdBy: personId });
  await db.insert(orgMembers).values({ orgId, personId });
  await db.insert(grants).values({
    id: newId(),
    personId,
    scopeType: "org",
    scopeId: orgId,
    capabilitySet: "org:owner",
    grantedBy: personId,
  });
  await db.insert(auditLog).values({
    id: newId(),
    actor: personId,
    action: "org.created",
    scopeType: "org",
    scopeId: orgId,
  });
  return { id: orgId, name: trimmed, slug };
}

export async function orgsFor(db: Db, personId: string): Promise<OrgSummary[]> {
  return db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.personId, personId));
}

/**
 * Deterministic tenant resolution (M-IP2-3): URL slug → org, membership
 * required. Non-members get null — indistinguishable from a missing org.
 */
export async function resolveTenant(
  db: Db,
  personId: string,
  slug: string,
): Promise<OrgSummary | null> {
  const [row] = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(organizations)
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.personId, personId)),
    )
    .where(eq(organizations.slug, slug))
    .limit(1);
  return row ?? null;
}

export interface MemberRow {
  personId: string;
  name: string | null;
  phone: string;
  capabilitySets: string[];
}

export async function membersOf(db: Db, orgId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({ personId: orgMembers.personId, name: people.name, phone: people.phone })
    .from(orgMembers)
    .innerJoin(people, eq(people.id, orgMembers.personId))
    .where(eq(orgMembers.orgId, orgId));
  const activeGrants = await db
    .select({ personId: grants.personId, capabilitySet: grants.capabilitySet })
    .from(grants)
    .where(and(eq(grants.scopeType, "org"), eq(grants.scopeId, orgId), isNull(grants.revokedAt)));
  return rows.map((row) => ({
    ...row,
    capabilitySets: activeGrants
      .filter((grant) => grant.personId === row.personId)
      .map((grant) => grant.capabilitySet),
  }));
}

export async function issueGrant(
  db: Db,
  orgId: string,
  targetPersonId: string,
  capabilitySet: string,
  grantedBy: string,
): Promise<void> {
  await db.insert(grants).values({
    id: newId(),
    personId: targetPersonId,
    scopeType: "org",
    scopeId: orgId,
    capabilitySet,
    grantedBy,
  });
  await db.insert(auditLog).values({
    id: newId(),
    actor: grantedBy,
    action: "grant.issued",
    scopeType: "org",
    scopeId: orgId,
    subject: targetPersonId,
    meta: { capabilitySet },
  });
}

export async function revokeGrants(
  db: Db,
  orgId: string,
  targetPersonId: string,
  capabilitySet: string,
  revokedBy: string,
): Promise<void> {
  await db
    .update(grants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(grants.personId, targetPersonId),
        eq(grants.scopeType, "org"),
        eq(grants.scopeId, orgId),
        eq(grants.capabilitySet, capabilitySet),
        isNull(grants.revokedAt),
      ),
    );
  await db.insert(auditLog).values({
    id: newId(),
    actor: revokedBy,
    action: "grant.revoked",
    scopeType: "org",
    scopeId: orgId,
    subject: targetPersonId,
    meta: { capabilitySet },
  });
}
