"use server";

import { auctionOf, type AuctionRecord } from "@desiauction/auction";
import { newId, withTenantDb, type Db } from "@desiauction/db";
import {
  isPaymentMethod,
  settlementCapabilitiesOf,
  type ObligationBasis,
} from "@desiauction/settlement";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { resolveCompetition, type CompetitionSummary } from "../competition/competitions";
import { dbHandle, systemDb } from "../db";
import { can, grantsFor } from "../orgs/authz";
import { membersOf, resolveTenant, type OrgSummary } from "../orgs/orgs";
import { parseRupees, RUPEE_PARSE_MESSAGES } from "./amount";
import {
  canSettlement,
  issueSettlementGrant,
  revokeSettlementGrant,
  settlementActor,
} from "./authz";
import { closureCeremony, reproduceClosureEvidence, type CeremonyProjection } from "./ceremony";
import { settlementDeps } from "./deps";
import {
  caseAudit,
  caseView,
  dashboardView,
  settlementGrantsOf,
  teamNames,
  type CaseAuditView,
  type CaseView,
  type DashboardView,
  type SettlementGrantRow,
} from "./views";
import {
  attestManualCapture,
  closeCase,
  computeCaseObligations,
  createPayment,
  openCase,
  readyForClosure,
  refundManualPayment,
  reopenCase,
  settleCase,
  verifyCase,
  voidCase,
  waiveObligation,
  type Ack,
} from "./writer";

/**
 * PX-7 Settlement Experience — the internal RPC surface (PX-1 E1/E2).
 *
 * Thin by mandate. Every action here does exactly four things: resolve the
 * session, resolve the tenant, check a SETTLEMENT capability, and call the
 * certified Settlement Writer. It introduces no settlement rule, no state
 * machine, no financial calculation and no second mutation path — the writer
 * remains the single mutation authority (IP-5_ARCHITECTURE §6), and every
 * rejection a screen shows is a reason the writer itself returned.
 *
 * PRP-1 §1 tenant wiring: slug resolution is the documented pre-tenant read on
 * the system pool (the membership join IS the scope); every settlement read and
 * write runs inside a withTenantDb boundary whose orgId comes from it.
 */

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

export interface SettlementViewer {
  readonly personId: string;
  readonly canView: boolean;
  readonly canManage: boolean;
  readonly canCollect: boolean;
  readonly canOverride: boolean;
}

async function viewerOf(db: Db, personId: string, orgId: string): Promise<SettlementViewer> {
  const [canView, canManage, canCollect, canOverride] = await Promise.all([
    canSettlement(db, personId, orgId, "settlement.view"),
    canSettlement(db, personId, orgId, "settlement.manage"),
    canSettlement(db, personId, orgId, "settlement.collect"),
    canSettlement(db, personId, orgId, "settlement.override"),
  ]);
  return { personId, canView, canManage, canCollect, canOverride };
}

/**
 * Every rejection the certified writer can return, said once, in the
 * organizer's words. The KEYS are the domain's closed rejection sets
 * (`RejectionReason`, `CollectionRejection`) plus the writer's own store-level
 * reasons — no reason is invented here and none is re-decided; this is copy.
 */
