import { formatPaiseINR, paise } from "@desiauction/core";
import {
  caseFinancial,
  closureTimeline,
  collectionSummary,
  journalSummary,
  isSettlementCapabilitySet,
  outstandingOf,
  reconciledOverlay,
  type CaseFinancial,
  type CaseStatus,
  type ObligationBasis,
  type ReconciledOverlay,
  type TimelineRow,
  type JournalSummaryLine,
} from "@desiauction/settlement";
import {
  competitions,
  grants,
  payments,
  people,
  settlementCases,
  settlementEvents,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";

import type { SettlementDeps } from "./deps";
import { caseFold, journalFold } from "./writer";

/**
 * PX-7 read composition. Every field here is READ from the certified Settlement
 * platform — the case fold (`caseFold`), the frozen pure projections
 * (`caseFinancial`, `collectionSummary`, `closureTimeline`, `journalSummary`,
 * `reconciledOverlay`) and the disposable projection rows the writer itself
 * maintains (`payments`, `settlement_cases`). Nothing is computed here that
 * settlement does not already compute: this module joins money to NAMES and
 * orders rows for a screen. Settlement remains the only authority.
 */

export interface ObligationView {
  readonly teamId: string;
  readonly teamName: string;
  readonly amount: number;
  readonly increased: number;
  readonly reduced: number;
  readonly discharged: number;
  readonly waived: number;
  readonly reinstated: number;
  readonly outstanding: number;
}

export interface PaymentView {
  readonly paymentId: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly method: string;
  readonly status: string;
  readonly amount: number;
  readonly captured: number;
  readonly refundedTotal: number;
  readonly attested: boolean;
  readonly attestedBy: string | null;
  readonly providerRef: string | null;
}

export interface CaseView {
  readonly caseId: string;
  readonly status: CaseStatus;
  readonly basis: ObligationBasis;
  readonly auctionId: string;
  readonly competitionId: string;
  readonly sourceEventCount: number;
  readonly sourceDigest: string;
  readonly foldDigest: string | null;
  readonly closures: number;
  readonly reopenings: number;
  readonly recoveries: number;
  readonly closedAtSeq: number | null;
  readonly financial: CaseFinancial;
  readonly obligations: readonly ObligationView[];
  readonly payments: readonly PaymentView[];
  readonly overlay: ReconciledOverlay;
  readonly evidence: Readonly<Record<string, unknown>> | null;
}

/** teamId → display name, for the whole competition (money joins to names here). */
export async function teamNames(db: Db, competitionId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.competitionId, competitionId));
  return new Map(rows.map((row) => [row.id, row.name]));
}

function nameOf(names: Map<string, string>, teamId: string): string {
  // A team deleted after its obligation was computed must still render as
  // something a human can act on — never a blank cell.
  return names.get(teamId) ?? `Team ${teamId.slice(-6)}`;
}

/** The full case, folded from the log and joined to names. Null if no such case. */
export async function caseView(
  deps: SettlementDeps,
  db: Db,
  caseId: string,
): Promise<CaseView | null> {
  const fold = await caseFold(deps, caseId);
  if (fold === null) {
    return null;
  }
  const projection = fold.projection;
  const names = await teamNames(db, projection.competitionId);
  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.caseId, caseId))
    .orderBy(asc(payments.createdAt));

  const obligations = collectionSummary(projection).map((line) => {
    const raw = projection.obligations[line.teamId];
    return {
      teamId: line.teamId,
      teamName: nameOf(names, line.teamId),
      amount: line.obligation,
      increased: raw?.increased ?? 0,
      reduced: raw?.reduced ?? 0,
      discharged: line.discharged,
      waived: line.waived,
      reinstated: line.reinstated,
      outstanding: line.outstanding,
    } satisfies ObligationView;
  });

  return {
    caseId: projection.caseId,
    status: projection.status,
    basis: projection.basis,
    auctionId: projection.auctionId,
    competitionId: projection.competitionId,
    sourceEventCount: projection.sourceEventCount,
    sourceDigest: projection.sourceDigest,
    foldDigest: projection.foldDigest,
    closures: projection.closures,
    reopenings: projection.reopenings,
    recoveries: projection.recoveries,
    closedAtSeq: projection.closedAtSeq,
    financial: caseFinancial(projection),
    obligations,
    payments: paymentRows.map((row) => ({
      paymentId: row.id,
      teamId: row.teamId,
      teamName: nameOf(names, row.teamId),
      method: row.method,
      status: row.status,
      amount: row.amount,
      captured: row.captured,
      refundedTotal: row.refundedTotal,
      attested: row.attested,
      attestedBy: row.attestedBy,
      providerRef: row.providerRef,
    })),
    overlay: reconciledOverlay(projection),
    evidence: projection.closureEvidence,
  };
}

