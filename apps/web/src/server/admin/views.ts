import {
  auctions,
  auditLog,
  competitions,
  finopsJobs,
  finopsProfiles,
  grants,
  organizations,
  orgMembers,
  people,
  registrations,
  settlementCases,
  sports,
  suppressions,
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
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { SMS_TEMPLATES } from "../messaging/templates";
import { ADMIN_ACCESS_ACTION } from "./capabilities";
import { countNoun, waitedFor } from "./format";

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

/**
 * How long a queued job may wait before the runner is not doing its job. The
 * runner's OWN freshness budget (operations.ts:90) — administration re-uses the
 * number the platform already lives by rather than inventing a threshold.
 */
export const RUNNER_FRESHNESS_BUDGET_MS = 15 * 60 * 1000;

/** A schedule that has not fired for six hours past its due time is overdue. */
const SCHEDULE_OVERDUE_BUDGET_MS = 6 * 60 * 60 * 1000;

/**
 * An auction that has been `live` for longer than this is not a live auction;
 * it is an auction night that ended without anyone closing it. Deliberately
 * generous — a real auction runs for hours, never for half a day.
 */
const AUCTION_STALE_BUDGET_MS = 12 * 60 * 60 * 1000;

/**
 * The runner verdict — CORRECTED, and the only place administration second-
 * guesses a snapshot.
 *
 * `runnerHealthSnapshot` reports `healthy: jobs.dead === 0` (snapshots.ts:116),
 * which is a liveness ANTI-test: a runner that never runs cannot produce a dead
 * job, so total failure reports green. Measured on this platform: 1,558 queued,
 * 2 done, 0 dead, oldest queued eleven days — verdict HEALTHY. The screen then
 * contradicted itself, showing "Settlement ingest 2 BEHIND" three lines under
 * "Job runner HEALTHY", when the ingest was behind BECAUSE the runner was dead.
 *
 * The `dead === 0` definition is frozen inside IP-6, so the correction lives
 * here — the same correction Screen 18 made for a single organization's desk
 * (financial-operations/views.ts `orgJobs`), applied at platform scale. Age is
 * the disclosing fact: "eleven days" answers "is this stuck?" where "1,558"
 * never did.
 */
export interface RunnerVerdict {
  /** The corrected verdict. NOT `snapshot.healthy`. */
  readonly healthy: boolean;
  readonly queued: number;
  readonly dead: number;
  /** How long the longest-waiting queued job has waited, in ms. */
  readonly oldestQueuedWaitMs: number | null;
  /** Schedules whose due time has passed by more than the budget. */
  readonly overdueSchedules: number;
  /** Schedules whose recorded last-fire is in the FUTURE — a clock that lies. */
  readonly futureSchedules: number;
  /** Why it is not healthy, in words an operator can act on. Null when healthy. */
  readonly detail: string | null;
}

export interface PlatformOverview {
  readonly totals: PlatformTotals;
  readonly auctionsByStatus: readonly StatusLine[];
  /** Live auctions split by RECENCY, so "40 live" cannot read as activity. */
  readonly liveAuctions: { readonly total: number; readonly stale: number };
  readonly casesByStatus: readonly StatusLine[];
  readonly runner: RunnerHealthSnapshot;
  readonly runnerVerdict: RunnerVerdict;
  readonly followers: FollowerRollup;
  readonly recent: readonly ActivityRow[];
  readonly attention: readonly AttentionRow[];
}

/** One shipped sport pack and whether it is switched on (SP-1 Phase 1). */
export interface SportCatalogueRow {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly competitions: number;
}

/**
 * WHICH SPORTS THIS PLATFORM RUNS, AND HOW MUCH EACH IS USED.
 *
 * Administration OBSERVES the catalogue; it does not administer it. Enabling a
 * sport needs its pack to exist in code, which is a deploy, so the flag can
 * never usefully move ahead of one — and a toggle here would cost the provable
 * "administration cannot act" property for a two-row list (see the header of
 * `access-log.ts` for the argument that property is holding). Migration 0046
 * seeds it; this reads it.
 *
 * Takes `db` like every projection here, so the runtime read-only proof drives
 * it through a handle that throws on mutation.
 */
export async function sportCatalogueProjection(db: Db): Promise<SportCatalogueRow[]> {
  const rows = await db
    .select({
      key: sports.key,
      label: sports.label,
      enabled: sports.enabled,
      sortOrder: sports.sortOrder,
      competitions: sql<number>`count(${competitions.id})::int`,
    })
    .from(sports)
    .leftJoin(competitions, eq(competitions.sport, sports.key))
    .groupBy(sports.key, sports.label, sports.enabled, sports.sortOrder)
    .orderBy(asc(sports.sortOrder), asc(sports.key));
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    enabled: row.enabled,
    competitions: row.competitions,
  }));
}

