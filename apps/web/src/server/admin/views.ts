import {
  auctions,
  auditLog,
  competitions,
  finopsProfiles,
  grants,
  organizations,
  orgMembers,
  people,
  settlementCases,
  type Db,
} from "@desiauction/db";
import {
  complianceQueueSnapshot,
  followerHealthSnapshot,
  providerHealthSnapshot,
  runnerHealthSnapshot,
  type ComplianceQueueSnapshot,
  type FinopsDeps,
  type FollowerHealthSnapshot,
  type ProviderHealthSnapshot,
  type RunnerHealthSnapshot,
} from "@desiauction/financial-operations/server";
import { OUTCOME_ACTIONS, summarizeOutcomes, type OutcomeMetrics } from "@desiauction/core";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";

/**
 * PX-9 read composition — the Platform Administration projections.
 *
 * READ ONLY, structurally. This module imports no writer, no server action and
 * no command from any domain: only tables and the certified FinOps SNAPSHOTS.
 * The `admin-is-read-only` dependency-cruiser rule keeps it that way at merge
 * time, and the foundation suite proves it at runtime by driving every function
 * here through a db handle that throws on insert/update/delete.
 *
 * Nothing is DERIVED here that a certified platform already derives. Health is
 * whatever `runnerHealthSnapshot` / `followerHealthSnapshot` /
 * `providerHealthSnapshot` / `certificationSnapshot` say it is; the attention
 * queue is the union of `complianceQueueSnapshot`s plus statuses the domains
 * themselves record (a `discrepant` settlement case is discrepant because
 * settlement said so). This module COUNTS rows and GROUPS them for a screen —
 * no business rule, no money, no second opinion. When a number here disagrees
 * with a domain console, the domain console is right and this is the bug.
 *
 * Every function takes `db` explicitly. In production that is the SYSTEM pool
 * (PX-1 01 §2.4): administration is inherently cross-tenant, and no tenant
 * context could serve it. The gate that precedes it (`platformAdminGate`) runs
 * under RLS instead — access is never decided on the RLS-exempt pool.
 *
 * CORRELATED SUBQUERIES ARE HAND-WRITTEN, DELIBERATELY. Interpolating a drizzle
 * column into a `sql` template (`${competitions.orgId}`) emits the column name
 * UNQUALIFIED — `"org_id"` — so inside a subquery it binds to the SUBQUERY's
 * table, and the outer reference silently binds to the wrong row. It is not a
 * type error and it does not fail: it returns a plausible number. The first cut
 * of this module shipped `exists (select 1 from finops_profiles where "org_id" =
 * "id")`, which — because a finops profile's row id IS its org id — was TRUE for
 * every organization on the platform the moment any one org declared finance.
 * The suite caught it. Every subquery below therefore names its table, aliases
 * it, and qualifies the outer reference (`organizations.id`) in raw SQL. Do not
 * "tidy" these back into interpolation.
 */

// --- Business outcomes (Outcome Governance) --------------------------------------------
// Audit-log-backed North-Star metrics: two grouped counts over `audit_log`,
// folded by the pure core `summarizeOutcomes`. READ ONLY, cross-tenant by design
// (the whole module is) — `platformAdminGate` precedes every caller.
export async function outcomesProjection(db: Db, windowDays: number): Promise<OutcomeMetrics> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const actionCounts = await db
    .select({ action: auditLog.action, count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(inArray(auditLog.action, [...OUTCOME_ACTIONS]), gte(auditLog.at, since)))
    .groupBy(auditLog.action);
  // Per-org tally of competition creations → the repeat-usage basis.
  const orgRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(eq(auditLog.action, "competition.created"), gte(auditLog.at, since)))
    .groupBy(auditLog.scopeId);
  // Registrations by share source (the `?ref` recorded in the audit meta). Single
  // table, so the unqualified `"meta"` binds correctly (see the subquery caveat).
  const sourceRows = await db
    .select({
      source: sql<string | null>`${auditLog.meta} ->> 'source'`,
      count: sql<number>`count(*)::int`,
    })
    .from(auditLog)
    .where(and(eq(auditLog.action, "registration.submitted"), gte(auditLog.at, since)))
    .groupBy(sql`${auditLog.meta} ->> 'source'`);
  return summarizeOutcomes({
    windowDays,
    actionCounts,
    orgCompetitionCounts: orgRows.map((row) => row.count),
    registrationSources: sourceRows,
  });
}