export interface TimelineView {
  readonly seq: number;
  readonly atMs: number;
  readonly type: string;
  /** Human sentence: names and rupees where the event has them. */
  readonly headline: string;
  /** Who did it, named. Falls back to the actor id when the person is gone. */
  readonly actor: string;
  /** The stated reason for an override — the log records it; the desk shows it. */
  readonly reason: string | null;
}

export interface CaseAuditView {
  readonly timeline: readonly TimelineView[];
  readonly journal: readonly JournalSummaryLine[];
}

const SYSTEM_ACTORS = new Set(["system", "sweep"]);

/**
 * The audit half of Case Review.
 *
 * The ROW SET and its order come from the frozen `closureTimeline` — the log,
 * unchanged. What this adds is READING: the frozen summary renders raw paise and
 * raw team ids (correct for a ledger, unusable at a desk) and drops the `reason`
 * the event already carries. So each row is re-rendered from THE SAME event
 * payload with the team's name, the amount in rupees, and the reason the
 * overrider gave. No amount is recomputed and no event is reinterpreted; an
 * unknown type still renders as the frozen projection describes it.
 */
export async function caseAudit(
  deps: SettlementDeps,
  orgId: string,
  caseId: string,
  competitionId: string,
  db: Db,
): Promise<CaseAuditView> {
  const events = await deps.store.loadStream("case", caseId);
  const [journal, names, actors] = await Promise.all([
    journalFold(deps, orgId),
    teamNames(db, competitionId),
    actorNames(db, events),
  ]);
  const frozen = closureTimeline(events);

  const timeline = frozen.map((row, index) => {
    const event = events[index];
    const payload = event?.payload ?? {};
    const reason = typeof payload["reason"] === "string" ? payload["reason"] : null;
    return {
      seq: row.seq,
      atMs: row.atMs,
      type: row.type,
      headline: headlineOf(row, payload, names),
      actor: actors.get(row.actor) ?? row.actor,
      reason,
    } satisfies TimelineView;
  });
  return { timeline, journal: journal === null ? [] : journalSummary(journal, caseId) };
}

async function actorNames(
  db: Db,
  events: readonly { actor: string }[],
): Promise<Map<string, string>> {
  const ids = [...new Set(events.map((event) => event.actor))].filter(
    (id) => !SYSTEM_ACTORS.has(id),
  );
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: people.id, name: people.name, phone: people.phone })
    .from(people)
    .where(inArray(people.id, ids));
  return new Map(rows.map((row) => [row.id, row.name ?? row.phone]));
}

/** Money events, said the way a treasurer would say them. */
function headlineOf(
  row: TimelineRow,
  payload: Readonly<Record<string, unknown>>,
  names: Map<string, string>,
): string {
  const teamId = typeof payload["teamId"] === "string" ? payload["teamId"] : null;
  const amount = typeof payload["amount"] === "number" ? payload["amount"] : null;
  const team = teamId === null ? null : nameOf(names, teamId);
  if (team === null || amount === null) {
    // Every other type — including one this build has never seen — keeps the
    // frozen projection's own words. Nothing is hidden by not being understood.
    return row.summary;
  }
  const money = formatPaiseINR(paise(amount));
  switch (row.type) {
    case "ObligationDischarged":
      return `${team} paid ${money}`;
    case "ObligationWaived":
      return `${money} of what ${team} owed was waived`;
    case "ObligationReinstated":
      return `${money} was put back on ${team} after a refund`;
    case "ObligationAdjusted":
      return `${team}'s dues were adjusted by ${money}`;
    default:
      return row.summary;
  }
}

