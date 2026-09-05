import {
  auditLog,
  competitions,
  grants,
  newId,
  organizations,
  orgMembers,
  people,
  type Db,
} from "@desiauction/db";
import { aliasedTable, and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

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

/**
 * Who handed a role out, and when.
 *
 * `grants` has carried `grantedBy`/`grantedAt` since the table existed and no
 * surface ever showed either, so "who let this person near the money?" had no
 * answer inside the product. Provenance travels with the role from here on.
 */
export interface MemberGrant {
  capabilitySet: string;
  grantedBy: string;
  /** The granter's display name, when they are still a person we can name. */
  grantedByName: string | null;
  /** `grants.created_at` — the moment the role was handed over (ISO). */
  grantedAt: string | null;
}

export interface MemberRow {
  personId: string;
  name: string | null;
  phone: string;
  capabilitySets: string[];
  /** The same sets, each carrying the provenance the grants table records. */
  roles: MemberGrant[];
  /** When they joined the org (ISO) — the members grid's "Joined" column. */
  joinedAt: string;
}

const granter = aliasedTable(people, "granter");

export async function membersOf(db: Db, orgId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      personId: orgMembers.personId,
      name: people.name,
      phone: people.phone,
      joinedAt: orgMembers.joinedAt,
    })
    .from(orgMembers)
    .innerJoin(people, eq(people.id, orgMembers.personId))
    .where(eq(orgMembers.orgId, orgId))
    .orderBy(asc(orgMembers.joinedAt));
  const activeGrants = await db
    .select({
      personId: grants.personId,
      capabilitySet: grants.capabilitySet,
      grantedBy: grants.grantedBy,
      grantedByName: granter.name,
      grantedAt: grants.createdAt,
    })
    .from(grants)
    .leftJoin(granter, eq(granter.id, grants.grantedBy))
    .where(and(eq(grants.scopeType, "org"), eq(grants.scopeId, orgId), isNull(grants.revokedAt)));
  const iso = (value: Date | string | null): string | null =>
    value === null
      ? null
      : value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString();
  return rows.map((row) => {
    const mine = activeGrants.filter((grant) => grant.personId === row.personId);
    return {
      personId: row.personId,
      name: row.name,
      phone: row.phone,
      joinedAt: (row.joinedAt instanceof Date
        ? row.joinedAt
        : new Date(String(row.joinedAt))
      ).toISOString(),
      capabilitySets: mine.map((grant) => grant.capabilitySet),
      roles: mine.map((grant) => ({
        capabilitySet: grant.capabilitySet,
        grantedBy: grant.grantedBy,
        grantedByName: grant.grantedByName,
        grantedAt: iso(grant.grantedAt),
      })),
    };
  });
}

/**
 * How many people belong here — WITHOUT the directory.
 *
 * The Overview stat used to be `view.members.length`, which is why the whole
 * phone book had to be in every payload just to render a number. A count is
 * not private; the names and numbers behind it are.
 */
export async function memberCountOf(db: Db, orgId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgMembers)
    .where(eq(orgMembers.orgId, orgId));
  return row?.count ?? 0;
}

/** People holding an ACTIVE grant of this exact set on this org. */
/**
 * Who actually holds a capability set here — grant AND membership.
 *
 * The membership join is the correction (audit PA-1 §9). `wouldOrphanOrg` is
 * computed from this list, and counting grants alone let a grant issued to
 * somebody who is not a member stand in as an owner: the real owner could then
 * revoke themselves, the guard would see "two owners" and allow it, and the
 * organization would be left with nobody who could mint an invite — an
 * unrecoverable state reached through the surface designed to prevent it.
 *
 * A grant to a non-member is inert everywhere else too, since every org surface
 * resolves membership first. Counting it as authority was the one place it
 * meant anything.
 */
export async function holdersOf(db: Db, orgId: string, capabilitySet: string): Promise<string[]> {
  const rows = await db
    .select({ personId: grants.personId })
    .from(grants)
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, orgId), eq(orgMembers.personId, grants.personId)),
    )
    .where(
      and(
        eq(grants.scopeType, "org"),
        eq(grants.scopeId, orgId),
        eq(grants.capabilitySet, capabilitySet),
        isNull(grants.revokedAt),
      ),
    );
  return [...new Set(rows.map((row) => row.personId))];
}

/**
 * Would taking this person's ownership away leave the club with no owner?
 *
 * An ownerless organization is a dead one: `grant.issue`, `grant.revoke`,
 * `org.members.invite` and `org.manage` all live in `org:owner`, so there is
 * nobody left who can hand ownership back — the act that would repair it is the
 * act that was just removed. Pure, so the rule is tested rather than trusted.
 */
export function wouldOrphanOrg(owners: readonly string[], targetPersonId: string): boolean {
  return owners.length <= 1 && owners.includes(targetPersonId);
}

/**
 * Take someone out of the organization entirely: every active grant revoked,
 * then the membership row itself.
 *
 * "Remove staff" only ever demoted — the person stayed a member, kept reading
 * the directory and kept the org in their /orgs list. Offboarding did not
 * exist. Membership and grants are separate by design (C-8), so leaving means
 * both are withdrawn, in that order, inside the caller's transaction.
 */
export async function removeMember(
  db: Db,
  orgId: string,
  targetPersonId: string,
  removedBy: string,
): Promise<void> {
  /*
   * EVERY SCOPE, not just the org one (audit PA-1 §9).
   *
   * This revoked `scopeType: "org"` grants and left competition-scoped ones —
   * the `"tournament"` scope whose id is a competition — exactly where they
   * were. So offboarding a person removed them from the member list and from
   * the org's grants while leaving them holding, say, `auction.conduct` on a
   * specific season: invisible on every screen that lists org authority, and
   * live again the moment anybody re-invited them.
   *
   * Leaving means leaving. The competitions belong to this org, so their grants
   * are revoked alongside it.
   */
  const orgCompetitionIds = await db
    .select({ id: competitions.id })
    .from(competitions)
    .where(eq(competitions.orgId, orgId));
  const scopeIds = [orgId, ...orgCompetitionIds.map((row) => row.id)];
  await db
    .update(grants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(grants.personId, targetPersonId),
        inArray(grants.scopeId, scopeIds),
        isNull(grants.revokedAt),
      ),
    );
  await db
    .delete(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.personId, targetPersonId)));
  await db.insert(auditLog).values({
    id: newId(),
    actor: removedBy,
    action: "org.members.removed",
    scopeType: "org",
    scopeId: orgId,
    subject: targetPersonId,
  });
}

export async function issueGrant(
  db: Db,
  orgId: string,
  targetPersonId: string,
  capabilitySet: string,
  grantedBy: string,
): Promise<void> {
  /*
   * A GRANT GOES TO A MEMBER, OR NOWHERE (audit PA-1 §9).
   *
   * This accepted any person id at all. Two things followed. A grant issued to
   * somebody who had never joined counted toward `holdersOf`, so an owner could
   * manufacture a second "owner" and then revoke themselves, leaving the org
   * with nobody able to mint an invite. And a capability set could be parked on
   * a person in advance — dormant, invisible on a member list that has no row
   * for them, and live the moment somebody later invites them as a viewer.
   *
   * Membership is cheap to require and is what every other org surface already
   * assumes. Refusing loudly beats writing a row that means nothing until it
   * suddenly means everything.
   */
  const [member] = await db
    .select({ personId: orgMembers.personId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.personId, targetPersonId)))
    .limit(1);
  if (member === undefined) {
    throw new Error("grant_target_not_a_member");
  }
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