const REASONS: Record<string, string> = {
  // Authorization and health
  not_authorized: "You do not have permission to do that.",
  settlement_halted:
    "Settlement is halted: the records disagree with the log. Nothing was changed.",
  journal_halted: "The books are halted and cannot record this. Nothing was changed.",
  // Existence
  unknown_case: "That case no longer exists.",
  unknown_auction: "That auction no longer exists.",
  unknown_team: "That team is not on this case.",
  unknown_payment: "That payment no longer exists.",
  source_unfoldable: "The auction log could not be read. Nothing was changed.",
  // Case lifecycle
  auction_not_final: "The auction has not finished. Complete it before opening a case.",
  case_exists: "This auction already has a settlement case.",
  illegal_transition: "That step is not available from where the case stands.",
  obligations_outstanding: "A team still owes money. Collect or waive it first.",
  case_has_postings: "Money has already moved on this case. It can no longer be voided.",
  receipts_missing: "The receipts for this case have not been issued yet.",
  invalid_amount: "That amount cannot be recorded.",
  amount_exceeds_outstanding: "That is more than the team still owes.",
  // Collections
  case_not_collecting: "This case is not collecting. Compute the obligations first.",
  invalid_method: "That payment method is not available.",
  wrong_method_channel: "That payment did not arrive by hand — it cannot be attested.",
  amount_mismatch: "The amount does not match what this payment was created for.",
  refund_exceeds_captured: "That is more than was collected on this payment.",
  envelope_mismatch: "That payment record does not belong to this organization.",
  no_gateway: "That payment method is not available.",
  // Local (this module's own input gates)
  reason_required: "Give a reason — this action is recorded against your name.",
};

/** The closure checks, named for a human. Closure refuses as `verification_failed:<check>`. */
const CLOSURE_CHECKS: Record<string, string> = {
  case_settled: "the case is not settled",
  no_outstanding: "a team still owes money",
  trial_balance_zero: "the books do not balance",
  dues_cleared: "a team's dues wallet is not clear",
  no_refund_liability: "a refund is still owed",
  obligations_match_source: "the obligations no longer match the auction",
  collections_reconcile: "the collections do not reconcile",
};

/** Turn a writer rejection into copy. Unmapped reasons surface VERBATIM, never swallowed. */
function messageFor(reason: string, detail?: string): string {
  const known = REASONS[reason];
  if (known !== undefined) {
    return known;
  }
  if (reason.startsWith("verification_failed:")) {
    const check = reason.slice("verification_failed:".length);
    const named = CLOSURE_CHECKS[check];
    return named === undefined
      ? `Closure verification failed (${check}). The case stays settled.`
      : `Closure verification failed — ${named}. The case stays settled and nothing moved.`;
  }
  // An organizer reading a raw reason code can still call for help with the
  // exact word. Silence would be worse than jargon.
  return `${reason}${detail === undefined || detail === "" ? "" : ` — ${detail}`}`;
}

export type ActionResult = { ok: true; caseId?: string } | { ok: false; error: string };

function resultOf(ack: Ack): ActionResult {
  return ack.ok
    ? { ok: true, caseId: ack.caseId }
    : { ok: false, error: messageFor(ack.reason, ack.detail) };
}

// --- Gate --------------------------------------------------------------------------

interface MoneyGate {
  readonly personId: string;
  readonly competition: CompetitionSummary;
  readonly viewer: SettlementViewer;
}

/** Membership + settlement.view: the one door onto every competition money screen. */
async function moneyGate(slug: string): Promise<MoneyGate | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const viewer = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    (db) => viewerOf(db, session.personId, competition.orgId),
  );
  // Existence privacy: without settlement.view the money surface is not "locked",
  // it is ABSENT — a member with no money grant learns nothing about the books.
  return viewer.canView ? { personId: session.personId, competition, viewer } : null;
}

/** True when the viewer may see this competition's Money tab (nav gate). */
export async function canViewSettlement(slug: string): Promise<boolean> {
  return (await moneyGate(slug)) !== null;
}

/**
 * The org ids where this person holds `settlement.view` — the shell's Money
 * gate. ONE grants read for the whole navigation, expanded by settlement's own
 * capability engine, so the tab and the surface can never disagree about who
 * may see the books.
 */
export async function settlementOrgIds(): Promise<string[]> {
  const session = await currentSession();
  if (session === null) {
    return [];
  }
  const held = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    grantsFor(db, session.personId),
  );
  const orgIds = held
    .filter(
      (grant) =>
        grant.revokedAt === null &&
        grant.scopeType === "org" &&
        settlementCapabilitiesOf(grant.capabilitySet).includes("settlement.view"),
    )
    .map((grant) => grant.scopeId);
  return [...new Set(orgIds)];
}

