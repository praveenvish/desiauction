import { formatPaiseINR, paise } from "@desiauction/core";
import {
  caseFinancial,
  closureTimeline,
  collectionSummary,
  journalSummary,
  isSettlementCapabilitySet,
  outstandingOf,
  parseAccount,
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

import { personLabel } from "../../lib/person-label";

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
  /** Recorded against this team but not yet attested — see `PaymentView.pending`. */
  readonly pending: number;
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
  /**
   * The attester, NAMED. The action's own copy promises the money is "recorded
   * against your name"; the id was fetched and then never rendered, so the
   * promise was kept in the database and broken on the screen.
   */
  readonly attestedByName: string | null;
  readonly providerRef: string | null;
  /** When this payment was recorded (ISO). Already stored — never shown. */
  readonly recordedAt: string;
  /**
   * Money recorded but not yet attested: real to the person who wrote it down,
   * invisible to the books until someone says the cash is in hand. Neither the
   * tiles nor the obligation rows moved when it was recorded, so it read as if
   * nothing had happened at all.
   */
  readonly pending: number;
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
  /**
   * Money recorded and not yet attested, across the whole case. Derived from
   * the payment projection rows the writer maintains — settlement computes no
   * such figure because the books rightly know nothing about it until it is
   * attested. It is reported BESIDE `financial`, never inside it.
   */
  readonly pending: number;
  /** When the case was opened (ISO). The header band had no date on it at all. */
  readonly openedAt: string;
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

/** personId → display name, for the handful of people a case actually names. */
async function personNames(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: people.id, name: people.name, phone: people.phone, email: people.email })
    .from(people)
    .where(inArray(people.id, unique));
  return new Map(rows.map((row) => [row.id, personLabel(row)]));
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
  const [paymentRows, caseRows] = await Promise.all([
    db.select().from(payments).where(eq(payments.caseId, caseId)).orderBy(asc(payments.createdAt)),
    db
      .select({ createdAt: settlementCases.createdAt })
      .from(settlementCases)
      .where(eq(settlementCases.id, caseId))
      .limit(1),
  ]);
  const attesterNames = await personNames(
    db,
    paymentRows.map((row) => row.attestedBy).filter((id): id is string => id !== null),
  );

  // Recorded, not yet attested. `created`/`authorized` are the states where a
  // human has written the money down but nobody has said it arrived; anything
  // beyond them has either landed on the books or failed off them.
  const pendingOf = (row: (typeof paymentRows)[number]): number =>
    row.status === "created" || row.status === "authorized"
      ? Math.max(0, row.amount - row.captured)
      : 0;
  const pendingByTeam = new Map<string, number>();
  let pendingTotal = 0;
  for (const row of paymentRows) {
    const value = pendingOf(row);
    pendingTotal += value;
    pendingByTeam.set(row.teamId, (pendingByTeam.get(row.teamId) ?? 0) + value);
  }

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
      pending: pendingByTeam.get(line.teamId) ?? 0,
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
    pending: pendingTotal,
    openedAt: (caseRows[0]?.createdAt ?? new Date(0)).toISOString(),
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
      attestedByName: row.attestedBy === null ? null : (attesterNames.get(row.attestedBy) ?? null),
      providerRef: row.providerRef,
      recordedAt: row.createdAt.toISOString(),
      pending: pendingOf(row),
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

/**
 * A journal line with its account said in words.
 *
 * `dues:01KYAF06VBRK9DXMD5Q3G550E3:01KYAF06W2Q2Q1V5C7C0N8SZ7X` is a correct
 * account code and is not language. The CODE stays — an auditor reconciling
 * against the ledger needs the literal string — but it stops being the only
 * thing on the row.
 */
export interface JournalLineView extends JournalSummaryLine {
  /** e.g. "Dues — Cup Kings", "Cash received", "Waived on this case". */
  readonly label: string;
}

export interface CaseAuditView {
  readonly timeline: readonly TimelineView[];
  readonly journal: readonly JournalLineView[];
}

const METHOD_WORDS: Record<string, string> = {
  "manual:cash": "Cash received",
  "manual:upi-direct": "UPI received",
  "manual:bank": "Bank transfer received",
  "gateway:razorpay": "Razorpay received",
};

function accountLabel(account: string, names: Map<string, string>): string {
  const parsed = parseAccount(account);
  if (parsed === null) {
    return account;
  }
  switch (parsed.family) {
    case "dues":
      return parsed.teamId === null ? "Dues" : `Dues — ${nameOf(names, parsed.teamId)}`;
    case "case-control":
      return "This case";
    case "funds":
      return parsed.method === null
        ? "Funds"
        : (METHOD_WORDS[parsed.method] ?? `Received by ${parsed.method}`);
    case "waived":
      return "Waived on this case";
    case "refund-liability":
      return "Refunds owed";
  }
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
  const journalLines = journal === null ? [] : journalSummary(journal, caseId);
  return {
    timeline,
    journal: journalLines.map((line) => ({ ...line, label: accountLabel(line.account, names) })),
  };
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
    .select({ id: people.id, name: people.name, phone: people.phone, email: people.email })
    .from(people)
    .where(inArray(people.id, ids));
  return new Map(rows.map((row) => [row.id, personLabel(row)]));
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
  /** Nullable since 0062 — an email-anchored account has no phone. */
  readonly phone: string | null;
  readonly email: string | null;
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
      email: people.email,
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
      email: row.email,
      capabilitySet: row.capabilitySet,
      grantedByName: granterNames.get(row.grantedBy) ?? null,
      grantedAt: iso(row.grantedAt),
    }))
    .sort((a, b) => personLabel(a).localeCompare(personLabel(b)));
}

/** Re-exported so screens never reach past this module into the domain. */
export { outstandingOf };