// --- Platform dashboard (CTO §1) -------------------------------------------------------

export interface PlatformTotals {
  readonly orgs: number;
  readonly competitions: number;
  readonly people: number;
  readonly auctions: number;
  readonly cases: number;
  readonly financeOrgs: number;
}

export interface StatusLine {
  readonly status: string;
  readonly count: number;
}

export interface ActivityRow {
  readonly id: string;
  readonly action: string;
  readonly actor: string;
  readonly actorName: string | null;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly subject: string | null;
  readonly at: Date;
}

export interface AttentionRow {
  /** Stable machine key — the source that raised it, never a rephrasing. */
  readonly kind: string;
  readonly subject: string;
  /** The org this concerns, for the deep link. Null = platform-wide. */
  readonly orgSlug: string | null;
  readonly orgName: string | null;
  readonly href: string | null;
}

export interface FollowerRollup {
  readonly orgs: number;
  readonly current: number;
  readonly behind: number;
  readonly totalBehind: number;
}

export interface PlatformOverview {
  readonly totals: PlatformTotals;
  readonly auctionsByStatus: readonly StatusLine[];
  readonly casesByStatus: readonly StatusLine[];
  readonly runner: RunnerHealthSnapshot;
  readonly followers: FollowerRollup;
  readonly recent: readonly ActivityRow[];
  readonly attention: readonly AttentionRow[];
}

/** One row per status, straight from the domain's own status column. */
async function auctionsByStatusOf(db: Db): Promise<StatusLine[]> {
  return db
    .select({ status: auctions.status, count: sql<number>`count(*)::int` })
    .from(auctions)
    .groupBy(auctions.status)
    .orderBy(asc(auctions.status));
}

async function casesByStatusOf(db: Db): Promise<StatusLine[]> {
  return db
    .select({ status: settlementCases.status, count: sql<number>`count(*)::int` })
    .from(settlementCases)
    .groupBy(settlementCases.status)
    .orderBy(asc(settlementCases.status));
}

export async function platformOverview(deps: FinopsDeps, db: Db): Promise<PlatformOverview> {
  const [
    orgCount,
    competitionCount,
    peopleCount,
    auctionCount,
    caseCount,
    financeOrgCount,
    auctionsByStatus,
    casesByStatus,
    runner,
    recent,
  ] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(organizations),
    db.select({ n: sql<number>`count(*)::int` }).from(competitions),
    db.select({ n: sql<number>`count(*)::int` }).from(people),
    db.select({ n: sql<number>`count(*)::int` }).from(auctions),
    db.select({ n: sql<number>`count(*)::int` }).from(settlementCases),
    db.select({ n: sql<number>`count(*)::int` }).from(finopsProfiles),
    auctionsByStatusOf(db),
    casesByStatusOf(db),
    runnerHealthSnapshot(deps),
    recentActivity(db, 12),
  ]);
  const followers = await followerRollup(deps, db);
  const attention = await attentionQueue(deps, db, runner);
  return {
    totals: {
      orgs: orgCount[0]?.n ?? 0,
      competitions: competitionCount[0]?.n ?? 0,
      people: peopleCount[0]?.n ?? 0,
      auctions: auctionCount[0]?.n ?? 0,
      cases: caseCount[0]?.n ?? 0,
      financeOrgs: financeOrgCount[0]?.n ?? 0,
    },
    auctionsByStatus,
    casesByStatus,
    runner,
    followers,
    recent,
    attention,
  };
}