// --- Console (PX-1 E1) -------------------------------------------------------------

export interface ConsoleAuction {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export interface ConsoleTeam {
  readonly id: string;
  readonly name: string;
}

export interface ConsoleView {
  readonly competition: CompetitionSummary;
  readonly auction: ConsoleAuction | null;
  readonly case: CaseView | null;
  readonly teams: readonly ConsoleTeam[];
  readonly readiness: { ready: boolean; status: string; blockers: readonly string[] } | null;
  readonly viewer: SettlementViewer;
}

export async function settlementConsole(slug: string): Promise<ConsoleView | null> {
  const gate = await moneyGate(slug);
  if (gate === null) {
    return null;
  }
  const { competition, viewer } = gate;
  return withTenantDb(
    dbHandle,
    { personId: gate.personId, orgId: competition.orgId },
    async (db) => {
      const deps = settlementDeps(db);
      const auction: AuctionRecord | null = await auctionOf(db, competition.id);
      const names = await teamNames(db, competition.id);
      const teamList = [...names.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (auction === null) {
        return {
          competition,
          auction: null,
          case: null,
          teams: teamList,
          readiness: null,
          viewer,
        } satisfies ConsoleView;
      }
      const caseRow = await deps.store.loadCaseByAuction(auction.id);
      const view = caseRow === null ? null : await caseView(deps, db, caseRow.caseId);
      const readiness =
        view !== null && view.status === "settled"
          ? await readyForClosure(deps, competition.orgId, view.caseId)
          : null;
      return {
        competition,
        auction: { id: auction.id, name: auction.name, status: auction.status },
        case: view,
        teams: teamList,
        readiness,
        viewer,
      } satisfies ConsoleView;
    },
  );
}

// --- Case review (PX-1 E2) ---------------------------------------------------------

export interface ReviewView {
  readonly competition: CompetitionSummary;
  readonly case: CaseView;
  readonly audit: CaseAuditView;
  readonly ceremony: CeremonyProjection | null;
  readonly readiness: { ready: boolean; status: string; blockers: readonly string[] } | null;
  readonly viewer: SettlementViewer;
}

export async function caseReview(slug: string, caseId: string): Promise<ReviewView | null> {
  const gate = await moneyGate(slug);
  if (gate === null) {
    return null;
  }
  const { competition, viewer } = gate;
  return withTenantDb(
    dbHandle,
    { personId: gate.personId, orgId: competition.orgId },
    async (db) => {
      const deps = settlementDeps(db);
      const view = await caseView(deps, db, caseId);
      // A case from another competition is not this competition's business, and
      // says so by being absent rather than forbidden.
      if (view === null || view.competitionId !== competition.id) {
        return null;
      }
      const [audit, ceremony, readiness] = await Promise.all([
        caseAudit(deps, competition.orgId, caseId, competition.id, db),
        closureCeremony(deps, caseId),
        view.status === "settled"
          ? readyForClosure(deps, competition.orgId, caseId)
          : Promise.resolve(null),
      ]);
      return { competition, case: view, audit, ceremony, readiness, viewer } satisfies ReviewView;
    },
  );
}

/**
 * Replay verification (CTO §6): re-fold the sealed prefixes and prove the
 * evidence reproduces byte-for-byte. Read-only — `reproduceClosureEvidence`
 * writes nothing and the screen may run it as often as a founder likes.
 */
export interface ReplayResult {
  readonly ok: boolean;
  readonly matches: boolean;
  readonly stored: Readonly<Record<string, unknown>> | null;
  readonly reproduced: Readonly<Record<string, unknown>> | null;
}

export async function replayEvidence(slug: string, caseId: string): Promise<ReplayResult | null> {
  const gate = await moneyGate(slug);
  if (gate === null) {
    return null;
  }
  return withTenantDb(
    dbHandle,
    { personId: gate.personId, orgId: gate.competition.orgId },
    async (db) => {
      const deps = settlementDeps(db);
      const view = await caseView(deps, db, caseId);
      if (view === null || view.competitionId !== gate.competition.id) {
        return null;
      }
      const reproduction = await reproduceClosureEvidence(deps, caseId);
      return {
        ok: reproduction.ok,
        matches: reproduction.matches,
        stored: reproduction.stored,
        reproduced: reproduction.reproduced,
      } satisfies ReplayResult;
    },
  );
}

// --- Dashboard (CTO §5) ------------------------------------------------------------

export interface SettlementDashboard {
  readonly org: OrgSummary;
  readonly view: DashboardView;
  readonly viewer: SettlementViewer;
}

/**
 * The desk's CHEAP gate: membership + `settlement.view`, no case folds.
 *
 * Split from `settlementDashboard` on purpose. The page must decide 404-or-not
 * BEFORE it streams anything — a Suspense boundary above a `notFound()` turns a
 * real 404 into a streamed 200 (the PX-2 finding, which applies to notFound()
 * exactly as it does to redirect()). Gate here, then stream the expensive fold
 * underneath.
 */
export async function settlementDeskGate(orgSlug: string): Promise<OrgSummary | null> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return null;
  }
  const canView = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: org.id },
    (db) => canSettlement(db, session.personId, org.id, "settlement.view"),
  );
  return canView ? org : null;
}