// --- The dashboard worklist ---------------------------------------------------------

/** Cases that still want a human. Drives the "needs attention" filter and dot. */
export const ATTENTION_STATUSES: readonly CaseStatus[] = [
  "opened",
  "verified",
  "discrepant",
  "settling",
  "settled",
];

export interface DashboardCase {
  readonly caseId: string;
  readonly status: CaseStatus;
  readonly basis: ObligationBasis;
  readonly competitionId: string;
  readonly competitionName: string;
  readonly competitionSlug: string;
  readonly teamCount: number;
  readonly totalObligations: number;
  readonly discharged: number;
  readonly waived: number;
  readonly outstanding: number;
  readonly needsAttention: boolean;
  readonly closedAtSeq: number | null;
  readonly openedAt: string;
}

export interface DashboardStats {
  readonly attention: number;
  readonly outstanding: number;
  readonly collectedToday: number;
  readonly collectedTodayCount: number;
  readonly closed: number;
}

export interface DashboardView {
  readonly cases: readonly DashboardCase[];
  readonly stats: DashboardStats;
}

/**
 * The org's settlement worklist. Each row's money is the CASE FOLD's own
 * `caseFinancial` — the same projection the console and the ceremony read, so a
 * list row and a case screen can never disagree.
 */
export async function dashboardView(
  deps: SettlementDeps,
  db: Db,
  orgId: string,
): Promise<DashboardView> {
  const rows = await db
    .select({
      caseId: settlementCases.id,
      status: settlementCases.status,
      basis: settlementCases.basis,
      competitionId: settlementCases.competitionId,
      competitionName: competitions.name,
      competitionSlug: competitions.slug,
      closedAtSeq: settlementCases.closedAtSeq,
      createdAt: settlementCases.createdAt,
    })
    .from(settlementCases)
    .innerJoin(competitions, eq(competitions.id, settlementCases.competitionId))
    .where(eq(settlementCases.orgId, orgId))
    .orderBy(desc(settlementCases.createdAt));

  const cases: DashboardCase[] = [];
  for (const row of rows) {
    const fold = await caseFold(deps, row.caseId);
    if (fold === null) {
      // A case whose log will not fold is HALTED, not "zero". It stays on the
      // worklist wearing its stored status and no money — never a guessed total.
      cases.push({
        caseId: row.caseId,
        status: row.status,
        basis: row.basis,
        competitionId: row.competitionId,
        competitionName: row.competitionName,
        competitionSlug: row.competitionSlug,
        teamCount: 0,
        totalObligations: 0,
        discharged: 0,
        waived: 0,
        outstanding: 0,
        needsAttention: true,
        closedAtSeq: row.closedAtSeq,
        openedAt: row.createdAt.toISOString(),
      });
      continue;
    }
    const financial = caseFinancial(fold.projection);
    cases.push({
      caseId: row.caseId,
      status: fold.projection.status,
      basis: fold.projection.basis,
      competitionId: row.competitionId,
      competitionName: row.competitionName,
      competitionSlug: row.competitionSlug,
      teamCount: Object.keys(fold.projection.obligations).length,
      totalObligations: financial.totalObligations,
      discharged: financial.discharged,
      waived: financial.waived,
      outstanding: financial.outstanding,
      needsAttention: ATTENTION_STATUSES.includes(fold.projection.status),
      closedAtSeq: fold.projection.closedAtSeq,
      openedAt: row.createdAt.toISOString(),
    });
  }

  return { cases, stats: await dashboardStats(db, orgId, cases) };
}

/**
 * "Collected today" reads the CAPTURED amount off the payment projection rows
 * whose PaymentCaptured event landed since `sinceMs`. The log supplies only the
 * TIMING; every rupee comes from the payment fold's own `captured` counter. No
 * money is recomputed here.
 */