export async function recentActivity(db: Db, limit: number): Promise<ActivityRow[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actor: auditLog.actor,
      actorName: people.name,
      scopeType: auditLog.scopeType,
      scopeId: auditLog.scopeId,
      subject: auditLog.subject,
      at: auditLog.at,
    })
    .from(auditLog)
    .leftJoin(people, eq(people.id, auditLog.actor))
    .orderBy(desc(auditLog.at))
    .limit(limit);
  return rows;
}

/**
 * The orgs whose books the FinOps platform actually follows. Bounded by
 * DECLARATION, not by org count: an org without a finops profile has no
 * follower to be behind, so the 100-org seed does not fan out into 100
 * snapshot derivations.
 */
async function financeOrgIds(db: Db): Promise<string[]> {
  const rows = await db.select({ orgId: finopsProfiles.orgId }).from(finopsProfiles);
  return rows.map((row) => row.orgId);
}

async function followerRollup(deps: FinopsDeps, db: Db): Promise<FollowerRollup> {
  const orgIds = await financeOrgIds(db);
  const snapshots = await Promise.all(orgIds.map((orgId) => followerHealthSnapshot(deps, orgId)));
  return {
    orgs: snapshots.length,
    current: snapshots.filter((snapshot) => snapshot.current).length,
    behind: snapshots.filter((snapshot) => !snapshot.current).length,
    totalBehind: snapshots.reduce((sum, snapshot) => sum + snapshot.totalBehind, 0),
  };
}

/**
 * The attention queue: the union of what the certified platforms already say
 * needs a human. Administration adds no judgement of its own — every row here
 * is another system's verdict, carried across with its own vocabulary.
 */
export async function attentionQueue(
  deps: FinopsDeps,
  db: Db,
  runner: RunnerHealthSnapshot,
): Promise<AttentionRow[]> {
  const rows: AttentionRow[] = [];
  if (runner.jobs.dead > 0) {
    rows.push({
      kind: "runner:dead-jobs",
      subject: `${String(runner.jobs.dead)} dead job(s) across the platform`,
      orgSlug: null,
      orgName: null,
      href: "/admin/health",
    });
  }
  // Settlement's own verdict — a case is discrepant because settlement said so.
  const discrepant = await db
    .select({
      id: settlementCases.id,
      competitionId: settlementCases.competitionId,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      competitionSlug: competitions.slug,
    })
    .from(settlementCases)
    .innerJoin(organizations, eq(organizations.id, settlementCases.orgId))
    .leftJoin(competitions, eq(competitions.id, settlementCases.competitionId))
    .where(eq(settlementCases.status, "discrepant"))
    .limit(20);
  for (const row of discrepant) {
    rows.push({
      kind: "settlement:discrepant",
      subject: `Case ${row.id.slice(-6)} is discrepant`,
      orgSlug: row.orgSlug,
      orgName: row.orgName,
      href:
        row.competitionSlug === null
          ? null
          : `/competitions/${row.competitionSlug}/money/case/${row.id}`,
    });
  }
  // FinOps' own queue, per following org, carried across verbatim.
  const financeOrgs = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(finopsProfiles)
    .innerJoin(organizations, eq(organizations.id, finopsProfiles.orgId));
  const queues = await Promise.all(
    financeOrgs.map(async (org) => ({
      org,
      queue: await complianceQueueSnapshot(deps, org.id),
    })),
  );
  for (const { org, queue } of queues) {
    for (const item of queue.items) {
      rows.push({
        kind: item.kind,
        subject: item.subject,
        orgSlug: org.slug,
        orgName: org.name,
        href: `/org/${org.slug}/money`,
      });
    }
  }
  return rows;
}

// --- Organization administration (CTO §2) ----------------------------------------------

export interface OrgDirectoryRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly competitions: number;
  readonly members: number;
  readonly auctions: number;
  readonly cases: number;
  readonly openCases: number;
  /** Whether the org has DECLARED a finops profile — the platform's own flag. */
  readonly financeDeclared: boolean;
  readonly lastActivityAt: Date | null;
}

export type OrgFilter = "all" | "finance" | "settling" | "quiet";