export async function settlementDashboard(orgSlug: string): Promise<SettlementDashboard | null> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return null;
  }
  return withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
    const viewer = await viewerOf(db, session.personId, org.id);
    if (!viewer.canView) {
      return null;
    }
    return {
      org,
      view: await dashboardView(settlementDeps(db), db, org.id),
      viewer,
    } satisfies SettlementDashboard;
  });
}

// --- Money authority (PX-1 PX-7 scope: settlement grants on the org page) -----------

export interface MoneyAuthorityView {
  readonly org: OrgSummary;
  readonly grants: readonly SettlementGrantRow[];
  readonly members: readonly { personId: string; name: string | null; phone: string }[];
  /** Whether the VIEWER may hand out money authority — the frozen `grant.issue`. */
  readonly canIssue: boolean;
  /** Whether the VIEWER may open the settlement desk — gates the org page's link. */
  readonly canView: boolean;
}

/**
 * Who holds money authority in this org, and may the viewer change it.
 *
 * Gated by the FROZEN `grant.issue` — the power to hand out money authority
 * rests exactly where the platform already vests the power to hand out
 * authority (IP-5_ARCHITECTURE §20). Settlement grants are NOT visible to the
 * frozen grants UI because the frozen engine cannot expand them; this is the
 * one surface that speaks both vocabularies.
 */
export async function moneyAuthority(orgSlug: string): Promise<MoneyAuthorityView | null> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return null;
  }
  return withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
    // Everything the org page needs about money in ONE pass: the page must not
    // resolve the tenant or re-read grants a second time to decide a link.
    const [granted, members, canIssue, canView] = await Promise.all([
      settlementGrantsOf(db, org.id),
      membersOf(db, org.id),
      can(db, session.personId, { scopeType: "org", scopeId: org.id }, "grant.issue"),
      canSettlement(db, session.personId, org.id, "settlement.view"),
    ]);
    return {
      org,
      grants: granted,
      members: members.map((member) => ({
        personId: member.personId,
        name: member.name,
        phone: member.phone,
      })),
      canIssue,
      canView,
    } satisfies MoneyAuthorityView;
  });
}

const GRANT_ERRORS: Record<string, string> = {
  forbidden: "You do not have permission to hand out money authority.",
  unknown_set: "That is not a settlement role.",
};