async function dashboardStats(
  db: Db,
  orgId: string,
  cases: readonly DashboardCase[],
): Promise<DashboardStats> {
  const captured = await capturedSince(db, orgId, startOfToday());
  return {
    attention: cases.filter((row) => row.needsAttention).length,
    outstanding: cases.reduce((sum, row) => sum + row.outstanding, 0),
    collectedToday: captured.total,
    collectedTodayCount: captured.count,
    closed: cases.filter((row) => row.status === "closed").length,
  };
}

/** Local midnight — the organizer's "today", not UTC's. */
function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export async function capturedSince(
  db: Db,
  orgId: string,
  sinceMs: number,
): Promise<{ total: number; count: number }> {
  const captures = await db
    .selectDistinct({ paymentId: settlementEvents.streamId })
    .from(settlementEvents)
    .where(
      and(
        eq(settlementEvents.orgId, orgId),
        eq(settlementEvents.streamType, "payment"),
        eq(settlementEvents.type, "PaymentCaptured"),
        gte(settlementEvents.atMs, sinceMs),
      ),
    );
  if (captures.length === 0) {
    return { total: 0, count: 0 };
  }
  const rows = await db
    .select({ captured: payments.captured })
    .from(payments)
    .where(
      and(
        eq(payments.orgId, orgId),
        inArray(
          payments.id,
          captures.map((row) => row.paymentId),
        ),
      ),
    );
  return {
    total: rows.reduce((sum, row) => sum + row.captured, 0),
    count: rows.length,
  };
}

/** The obligation rows a team still owes — the console's outstanding indicator. */
export function outstandingTeams(view: CaseView): readonly ObligationView[] {
  return view.obligations.filter((obligation) => obligation.outstanding > 0);
}

// --- Money authority ----------------------------------------------------------------

export interface SettlementGrantRow {
  readonly grantId: string;
  readonly personId: string;
  readonly name: string | null;
  readonly phone: string;
  readonly capabilitySet: string;
  /** Who handed this role over — provenance the table has always stored. */
  readonly grantedByName: string | null;
  /** When they handed it over (ISO). */
  readonly grantedAt: string | null;
}

/**
 * The org's ACTIVE settlement grants, joined to the people who hold them.
 *
 * A read over identity's own `grants` table, filtered to sets settlement's
 * engine recognises. Identity remains the storage owner — this only asks which
 * of its rows speak settlement's vocabulary, which is exactly what the capability
 * partition (§20) makes a safe question to ask.
 */
export async function settlementGrantsOf(db: Db, orgId: string): Promise<SettlementGrantRow[]> {
  const rows = await db
    .select({
      grantId: grants.id,
      personId: grants.personId,
      name: people.name,
      phone: people.phone,
      capabilitySet: grants.capabilitySet,
      grantedBy: grants.grantedBy,
      grantedAt: grants.createdAt,
    })
    .from(grants)
    .innerJoin(people, eq(people.id, grants.personId))
    .where(and(eq(grants.scopeType, "org"), eq(grants.scopeId, orgId), isNull(grants.revokedAt)));
  const mine = rows.filter((row) => isSettlementCapabilitySet(row.capabilitySet));
  // Granter names in one extra read rather than a second join onto `people`:
  // the alias would make drizzle infer the row shape away entirely.
  const granterIds = [...new Set(mine.map((row) => row.grantedBy).filter((id) => id !== ""))];
  const granterRows =
    granterIds.length === 0
      ? []
      : await db
          .select({ id: people.id, name: people.name })
          .from(people)
          .where(inArray(people.id, granterIds));
  const granterNames = new Map(granterRows.map((row) => [row.id, row.name]));
  const iso = (value: Date | string | null): string | null =>
    value === null
      ? null
      : value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString();
  return mine
    .map((row) => ({
      grantId: row.grantId,
      personId: row.personId,
      name: row.name,
      phone: row.phone,
      capabilitySet: row.capabilitySet,
      grantedByName: granterNames.get(row.grantedBy) ?? null,
      grantedAt: iso(row.grantedAt),
    }))
    .sort((a, b) => (a.name ?? a.phone).localeCompare(b.name ?? b.phone));
}

/** Re-exported so screens never reach past this module into the domain. */
export { outstandingOf };