export interface OrgDirectory {
  readonly rows: readonly OrgDirectoryRow[];
  readonly total: number;
  readonly filter: OrgFilter;
  readonly query: string;
}

const ORG_PAGE = 50;

export async function organizationDirectory(
  db: Db,
  options: { query?: string | undefined; filter?: OrgFilter | undefined } = {},
): Promise<OrgDirectory> {
  const query = (options.query ?? "").trim();
  const filter = options.filter ?? "all";
  const where =
    query === ""
      ? undefined
      : or(ilike(organizations.name, `%${query}%`), ilike(organizations.slug, `%${query}%`));

  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      createdAt: organizations.createdAt,
      competitions: sql<number>`(select count(*)::int from competitions c where c.org_id = organizations.id)`,
      members: sql<number>`(select count(*)::int from org_members m where m.org_id = organizations.id)`,
      auctions: sql<number>`(select count(*)::int from auctions a where a.org_id = organizations.id)`,
      cases: sql<number>`(select count(*)::int from settlement_cases sc where sc.org_id = organizations.id)`,
      openCases: sql<number>`(select count(*)::int from settlement_cases sc where sc.org_id = organizations.id and sc.status not in ('closed', 'voided'))`,
      financeDeclared: sql<boolean>`exists (select 1 from finops_profiles fp where fp.org_id = organizations.id)`,
      lastActivityAt: sql<
        string | null
      >`(select max(al.at) from audit_log al where al.scope_id = organizations.id)`,
    })
    .from(organizations)
    .where(where)
    .orderBy(desc(organizations.createdAt))
    .limit(ORG_PAGE);

  const filtered = rows.filter((row) => {
    if (filter === "finance") {
      return row.financeDeclared;
    }
    if (filter === "settling") {
      return row.openCases > 0;
    }
    if (filter === "quiet") {
      return row.competitions === 0;
    }
    return true;
  });
  const total = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(organizations)
    .where(where);
  return {
    rows: filtered.map((row) => ({
      ...row,
      lastActivityAt: row.lastActivityAt === null ? null : new Date(row.lastActivityAt),
    })),
    total: total[0]?.n ?? 0,
    filter,
    query,
  };
}

/** The org's competitions, for the drill-down. Read-only; deep links go to the real consoles. */
export interface OrgCompetitionRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly visibility: string;
  readonly createdAt: Date;
  readonly auctionStatus: string | null;
  readonly caseStatus: string | null;
}

export interface OrgDetail {
  readonly org: { id: string; name: string; slug: string; createdAt: Date };
  readonly competitions: readonly OrgCompetitionRow[];
  readonly members: readonly {
    personId: string;
    name: string | null;
    phone: string;
    joinedAt: Date;
  }[];
  readonly grants: readonly {
    id: string;
    personId: string;
    name: string | null;
    capabilitySet: string;
    scopeType: string;
    revokedAt: Date | null;
  }[];
  readonly finance: { declared: boolean; posture: string | null };
  readonly activity: readonly ActivityRow[];
}