/**
 * The platform's whole job queue, with the ages the snapshot omits. A plain
 * count over one table — no writer, no command, no second opinion about money.
 */
async function platformJobs(
  db: Db,
  nowMs: number,
): Promise<{ queued: number; dead: number; oldestQueuedWaitMs: number | null }> {
  const [row] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${finopsJobs.state} = 'queued')::int`,
      dead: sql<number>`count(*) filter (where ${finopsJobs.state} = 'dead')::int`,
      oldestQueuedMs: sql<
        number | null
      >`min(${finopsJobs.notBeforeMs}) filter (where ${finopsJobs.state} = 'queued')`,
    })
    .from(finopsJobs);
  const oldest = row?.oldestQueuedMs ?? null;
  return {
    queued: row?.queued ?? 0,
    dead: row?.dead ?? 0,
    // A job scheduled for the future has not "waited" yet — clamp at zero
    // rather than reporting a negative age.
    oldestQueuedWaitMs: oldest === null ? null : Math.max(0, nowMs - oldest),
  };
}

export async function runnerVerdictOf(
  deps: FinopsDeps,
  db: Db,
  snapshot: RunnerHealthSnapshot,
): Promise<RunnerVerdict> {
  const nowMs = deps.now();
  const jobs = await platformJobs(db, nowMs);
  const overdueSchedules = snapshot.schedules.filter(
    (schedule) => nowMs - schedule.nextDueMs > SCHEDULE_OVERDUE_BUDGET_MS,
  ).length;
  const futureSchedules = snapshot.schedules.filter(
    (schedule) => schedule.lastFiredMs !== null && schedule.lastFiredMs > nowMs,
  ).length;
  const stalled =
    jobs.oldestQueuedWaitMs !== null && jobs.oldestQueuedWaitMs > RUNNER_FRESHNESS_BUDGET_MS;
  const reasons: string[] = [];
  if (jobs.dead > 0) {
    reasons.push(`${countNoun(jobs.dead, "job")} given up`);
  }
  if (stalled && jobs.oldestQueuedWaitMs !== null) {
    reasons.push(
      `${countNoun(jobs.queued, "job")} waiting, nothing picked up for ${waitedFor(jobs.oldestQueuedWaitMs)}`,
    );
  }
  if (overdueSchedules > 0) {
    reasons.push(`${countNoun(overdueSchedules, "schedule")} overdue`);
  }
  if (futureSchedules > 0) {
    // Not a health failure of its own, but it must be SAID: a last-fire in the
    // future means the recorded time cannot be trusted as evidence either way.
    reasons.push(
      `${countNoun(futureSchedules, "schedule")} report${futureSchedules === 1 ? "s" : ""} a last fire in the future`,
    );
  }
  return {
    healthy: jobs.dead === 0 && !stalled && overdueSchedules === 0,
    queued: jobs.queued,
    dead: jobs.dead,
    oldestQueuedWaitMs: jobs.oldestQueuedWaitMs,
    overdueSchedules,
    futureSchedules,
    detail: reasons.length === 0 ? null : reasons.join(" · "),
  };
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

/**
 * How many auctions are `live` because a room is bidding, and how many are
 * `live` because nobody ever closed them. The Overview rendered the enum count
 * as `● LIVE 40` with a pulsing dot — i.e. as ACTIVITY — when all forty had
 * been sitting live for four to ten days. Every one is an organizer whose
 * auction night ended badly.
 */
async function liveAuctionsOf(db: Db, nowMs: number): Promise<{ total: number; stale: number }> {
  // ISO string with an explicit cast, not a Date: a raw Date interpolated into
  // a `sql` template carries no inferred type, and postgres.js is handed the
  // object itself. It fails at BIND time, which the read-only proof caught.
  const cutoff = new Date(nowMs - AUCTION_STALE_BUDGET_MS).toISOString();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      stale: sql<number>`count(*) filter (where ${auctions.createdAt} < ${cutoff}::timestamptz)::int`,
    })
    .from(auctions)
    .where(eq(auctions.status, "live"));
  return { total: row?.total ?? 0, stale: row?.stale ?? 0 };
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
    liveAuctions,
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
    // Sign-in chatter excluded from the LANDING feed only: every login writes
    // two auth rows, so the Overview's "recent platform activity" was fourteen
    // lines of people signing in and zero lines of the platform doing
    // anything. The audit explorer still shows every one of them — this is the
    // same disclosure-not-concealment trade the admin.accessed exclusion makes.
    recentActivity(db, 12, [
      ADMIN_ACCESS_ACTION,
      "auth.login.otp",
      // Excluded for the same reason as the others: the admin overview is for
      // the platform doing things, not a scroll of people signing in. The audit
      // explorer still shows every one.
      "auth.login.email",
      "auth.otp.requested",
      "auth.login.passkey",
    ]),
    liveAuctionsOf(db, deps.now()),
  ]);
  const verdict = await runnerVerdictOf(deps, db, runner);
  const followers = await followerRollup(deps, db);
  const attention = await attentionQueue(deps, db, verdict);
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
    liveAuctions,
    casesByStatus,
    runner,
    runnerVerdict: verdict,
    followers,
    recent,
    attention,
  };
}

/**
 * `excludeActions` exists for one reason: administration now records its own
 * page views (`admin.accessed`), and an admin who refreshes the Overview twelve
 * times would otherwise see a "recent platform activity" list made entirely of
 * themselves looking at it. They are excluded HERE and nowhere else — the audit
 * explorer shows every one of them, and the Overview links straight to that
 * filter, so this is disclosure rather than concealment.
 */
export async function recentActivity(
  db: Db,
  limit: number,
  excludeActions: readonly string[] = [],
): Promise<ActivityRow[]> {
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
    .where(
      excludeActions.length === 0 ? undefined : notInArray(auditLog.action, [...excludeActions]),
    )
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
 * The attention queue.
 *
 * It used to fire on exactly three things — dead jobs, discrepant settlement
 * cases, and the FinOps compliance queue — and the last two are reachable only
 * for an organization that has declared a finance profile. Three orgs out of
 * 349 have one, so 346 tenants could never appear in the platform's own
 * "needs a human" list, whatever happened to them. It showed three rows about
 * one demo org while 1,558 jobs sat unpicked-up for eleven days and forty
 * auctions had been stuck `live` for up to ten days.
 *
 * So it now also carries the two hazards that concern every tenant equally:
 * the job runner's age, and auctions that never ended. Neither is a new
 * business rule — both are a row's own timestamp compared with a budget the
 * platform already uses.
 */
export async function attentionQueue(
  deps: FinopsDeps,
  db: Db,
  runner: RunnerVerdict,
): Promise<AttentionRow[]> {
  const rows: AttentionRow[] = [];
  if (runner.dead > 0) {
    rows.push({
      kind: "runner:dead-jobs",
      subject: `${countNoun(runner.dead, "dead job")} across the platform`,
      orgSlug: null,
      orgName: null,
      href: "/admin/health",
    });
  }
  // The runner is not picking work up. This is the row that would have been
  // raised eleven days ago had age been part of the verdict.
  if (
    runner.oldestQueuedWaitMs !== null &&
    runner.oldestQueuedWaitMs > RUNNER_FRESHNESS_BUDGET_MS
  ) {
    rows.push({
      kind: "runner:stalled",
      subject: `${countNoun(runner.queued, "job")} queued — nothing picked up for ${waitedFor(runner.oldestQueuedWaitMs)}`,
      orgSlug: null,
      orgName: null,
      href: "/admin/health",
    });
  }
  if (runner.overdueSchedules > 0) {
    rows.push({
      kind: "runner:schedule-overdue",
      subject: `${countNoun(runner.overdueSchedules, "schedule")} ${runner.overdueSchedules === 1 ? "is" : "are"} past due`,
      orgSlug: null,
      orgName: null,
      href: "/admin/health",
    });
  }
  // Auctions nobody closed — grouped by org, because the person who needs
  // telling is the organizer, not the platform.
  const staleCutoff = new Date(deps.now() - AUCTION_STALE_BUDGET_MS);
  const stuck = await db
    .select({
      orgSlug: organizations.slug,
      orgName: organizations.name,
      n: sql<number>`count(*)::int`,
      oldest: sql<string>`min(${auctions.createdAt})`,
    })
    .from(auctions)
    .innerJoin(organizations, eq(organizations.id, auctions.orgId))
    .where(and(eq(auctions.status, "live"), lt(auctions.createdAt, staleCutoff)))
    .groupBy(organizations.slug, organizations.name)
    .orderBy(asc(sql`min(${auctions.createdAt})`))
    .limit(20);
  for (const row of stuck) {
    const waited = waitedFor(deps.now() - new Date(row.oldest).getTime());
    rows.push({
      kind: "auction:stuck-live",
      subject: `${countNoun(row.n, "auction")} still live — the oldest for ${waited}`,
      orgSlug: row.orgSlug,
      orgName: row.orgName,
      href: `/admin/orgs/${row.orgSlug}`,
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
      // Deliberately an ADMIN href. `platform:admin` confers zero settlement
      // capability, so `/seasons/…/money/case/…` 404s for the very person
      // reading this queue: the link was a dead end for its only audience.
      // Administration points at what it can open; the panel names where the
      // fix actually lives.
      href: `/admin/orgs/${row.orgSlug}`,
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
        href: `/admin/orgs/${org.slug}`,
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
  /** Cases that can still MOVE — not closed, not voided, not yet settled. */
  readonly openCases: number;
  /** Cases settled but not yet closed: resolved, still awaiting the close. */
  readonly settledCases: number;
  /** Whether the org has DECLARED a finops profile — the platform's own flag. */
  readonly financeDeclared: boolean;
  readonly lastActivityAt: Date | null;
}

export type OrgFilter = "all" | "finance" | "settling" | "quiet";

export interface OrgDirectory {
  readonly rows: readonly OrgDirectoryRow[];
  /** How many organizations match the CURRENT query and filter. */
  readonly total: number;
  /** How many exist at all — the denominator, never confused with the match count. */
  readonly platformTotal: number;
  readonly filter: OrgFilter;
  readonly query: string;
  /** The id to pass as `?after=` for the next page, or null at the end. */
  readonly nextCursor: string | null;
}

const ORG_PAGE = 50;

/**
 * The filter, as SQL.
 *
 * It used to be `rows.filter(...)` in Node over the newest fifty rows, which
 * made every filter a lie about a 50-row sample rather than a question of the
 * platform: three organizations had declared finance and the screen said one,
 * because the other two sat at ranks 252 and 271 of 349. A filter that reads
 * "no organizations yet" while the row exists is worse than no filter, so both
 * the predicate and the count now happen in the database, over everything.
 *
 * Subqueries name and alias their table and qualify the outer reference in raw
 * SQL — see the module header for why interpolation is not safe here.
 */
function orgFilterClause(filter: OrgFilter): SQL | undefined {
  if (filter === "finance") {
    return sql`exists (select 1 from finops_profiles fp where fp.org_id = organizations.id)`;
  }
  if (filter === "settling") {
    // Still-moving OR settled-but-not-closed: both are cases the platform has
    // not finished with, and both are what an operator means by "settling".
    return sql`exists (select 1 from settlement_cases sc where sc.org_id = organizations.id and sc.status not in ('closed', 'voided'))`;
  }
  if (filter === "quiet") {
    return sql`not exists (select 1 from competitions c where c.org_id = organizations.id)`;
  }
  return undefined;
}

/**
 * Keyset pagination. `?after=<id>` resumes strictly after that row in the same
 * (created_at desc, id desc) order, so page two is page two even while rows are
 * being created — which OFFSET would not guarantee. Returns undefined when the
 * cursor names no row, so a stale or forged cursor yields page one rather than
 * an error.
 */
async function orgCursor(db: Db, after: string | undefined): Promise<SQL | undefined> {
  if (after === undefined || after === "") {
    return undefined;
  }
  const [row] = await db
    .select({ id: organizations.id, createdAt: organizations.createdAt })
    .from(organizations)
    .where(eq(organizations.id, after))
    .limit(1);
  if (row === undefined) {
    return undefined;
  }
  return or(
    lt(organizations.createdAt, row.createdAt),
    and(eq(organizations.createdAt, row.createdAt), lt(organizations.id, row.id)),
  );
}

export async function organizationDirectory(
  db: Db,
  options: {
    query?: string | undefined;
    filter?: OrgFilter | undefined;
    after?: string | undefined;
  } = {},
): Promise<OrgDirectory> {
  const query = (options.query ?? "").trim();
  const filter = options.filter ?? "all";
  const clauses: SQL[] = [];
  if (query !== "") {
    const match = or(
      ilike(organizations.name, `%${query}%`),
      ilike(organizations.slug, `%${query}%`),
    );
    if (match !== undefined) {
      clauses.push(match);
    }
  }
  const filterClause = orgFilterClause(filter);
  if (filterClause !== undefined) {
    clauses.push(filterClause);
  }
  const where = clauses.length === 0 ? undefined : and(...clauses);
  const cursor = await orgCursor(db, options.after);
  const pageWhere =
    cursor === undefined ? where : where === undefined ? cursor : and(where, cursor);

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
      openCases: sql<number>`(select count(*)::int from settlement_cases sc where sc.org_id = organizations.id and sc.status not in ('closed', 'voided', 'settled'))`,
      settledCases: sql<number>`(select count(*)::int from settlement_cases sc where sc.org_id = organizations.id and sc.status = 'settled')`,
      financeDeclared: sql<boolean>`exists (select 1 from finops_profiles fp where fp.org_id = organizations.id)`,
      lastActivityAt: sql<
        string | null
      >`(select max(al.at) from audit_log al where al.scope_id = organizations.id)`,
    })
    .from(organizations)
    .where(pageWhere)
    .orderBy(desc(organizations.createdAt), desc(organizations.id))
    .limit(ORG_PAGE + 1);

  const [matching, everything] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(organizations)
      .where(where),
    db.select({ n: sql<number>`count(*)::int` }).from(organizations),
  ]);
  const more = rows.length > ORG_PAGE;
  const page = more ? rows.slice(0, ORG_PAGE) : rows;
  return {
    rows: page.map((row) => ({
      ...row,
      lastActivityAt: row.lastActivityAt === null ? null : new Date(row.lastActivityAt),
    })),
    total: matching[0]?.n ?? 0,
    platformTotal: everything[0]?.n ?? 0,
    filter,
    query,
    nextCursor: more ? (page[page.length - 1]?.id ?? null) : null,
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
    /** Nullable since 0062 — an email-anchored account has no phone. */
    phone: string | null;
    email: string | null;
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
        email: people.email,
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
  /** Nullable since 0062 — an email-anchored account has no phone. */
  readonly phone: string | null;
  readonly email: string | null;
  readonly createdAt: Date;
  readonly orgs: number;
  readonly activeGrants: number;
  readonly lastActivityAt: Date | null;
}

/** PI-1 P6: the directory's profile-aware facets. */
export type UserDirectoryFilter = "all" | "players" | "profiled";

export interface UserDirectory {
  readonly rows: readonly UserDirectoryRow[];
  /** How many people match the current query. */
  readonly total: number;
  /** How many exist at all. */
  readonly platformTotal: number;
  readonly query: string;
  readonly filter: UserDirectoryFilter;
  readonly nextCursor: string | null;
}

const USER_PAGE = 50;

async function userCursor(db: Db, after: string | undefined): Promise<SQL | undefined> {
  if (after === undefined || after === "") {
    return undefined;
  }
  const [row] = await db
    .select({ id: people.id, createdAt: people.createdAt })
    .from(people)
    .where(eq(people.id, after))
    .limit(1);
  if (row === undefined) {
    return undefined;
  }
  return or(
    lt(people.createdAt, row.createdAt),
    and(eq(people.createdAt, row.createdAt), lt(people.id, row.id)),
  );
}

export async function userDirectory(
  db: Db,
  query = "",
  after?: string,
  filter: UserDirectoryFilter = "all",
): Promise<UserDirectory> {
  const term = query.trim();
  /*
   * NAME, PHONE, **AND ADDRESS** — the third one added with 0062.
   *
   * An account can be anchored by an email now, and until this line included it
   * such a person was unreachable from the only directory the platform has: no
   * phone to match, and often no name either until they finish onboarding. An
   * operator who was handed the address had no way to find the row at all,
   * which is the one thing this screen exists to do.
   *
   * `ilike` on a NULL column yields NULL rather than false, and `or` treats
   * that as "not a match" — so a person missing either contact still matches on
   * whichever one they have.
   */
  const search =
    term === ""
      ? undefined
      : or(
          ilike(people.name, `%${term}%`),
          ilike(people.phone, `%${term}%`),
          ilike(people.email, `%${term}%`),
        );
  // PI-1 P6: profile-aware facets. EXISTS subqueries, so the directory stays
  // one indexed pass (registrations_person_idx / player_profiles_person_uq).
  const facet =
    filter === "players"
      ? sql`exists (select 1 from registrations r where r.person_id = ${people.id})`
      : filter === "profiled"
        ? sql`exists (select 1 from player_profiles pp where pp.person_id = ${people.id})`
        : undefined;
  const where = search === undefined ? facet : facet === undefined ? search : and(search, facet);
  const cursor = await userCursor(db, after);
  const pageWhere =
    cursor === undefined ? where : where === undefined ? cursor : and(where, cursor);
  const rows = await db
    .select({
      id: people.id,
      name: people.name,
      phone: people.phone,
      email: people.email,
      createdAt: people.createdAt,
      orgs: sql<number>`(select count(*)::int from org_members m where m.person_id = people.id)`,
      activeGrants: sql<number>`(select count(*)::int from grants g where g.person_id = people.id and g.revoked_at is null)`,
      lastActivityAt: sql<
        string | null
      >`(select max(al.at) from audit_log al where al.actor = people.id)`,
    })
    .from(people)
    .where(pageWhere)
    .orderBy(desc(people.createdAt), desc(people.id))
    .limit(USER_PAGE + 1);
  const [matching, everything] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(people)
      .where(where),
    db.select({ n: sql<number>`count(*)::int` }).from(people),
  ]);
  const more = rows.length > USER_PAGE;
  const page = more ? rows.slice(0, USER_PAGE) : rows;
  return {
    rows: page.map((row) => ({
      ...row,
      lastActivityAt: row.lastActivityAt === null ? null : new Date(row.lastActivityAt),
    })),
    total: matching[0]?.n ?? 0,
    platformTotal: everything[0]?.n ?? 0,
    query: term,
    filter,
    nextCursor: more ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * Does this organization exist? A one-column read, deliberately CHEAP, so the
 * record-existence check can run BEFORE the Suspense boundary.
 *
 * The capability gate was outside Suspense and the existence check was inside
 * it, so `/admin/orgs/no-such-org-xyz` streamed a 200 with a "doesn't exist"
 * body while the same URL returned a hard 404 to everyone without the grant —
 * the boundary had already committed the status line. Reachable in normal use:
 * the audit explorer links every actor to `/admin/users/{actor}`, and 704 of
 * 3,720 audit rows name an actor who is not a person (the nil-ULID system actor
 * authors 65 of them). Gate, then EXIST, then stream.
 */
export async function organizationExists(db: Db, slug: string): Promise<boolean> {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return rows.length > 0;
}

export async function personExists(db: Db, personId: string): Promise<boolean> {
  // `people.id` is char(26); a malformed id is simply a value that matches
  // nothing, so no separate shape check is needed — and none may be added that
  // would 404 differently from a well-formed miss.
  const rows = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  return rows.length > 0;
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
  readonly person: {
    id: string;
    name: string | null;
    /** Nullable since 0062 — an email-anchored account has no phone. */
    phone: string | null;
    email: string | null;
    createdAt: Date;
  };
  readonly orgs: readonly { slug: string; name: string; joinedAt: Date }[];
  readonly grants: readonly UserGrantRow[];
  readonly activity: readonly ActivityRow[];
  /** PI-1 P6: the person's participations, read-only — the platform-admin view
   *  of the same projection the player sees on /me/cricket (no prices here;
   *  money surfaces stay with the money capabilities). */
  readonly seasons: readonly {
    competitionName: string;
    orgName: string;
    startsOn: string | null;
    /** Null in a sport whose pack declares no playing roles (Phase 2). */
    role: string | null;
    /**
     * The season's sport, because THIS row's role belongs to THIS season.
     *
     * /admin lists a person's seasons across every sport at once, so there is
     * no one pack for the screen — the label has to be resolved per row. It was
     * resolved by `roleLabel`, which asks cricket, so a footballer's admin page
     * named their role in lower case whatever they actually played.
     */
    sport: string;
    status: string;
  }[];
}

export async function userDetail(db: Db, personId: string): Promise<UserDetail | null> {
  const [person] = await db
    .select({
      id: people.id,
      name: people.name,
      phone: people.phone,
      email: people.email,
      createdAt: people.createdAt,
    })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  if (person === undefined) {
    return null;
  }
  const [orgRows, seasonRows, grantRows, activity] = await Promise.all([
    db
      .select({ slug: organizations.slug, name: organizations.name, joinedAt: orgMembers.joinedAt })
      .from(orgMembers)
      .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
      .where(eq(orgMembers.personId, personId))
      .orderBy(asc(orgMembers.joinedAt)),
    db
      .select({
        competitionName: competitions.name,
        orgName: organizations.name,
        startsOn: competitions.startsOn,
        role: registrations.role,
        sport: competitions.sport,
        status: registrations.status,
      })
      .from(registrations)
      .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
      .innerJoin(organizations, eq(organizations.id, competitions.orgId))
      .where(eq(registrations.personId, personId))
      .orderBy(asc(competitions.startsOn))
      .limit(50),
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
    seasons: seasonRows,
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
  readonly after?: string | undefined;
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
  readonly nextCursor: string | null;
}

const AUDIT_PAGE = 100;

async function auditCursor(db: Db, after: string | undefined): Promise<SQL | undefined> {
  if (after === undefined || after === "") {
    return undefined;
  }
  const [row] = await db
    .select({ id: auditLog.id, at: auditLog.at })
    .from(auditLog)
    .where(eq(auditLog.id, after))
    .limit(1);
  if (row === undefined) {
    return undefined;
  }
  return or(lt(auditLog.at, row.at), and(eq(auditLog.at, row.at), lt(auditLog.id, row.id)));
}

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
  const cursor = await auditCursor(db, filters.after);
  const pageWhere =
    cursor === undefined ? where : where === undefined ? cursor : and(where, cursor);

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
      .where(pageWhere)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
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
    nextCursor: truncated ? (page[page.length - 1]?.id ?? null) : null,
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
  /** The corrected runner verdict — see `runnerVerdictOf`. */
  readonly runnerVerdict: RunnerVerdict;
  readonly orgs: readonly OrgHealthRow[];
  readonly followers: FollowerRollup;
}

/**
 * Worst first. The cards were sorted by organization NAME, which on a health
 * screen means the one org that is broken can be third — an operator arriving
 * during an incident should not have to read alphabetically.
 */
function healthSeverity(row: OrgHealthRow): number {
  if (row.provider.deadSendJobs > 0 || row.certification?.verdict === "FAIL") {
    return 0;
  }
  if (!row.follower.current || row.provider.channels.some((channel) => channel.failed > 0)) {
    return 1;
  }
  if (row.queue.items.length > 0) {
    return 2;
  }
  return 3;
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
  const sorted = [...orgs].sort(
    (a, b) => healthSeverity(a) - healthSeverity(b) || a.orgName.localeCompare(b.orgName),
  );
  return {
    runner,
    runnerVerdict: await runnerVerdictOf(deps, db, runner),
    orgs: sorted,
    followers: {
      orgs: orgs.length,
      current: orgs.filter((row) => row.follower.current).length,
      behind: orgs.filter((row) => !row.follower.current).length,
      totalBehind: orgs.reduce((sum, row) => sum + row.follower.totalBehind, 0),
    },
  };
}

// --- Command search (CTO §6) -----------------------------------------------------------
//
// DELETED. `adminSearch` was 107 lines with ZERO callers: the command palette
// is a client component fed by a static route list, and nothing ever called
// `adminSearchAction`. Dead code on a governance surface is worse than absent
// code — it reads like a capability, so nobody notices that typing an org name
// into the palette finds nothing. The palette lives outside administration's
// files; wiring it is a palette change, not an admin one, and it should be made
// there deliberately rather than left half-built here. Until then the honest
// state is: administration has no command search, and /admin/orgs?q= and
// /admin/audit?q= are the search surfaces it does have.

// --- Messaging (Phase 3) ---------------------------------------------------------------
//
// The gap this closes: a registered DLT template id lives in an ENVIRONMENT
// VARIABLE, and a shape whose variable is unset refuses to send. That refusal
// is correct — sending against somebody else's registration is worse than not
// sending — but until now it was invisible. Nobody could answer "can this
// deployment actually text people?" without reading a process's environment.
//
// Read only, like everything else here. Administration does not edit template
// TEXT (that would break DLT matching, and the platform carries the regulatory
// risk), and it offers no button to lift a suppression: a person texting START
// lifts their own, and the day support genuinely needs to lift somebody else's
// is the day that conversation happens at review rather than in production.

export interface TemplateStatusRow {
  readonly key: string;
  readonly channel: string;
  readonly category: string;
  readonly locale: string;
  /** The env var carrying this shape's registered DLT id. */
  readonly variable: string;
  /** Whether that variable is set. The VALUE is never read out — it is a
   *  provider identifier, and administration has no reason to display it. */
  readonly configured: boolean;
  /** The registered text, slots and all, so the sentence is auditable here. */
  readonly body: string;
}

export interface SuppressionRow {
  readonly contact: string;
  readonly channel: string;
  readonly scope: string;
  readonly reason: string;
  readonly createdAt: Date;
}

/**
 * Per-shape delivery over a window, counted from the audit rows the sender
 * already writes.
 *
 * No new table and no new write path. `notifyDecision` records
 * `registration.notified`, `registration.notify_failed` and
 * `registration.notify_suppressed`, each naming its template — so the numbers
 * are derived from the platform's own evidence rather than from a counter that
 * could drift from it.
 *
 * Suppressed is reported BESIDE failed and never inside it. A suppressed
 * message is the gate working: somebody said stop, or a club switched a topic
 * off. Folding the two together would send an operator chasing a delivery
 * problem that does not exist — which is the same mistake the organizer-facing
 * counts were fixed for.
 */
export interface TemplateDeliveryRow {
  readonly template: string;
  readonly sent: number;
  readonly failed: number;
  readonly suppressed: number;
}

export interface MessagingOverview {
  readonly templates: readonly TemplateStatusRow[];
  readonly configured: number;
  readonly total: number;
  /** Live suppressions by reason — a rising bounce count is a domain in trouble. */
  readonly byReason: readonly { reason: string; channel: string; count: number }[];
  readonly liveSuppressions: number;
  readonly recent: readonly SuppressionRow[];
  readonly delivery: readonly TemplateDeliveryRow[];
  readonly deliveryWindowDays: number;
}

export async function messagingOverview(
  db: Db,
  env: Readonly<Record<string, string | undefined>>,
): Promise<MessagingOverview> {
  const templates: TemplateStatusRow[] = Object.values(SMS_TEMPLATES).map((template) => ({
    key: template.key,
    channel: template.channel,
    category: template.category,
    locale: template.locale,
    variable: template.providerTemplateEnv,
    configured: (env[template.providerTemplateEnv] ?? "") !== "",
    body: template.body,
  }));
  const windowDays = 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const [byReason, recent, delivered] = await Promise.all([
    db
      .select({
        reason: suppressions.reason,
        channel: suppressions.channel,
        count: sql<number>`count(*)::int`,
      })
      .from(suppressions)
      .where(isNull(suppressions.liftedAt))
      .groupBy(suppressions.reason, suppressions.channel),
    db
      .select({
        contact: suppressions.contact,
        channel: suppressions.channel,
        scope: suppressions.scope,
        reason: suppressions.reason,
        createdAt: suppressions.createdAt,
      })
      .from(suppressions)
      .where(isNull(suppressions.liftedAt))
      .orderBy(desc(suppressions.createdAt))
      .limit(25),
    db
      .select({
        // `->>` and not `->`: the arrow operator returns a JSON string complete
        // with its quotes, which would group "x" and x as different templates.
        // Nullable on purpose: `->>` returns null for a row whose meta has no
        // template key, and typing it as a plain string would make the fallback
        // below unreachable while the value still arrives as null at runtime.
        template: sql<string | null>`${auditLog.meta}->>'template'`,
        action: auditLog.action,
        count: sql<number>`count(*)::int`,
      })
      .from(auditLog)
      .where(
        and(
          inArray(auditLog.action, [
            "registration.notified",
            "registration.notify_failed",
            "registration.notify_suppressed",
          ]),
          gte(auditLog.at, since),
        ),
      )
      .groupBy(sql`${auditLog.meta}->>'template'`, auditLog.action),
  ]);
  const byTemplate = new Map<string, { sent: number; failed: number; suppressed: number }>();
  for (const row of delivered) {
    // Rows written before the suppressed audit carried a template name have no
    // key. They are counted under "(unrecorded)" rather than dropped: a silent
    // omission would understate exactly the shape whose history is longest.
    const key = row.template ?? "(unrecorded)";
    const entry = byTemplate.get(key) ?? { sent: 0, failed: 0, suppressed: 0 };
    if (row.action === "registration.notified") {
      entry.sent += row.count;
    } else if (row.action === "registration.notify_failed") {
      entry.failed += row.count;
    } else {
      entry.suppressed += row.count;
    }
    byTemplate.set(key, entry);
  }
  return {
    templates,
    configured: templates.filter((row) => row.configured).length,
    total: templates.length,
    byReason: [...byReason].sort((a, b) => b.count - a.count),
    liveSuppressions: byReason.reduce((sum, row) => sum + row.count, 0),
    recent,
    delivery: [...byTemplate.entries()]
      .map(([template, counts]) => ({ template, ...counts }))
      .sort((a, b) => b.sent + b.failed + b.suppressed - (a.sent + a.failed + a.suppressed)),
    deliveryWindowDays: windowDays,
  };
}