/**
 * Issue a settlement grant — the ONE sanctioned cross-context write (§20). This
 * deliberately does NOT reuse the frozen `issueGrantAction`: that path writes an
 * unvalidated capability set with no settlement audit, whereas
 * `issueSettlementGrant` validates the set, is gated by `grant.issue`, and
 * records the act against the money domain.
 */
export async function issueMoneyAuthorityAction(
  orgSlug: string,
  personId: string,
  capabilitySet: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return { ok: false, error: messageFor("not_authorized") };
  }
  const result = await withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, (db) =>
    issueSettlementGrant(db, session.personId, org.id, personId, capabilitySet),
  );
  revalidatePath(`/org/${orgSlug}`, "layout");
  return result.ok
    ? { ok: true }
    : { ok: false, error: GRANT_ERRORS[result.reason] ?? result.reason };
}

export async function revokeMoneyAuthorityAction(
  orgSlug: string,
  grantId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return { ok: false, error: messageFor("not_authorized") };
  }
  const result = await withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, (db) =>
    revokeSettlementGrant(db, session.personId, org.id, grantId),
  );
  revalidatePath(`/org/${orgSlug}`, "layout");
  return result.ok
    ? { ok: true }
    : { ok: false, error: GRANT_ERRORS[result.reason] ?? result.reason };
}

// --- Commands ----------------------------------------------------------------------

/**
 * Run a settlement command: resolve the tenant, build the ACTOR from the grants
 * the person actually holds, and hand over to the writer. The capability check
 * is the writer's own — this never decides authorization, it only reports it.
 */
async function command(
  slug: string,
  run: (
    deps: ReturnType<typeof settlementDeps>,
    actor: Awaited<ReturnType<typeof settlementActor>>,
    context: { db: Db; competition: CompetitionSummary },
  ) => Promise<Ack>,
): Promise<ActionResult> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: messageFor("not_authorized") };
  }
  const result = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    async (db) => {
      const deps = settlementDeps(db);
      const actor = await settlementActor(db, session.personId, competition.orgId);
      return resultOf(await run(deps, actor, { db, competition }));
    },
  );
  revalidatePath(`/competitions/${slug}/money`, "layout");
  return result;
}

export async function openCaseAction(
  slug: string,
  basis: string,
  fixed: Readonly<Record<string, string>> = {},
): Promise<ActionResult> {
  if (basis !== "committed" && basis !== "fixed" && basis !== "none") {
    return { ok: false, error: "Choose how the dues are worked out." };
  }
  // Fixed dues arrive as rupee strings from the form; convert at the edge and
  // refuse the whole command if any one of them is not an exact amount.
  const amounts: Record<string, number> = {};
  if (basis === "fixed") {
    for (const [teamId, raw] of Object.entries(fixed)) {
      if (raw.trim() === "") {
        continue;
      }
      const parsed = parseRupees(raw);
      if (!parsed.ok) {
        return { ok: false, error: RUPEE_PARSE_MESSAGES[parsed.reason] };
      }
      amounts[teamId] = parsed.paise;
    }
    if (Object.keys(amounts).length === 0) {
      return { ok: false, error: "Enter what at least one team owes." };
    }
  }
  return command(slug, async (deps, actor, { db, competition }) => {
    const auction = await auctionOf(db, competition.id);
    if (auction === null) {
      return { ok: false, reason: "unknown_auction" };
    }
    return openCase(deps, actor, {
      commandId: newId(),
      auctionId: auction.id,
      basis: basis satisfies ObligationBasis,
      ...(basis === "fixed" ? { fixed: amounts } : {}),
    });
  });
}

export async function verifyCaseAction(
  slug: string,
  caseId: string,
  reason?: string,
): Promise<ActionResult> {
  // Exiting a discrepancy is an override and REQUIRES a reason; a first
  // verification takes none. The writer decides which applies — this only carries.
  const stated = reason?.trim() ?? "";
  return command(slug, (deps, actor) =>
    stated === ""
      ? verifyCase(deps, actor, caseId, newId())
      : verifyCase(deps, actor, caseId, newId(), stated),
  );
}