export async function organizationDetail(db: Db, slug: string): Promise<OrgDetail | null> {
  const [org] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (org === undefined) {
    return null;
  }
  const [competitionRows, memberRows, grantRows, profileRows, activity] = await Promise.all([
    db
      .select({
        id: competitions.id,
        name: competitions.name,
        slug: competitions.slug,
        status: competitions.status,
        visibility: competitions.visibility,
        createdAt: competitions.createdAt,
        auctionStatus: sql<
          string | null
        >`(select a.status from auctions a where a.competition_id = competitions.id order by a.created_at desc limit 1)`,
        caseStatus: sql<
          string | null
        >`(select sc.status from settlement_cases sc where sc.competition_id = competitions.id and sc.status <> 'voided' limit 1)`,
      })
      .from(competitions)
      .where(eq(competitions.orgId, org.id))
      .orderBy(desc(competitions.createdAt)),
    db
      .select({
        personId: orgMembers.personId,
        name: people.name,
        phone: people.phone,
        joinedAt: orgMembers.joinedAt,
      })
      .from(orgMembers)
      .innerJoin(people, eq(people.id, orgMembers.personId))
      .where(eq(orgMembers.orgId, org.id))
      .orderBy(asc(orgMembers.joinedAt)),
    db
      .select({
        id: grants.id,
        personId: grants.personId,
        name: people.name,
        capabilitySet: grants.capabilitySet,
        scopeType: grants.scopeType,
        revokedAt: grants.revokedAt,
      })
      .from(grants)
      .innerJoin(people, eq(people.id, grants.personId))
      .where(eq(grants.scopeId, org.id))
      .orderBy(asc(grants.createdAt)),
    db
      .select({ posture: finopsProfiles.posture })
      .from(finopsProfiles)
      .where(eq(finopsProfiles.orgId, org.id))
      .limit(1),
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actor: auditLog.actor,
        actorName: people.name,
        scopeType: auditLog.scopeType,
        scopeId: auditLog.scopeId,
        subject: auditLog.subject,
        at: auditLog.at,
      })
      .from(auditLog)
      .leftJoin(people, eq(people.id, auditLog.actor))
      .where(eq(auditLog.scopeId, org.id))
      .orderBy(desc(auditLog.at))
      .limit(10),
  ]);
  return {
    org,
    competitions: competitionRows,
    members: memberRows,
    grants: grantRows,
    finance: { declared: profileRows.length > 0, posture: profileRows[0]?.posture ?? null },
    activity,
  };
}

// --- User administration (CTO §3) ------------------------------------------------------

export interface UserDirectoryRow {
  readonly id: string;
  readonly name: string | null;
  readonly phone: string;
  readonly createdAt: Date;
  readonly orgs: number;
  readonly activeGrants: number;
  readonly lastActivityAt: Date | null;
}

export interface UserDirectory {
  readonly rows: readonly UserDirectoryRow[];
  readonly total: number;
  readonly query: string;
}

const USER_PAGE = 50;

export async function userDirectory(db: Db, query = ""): Promise<UserDirectory> {
  const term = query.trim();
  const where =
    term === "" ? undefined : or(ilike(people.name, `%${term}%`), ilike(people.phone, `%${term}%`));
  const rows = await db
    .select({
      id: people.id,
      name: people.name,
      phone: people.phone,
      createdAt: people.createdAt,
      orgs: sql<number>`(select count(*)::int from org_members m where m.person_id = people.id)`,
      activeGrants: sql<number>`(select count(*)::int from grants g where g.person_id = people.id and g.revoked_at is null)`,
      lastActivityAt: sql<
        string | null
      >`(select max(al.at) from audit_log al where al.actor = people.id)`,
    })
    .from(people)
    .where(where)
    .orderBy(desc(people.createdAt))
    .limit(USER_PAGE);
  const total = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(people)
    .where(where);
  return {
    rows: rows.map((row) => ({
      ...row,
      lastActivityAt: row.lastActivityAt === null ? null : new Date(row.lastActivityAt),
    })),
    total: total[0]?.n ?? 0,
    query: term,
  };
}

export interface UserGrantRow {
  readonly id: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly scopeLabel: string;
  readonly capabilitySet: string;
  readonly grantedBy: string;
  readonly grantedByName: string | null;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

export interface UserDetail {
  readonly person: { id: string; name: string | null; phone: string; createdAt: Date };
  readonly orgs: readonly { slug: string; name: string; joinedAt: Date }[];
  readonly grants: readonly UserGrantRow[];
  readonly activity: readonly ActivityRow[];
}

export async function userDetail(db: Db, personId: string): Promise<UserDetail | null> {
  const [person] = await db
    .select({ id: people.id, name: people.name, phone: people.phone, createdAt: people.createdAt })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  if (person === undefined) {
    return null;
  }
  const [orgRows, grantRows, activity] = await Promise.all([
    db
      .select({ slug: organizations.slug, name: organizations.name, joinedAt: orgMembers.joinedAt })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(eq(orgMembers.personId, personId))
      .orderBy(asc(orgMembers.joinedAt)),
    db
      .select({
        id: grants.id,
        scopeType: grants.scopeType,
        scopeId: grants.scopeId,
        capabilitySet: grants.capabilitySet,
        grantedBy: grants.grantedBy,
        createdAt: grants.createdAt,
        revokedAt: grants.revokedAt,
        orgName: organizations.name,
        granterName: people.name,
      })
      .from(grants)
      .leftJoin(organizations, eq(organizations.id, grants.scopeId))
      .leftJoin(people, eq(people.id, grants.grantedBy))
      .where(eq(grants.personId, personId))
      .orderBy(asc(grants.createdAt)),
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actor: auditLog.actor,
        actorName: people.name,
        scopeType: auditLog.scopeType,
        scopeId: auditLog.scopeId,
        subject: auditLog.subject,
        at: auditLog.at,
      })
      .from(auditLog)
      .leftJoin(people, eq(people.id, auditLog.actor))
      .where(eq(auditLog.actor, personId))
      .orderBy(desc(auditLog.at))
      .limit(15),
  ]);
  return {
    person,
    orgs: orgRows,
    grants: grantRows.map((row) => ({
      id: row.id,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      scopeLabel: row.orgName ?? (row.scopeType === "platform" ? "The platform" : row.scopeId),
      capabilitySet: row.capabilitySet,
      grantedBy: row.grantedBy,
      grantedByName: row.granterName,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
    })),
    activity,
  };
}

// --- Audit explorer (CTO §4) -----------------------------------------------------------

export interface AuditFilters {
  readonly q?: string | undefined;
  readonly action?: string | undefined;
  readonly actor?: string | undefined;
  readonly scopeId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface AuditEntry extends ActivityRow {
  readonly meta: unknown;
  readonly scopeLabel: string | null;
  readonly subjectName: string | null;
}

export interface AuditPage {
  readonly rows: readonly AuditEntry[];
  readonly actions: readonly string[];
  readonly total: number;
  readonly filters: AuditFilters;
  readonly truncated: boolean;
}

const AUDIT_PAGE = 100;

export async function auditExplorer(db: Db, filters: AuditFilters = {}): Promise<AuditPage> {
  const clauses: SQL[] = [];
  const q = (filters.q ?? "").trim();
  if (q !== "") {
    // Correlation identifiers are ids: subject, scope and actor are all ULIDs,
    // so one box searches the whole correlation chain.
    const like = `%${q}%`;
    const match = or(
      ilike(auditLog.subject, like),
      ilike(auditLog.scopeId, like),
      ilike(auditLog.actor, like),
      ilike(auditLog.action, like),
    );
    if (match !== undefined) {
      clauses.push(match);
    }
  }
  if (filters.action !== undefined && filters.action !== "") {
    clauses.push(eq(auditLog.action, filters.action));
  }
  if (filters.actor !== undefined && filters.actor !== "") {
    clauses.push(eq(auditLog.actor, filters.actor));
  }
  if (filters.scopeId !== undefined && filters.scopeId !== "") {
    clauses.push(eq(auditLog.scopeId, filters.scopeId));
  }
  if (filters.from !== undefined && filters.from !== "") {
    const from = new Date(filters.from);
    if (!Number.isNaN(from.getTime())) {
      clauses.push(gte(auditLog.at, from));
    }
  }
  if (filters.to !== undefined && filters.to !== "") {
    const to = new Date(filters.to);
    if (!Number.isNaN(to.getTime())) {
      clauses.push(lte(auditLog.at, to));
    }
  }
  const where = clauses.length === 0 ? undefined : and(...clauses);

  const [rows, actionRows, total] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actor: auditLog.actor,
        actorName: people.name,
        scopeType: auditLog.scopeType,
        scopeId: auditLog.scopeId,
        subject: auditLog.subject,
        meta: auditLog.meta,
        at: auditLog.at,
        scopeLabel: organizations.name,
      })
      .from(auditLog)
      .leftJoin(people, eq(people.id, auditLog.actor))
      .leftJoin(organizations, eq(organizations.id, auditLog.scopeId))
      .where(where)
      .orderBy(desc(auditLog.at))
      .limit(AUDIT_PAGE + 1),
    db
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .orderBy(asc(auditLog.action))
      .limit(200),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(where),
  ]);
  const truncated = rows.length > AUDIT_PAGE;
  const page = truncated ? rows.slice(0, AUDIT_PAGE) : rows;

  // Name the subjects where the subject is a person — the timeline reads in
  // names, not ULIDs, without asking the reader to cross-reference.
  const subjectIds = [
    ...new Set(
      page.map((row) => row.subject).filter((s): s is string => s !== null && s.length === 26),
    ),
  ];
  const subjectNames =
    subjectIds.length === 0
      ? []
      : await db
          .select({ id: people.id, name: people.name })
          .from(people)
          .where(inArray(people.id, subjectIds));
  const nameById = new Map(subjectNames.map((row) => [row.id, row.name]));
  return {
    rows: page.map((row) => ({
      ...row,
      subjectName: row.subject === null ? null : (nameById.get(row.subject) ?? null),
    })),
    actions: actionRows.map((row) => row.action),
    total: total[0]?.n ?? 0,
    filters,
    truncated,
  };
}