export async function computeObligationsAction(
  slug: string,
  caseId: string,
): Promise<ActionResult> {
  return command(slug, (deps, actor) => computeCaseObligations(deps, actor, caseId, newId()));
}

export async function recordPaymentAction(
  slug: string,
  caseId: string,
  teamId: string,
  method: string,
  amount: string,
): Promise<ActionResult> {
  if (!isPaymentMethod(method)) {
    return { ok: false, error: "Choose how the money arrived." };
  }
  if (teamId === "") {
    return { ok: false, error: "Choose which team paid." };
  }
  const parsed = parseRupees(amount);
  if (!parsed.ok) {
    return { ok: false, error: RUPEE_PARSE_MESSAGES[parsed.reason] };
  }
  return command(slug, (deps, actor) =>
    createPayment(deps, actor, {
      paymentId: newId(),
      commandId: newId(),
      caseId,
      teamId,
      method,
      amount: parsed.paise,
    }),
  );
}

/**
 * Manual capture — the human attestation (CTO §4). The attester is ALWAYS the
 * session, never a form field: an attestation names the person who made it.
 */
export async function attestCaptureAction(
  slug: string,
  paymentId: string,
  evidenceRef?: string,
): Promise<ActionResult> {
  return command(slug, (deps, actor) =>
    attestManualCapture(deps, actor, paymentId, newId(), {
      attestedBy: actor.personId,
      ...(evidenceRef !== undefined && evidenceRef.trim() !== ""
        ? { evidenceRef: evidenceRef.trim() }
        : {}),
    }),
  );
}

export async function refundPaymentAction(
  slug: string,
  paymentId: string,
  amount: string,
  reason: string,
): Promise<ActionResult> {
  const parsed = parseRupees(amount);
  if (!parsed.ok) {
    return { ok: false, error: RUPEE_PARSE_MESSAGES[parsed.reason] };
  }
  if (reason.trim() === "") {
    return { ok: false, error: messageFor("reason_required") };
  }
  return command(slug, (deps, actor) =>
    refundManualPayment(deps, actor, paymentId, newId(), {
      amount: parsed.paise,
      reason: reason.trim(),
    }),
  );
}

export async function waiveObligationAction(
  slug: string,
  caseId: string,
  teamId: string,
  amount: string,
  reason: string,
): Promise<ActionResult> {
  const parsed = parseRupees(amount);
  if (!parsed.ok) {
    return { ok: false, error: RUPEE_PARSE_MESSAGES[parsed.reason] };
  }
  if (reason.trim() === "") {
    return { ok: false, error: messageFor("reason_required") };
  }
  return command(slug, (deps, actor) =>
    waiveObligation(deps, actor, caseId, newId(), {
      teamId,
      amount: parsed.paise,
      reason: reason.trim(),
    }),
  );
}

export async function settleCaseAction(slug: string, caseId: string): Promise<ActionResult> {
  return command(slug, (deps, actor) => settleCase(deps, actor, caseId, newId()));
}

export async function closeCaseAction(slug: string, caseId: string): Promise<ActionResult> {
  return command(slug, (deps, actor) => closeCase(deps, actor, caseId, newId()));
}

export async function reopenCaseAction(
  slug: string,
  caseId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim() === "") {
    return { ok: false, error: messageFor("reason_required") };
  }
  return command(slug, (deps, actor) => reopenCase(deps, actor, caseId, newId(), reason.trim()));
}

export async function voidCaseAction(
  slug: string,
  caseId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim() === "") {
    return { ok: false, error: messageFor("reason_required") };
  }
  return command(slug, (deps, actor) => voidCase(deps, actor, caseId, newId(), reason.trim()));
}