// --- Platform health (CTO §5) ----------------------------------------------------------

/**
 * The last certification the RUNNER recorded — read from its audit breadcrumb,
 * never re-derived.
 *
 * `certificationSnapshot`/`certificationRegisterSnapshot` look like reads and
 * are not: both call `certifyOperations`, which APPENDS a
 * `finops.CertificationDerived` audit row attributed to `source: "runner"`. An
 * admin opening /admin/health would have written one per finance org per page
 * load — forging runner attribution and polluting the very trail the audit
 * explorer exists to show. The read-only proof caught it. Administration
 * observes the certification the platform performed; it does not cause one.
 */
export interface CertificationLine {
  readonly at: Date;
  readonly verdict: string;
  readonly digest: string;
}

export interface OrgHealthRow {
  readonly orgId: string;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly follower: FollowerHealthSnapshot;
  readonly provider: ProviderHealthSnapshot;
  readonly certification: CertificationLine | null;
  readonly queue: ComplianceQueueSnapshot;
}

async function lastCertification(
  deps: FinopsDeps,
  orgId: string,
): Promise<CertificationLine | null> {
  const history = await deps.store.loadAuditBreadcrumbs(orgId, "finops.CertificationDerived");
  const latest = history[history.length - 1];
  if (latest === undefined) {
    return null;
  }
  // The runner's own reason string: "PASS · <digest>" / "FAIL · <digest>"
  // (governance.ts). Read back in the format the platform wrote it.
  const [verdict = "", digest = ""] = (latest.reason ?? "").split(" · ");
  return { at: new Date(latest.atMs), verdict, digest };
}

export interface PlatformHealth {
  readonly runner: RunnerHealthSnapshot;
  readonly orgs: readonly OrgHealthRow[];
  readonly followers: FollowerRollup;
}

/**
 * Platform health is the certified snapshots, side by side. Every verdict —
 * healthy or not — is the FinOps platform's own; administration only arranges
 * them and adds the org's name.
 */
export async function platformHealth(deps: FinopsDeps, db: Db): Promise<PlatformHealth> {
  const financeOrgs = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(finopsProfiles)
    .innerJoin(organizations, eq(organizations.id, finopsProfiles.orgId))
    .orderBy(asc(organizations.name));
  const [runner, orgs] = await Promise.all([
    runnerHealthSnapshot(deps),
    Promise.all(
      financeOrgs.map(async (org) => {
        const [follower, provider, certification, queue] = await Promise.all([
          followerHealthSnapshot(deps, org.id),
          providerHealthSnapshot(deps, org.id),
          lastCertification(deps, org.id),
          complianceQueueSnapshot(deps, org.id),
        ]);
        return {
          orgId: org.id,
          orgName: org.name,
          orgSlug: org.slug,
          follower,
          provider,
          certification,
          queue,
        };
      }),
    ),
  ]);
  return {
    runner,
    orgs,
    followers: {
      orgs: orgs.length,
      current: orgs.filter((row) => row.follower.current).length,
      behind: orgs.filter((row) => !row.follower.current).length,
      totalBehind: orgs.reduce((sum, row) => sum + row.follower.totalBehind, 0),
    },
  };
}

// --- Command search (CTO §6) -----------------------------------------------------------

export interface AdminSearchHit {
  readonly kind: "org" | "user" | "competition" | "auction" | "case" | "audit";
  readonly label: string;
  readonly hint: string;
  readonly href: string;
}

const SEARCH_LIMIT = 6;

/**
 * NAVIGATION ONLY (PX-2's palette ruling, unchanged). Every hit is a route the
 * admin may already open; nothing here decides access, and the destination
 * gates itself.
 */
export async function adminSearch(db: Db, query: string): Promise<AdminSearchHit[]> {
  const term = query.trim();
  if (term.length < 2) {
    return [];
  }
  const like = `%${term}%`;
  const [orgRows, userRows, competitionRows, caseRows] = await Promise.all([
    db
      .select({ name: organizations.name, slug: organizations.slug })
      .from(organizations)
      .where(or(ilike(organizations.name, like), ilike(organizations.slug, like)))
      .limit(SEARCH_LIMIT),
    db
      .select({ id: people.id, name: people.name, phone: people.phone })
      .from(people)
      .where(or(ilike(people.name, like), ilike(people.phone, like)))
      .limit(SEARCH_LIMIT),
    db
      .select({
        name: competitions.name,
        slug: competitions.slug,
        orgName: organizations.name,
        auctionStatus: sql<
          string | null
        >`(select a.status from auctions a where a.competition_id = competitions.id order by a.created_at desc limit 1)`,
      })
      .from(competitions)
      .innerJoin(organizations, eq(organizations.id, competitions.orgId))
      .where(or(ilike(competitions.name, like), ilike(competitions.slug, like)))
      .limit(SEARCH_LIMIT),
    db
      .select({
        id: settlementCases.id,
        status: settlementCases.status,
        competitionSlug: competitions.slug,
        competitionName: competitions.name,
      })
      .from(settlementCases)
      .innerJoin(competitions, eq(competitions.id, settlementCases.competitionId))
      .where(ilike(settlementCases.id, like))
      .limit(SEARCH_LIMIT),
  ]);
  const hits: AdminSearchHit[] = [];
  for (const row of orgRows) {
    hits.push({
      kind: "org",
      label: row.name,
      hint: "Organization",
      href: `/admin/orgs/${row.slug}`,
    });
  }
  for (const row of userRows) {
    hits.push({
      kind: "user",
      label: row.name ?? row.phone,
      hint: `User · ${row.phone}`,
      href: `/admin/users/${row.id}`,
    });
  }
  for (const row of competitionRows) {
    hits.push({
      kind: "competition",
      label: row.name,
      hint: `Competition · ${row.orgName}`,
      href: `/competitions/${row.slug}`,
    });
    if (row.auctionStatus !== null) {
      hits.push({
        kind: "auction",
        label: `${row.name} — auction`,
        hint: `Auction · ${row.auctionStatus}`,
        href: `/competitions/${row.slug}/auction`,
      });
    }
  }
  for (const row of caseRows) {
    hits.push({
      kind: "case",
      label: `Case ${row.id.slice(-6)}`,
      hint: `${row.competitionName} · ${row.status}`,
      href: `/competitions/${row.competitionSlug}/money/case/${row.id}`,
    });
  }
  hits.push({
    kind: "audit",
    label: `Search the audit log for "${term}"`,
    hint: "Audit",
    href: `/admin/audit?q=${encodeURIComponent(term)}`,
  });
  return hits;
}
