"use server";

import { newId, withTenantDb, type Db } from "@desiauction/db";
import {
  finopsCapabilitiesOf,
  isFiscalYear,
  isSeriesKind,
  isTaxPosture,
} from "@desiauction/financial-operations";
import {
  amendProfile,
  cancelDispatch,
  confirmDispatchManually,
  declareProfile,
  issueCorrection,
  issueInvoice,
  issueReceipt,
  openSeries,
  requeueDeadJob,
  retryDispatch,
  rewindFollower,
  runFollower,
  type FinopsAck,
} from "@desiauction/financial-operations/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { membersOf, resolveTenant, type OrgSummary } from "../orgs/orgs";
import { can, grantsFor } from "../orgs/authz";
import { canFinops, finopsActor, issueFinopsGrant, revokeFinopsGrant } from "./authz";
import { webFinopsDeps } from "./deps";
import {
  deliveriesView,
  documentDetailView,
  financeGrantsOf,
  opsBoardView,
  registerView,
  reconciliationView,
  type DeliveriesView,
  type DocumentDetailView,
  type OpsBoardView,
  type FinanceGrantRow,
  type ReconciliationView,
  type RegisterRow,
} from "./views";

/**
 * PX-8 Financial Operations Workspace — the internal RPC surface (PX-1 F1/F2).
 *
 * Thin by mandate. Every action resolves the session, resolves the tenant,
 * checks a FINOPS capability, and hands over to the certified platform. It
 * introduces no accounting rule, no reconciliation rule, no financial
 * calculation and no second mutation path — the FinOps Writer remains the
 * single mutation authority (IP-6_ARCHITECTURE §6/§14), and every rejection a
 * screen shows is a reason the platform itself returned.
 *
 * PRP-1 §1 tenant wiring: resolution runs under person context; every finops
 * read and write runs inside a withTenantDb boundary whose orgId comes from it.
 */

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

export interface FinopsViewer {
  readonly personId: string;
  readonly canView: boolean;
  /** Profile + numbering series — the lifecycle's entrance (`finops.manage`). */
  readonly canManage: boolean;
  /** Issue receipts, invoices and corrections (`finops.document`). */
  readonly canDocument: boolean;
  readonly canDispatch: boolean;
  readonly canOperate: boolean;
  readonly canClose: boolean;
  readonly canOverride: boolean;
}

/**
 * Each capability is asked for BY NAME. None is inferred from another: the sets
 * are the platform's to compose, and a screen that guesses "manage implies
 * document" would eventually guess wrong.
 */
async function viewerOf(db: Db, personId: string, orgId: string): Promise<FinopsViewer> {
  const [canView, canManage, canDocument, canDispatch, canOperate, canClose, canOverride] =
    await Promise.all([
      canFinops(db, personId, orgId, "finops.view"),
      canFinops(db, personId, orgId, "finops.manage"),
      canFinops(db, personId, orgId, "finops.document"),
      canFinops(db, personId, orgId, "finops.dispatch"),
      canFinops(db, personId, orgId, "finops.operate"),
      canFinops(db, personId, orgId, "finops.close"),
      canFinops(db, personId, orgId, "finops.override"),
    ]);
  return {
    personId,
    canView,
    canManage,
    canDocument,
    canDispatch,
    canOperate,
    canClose,
    canOverride,
  };
}

/**
 * Every rejection the certified platform can return, said once, in an
 * operator's words. The KEYS are the platform's own reasons — none is invented
 * here and none is re-decided; this is copy.
 */
const REASONS: Record<string, string> = {
  // Authorization and health
  not_authorized: "You do not have permission to do that.",
  finops_halted:
    "Financial operations are halted: the records disagree with the log. Nothing was changed.",
  finops_unfoldable: "This organization's finance log could not be read. Nothing was changed.",
  // Existence
  dispatch_unknown: "That delivery no longer exists.",
  job_unknown: "That job no longer exists.",
  export_unknown: "That export no longer exists.",
  source_unknown: "The settlement fact this was made from could not be found.",
  stream_missing: "That record no longer exists.",
  period_missing: "That fiscal year has not been opened.",
  profile_missing: "This organization has not declared its finance profile yet.",
  corrects_unknown: "The document being corrected no longer exists.",
  // Lifecycle refusals
  dispatch_not_failed: "That delivery has not failed, so it cannot be retried.",
  job_not_dead: "That job is not dead — it is still being worked.",
  export_not_completed: "That export has not finished.",
  export_not_failed: "That export has not failed, so it cannot be retried.",
  callback_unsupported: "That channel does not report back, so it cannot be confirmed that way.",
  period_advanced_retry: "The fiscal year moved while this ran. Try again.",
  // Integrity refusals — the platform refusing to speak for something it cannot prove
  document_not_reproducible:
    "That document no longer re-renders to its sealed digest, so it will not be sent. Investigate before retrying.",
  regeneration_digest_mismatch:
    "The regenerated file did not match its sealed digest. Nothing was replaced.",
  party_label_unresolved: "The party on that document could not be resolved.",
  corrects_invalid: "That correction does not reference a correctable document.",
  corrects_mismatch: "That correction does not match the document it names.",
  // Local (this module's own input gates)
  reason_required: "Give a reason — this action is recorded against your name.",
};

function messageFor(reason: string, detail?: string): string {
  const known = REASONS[reason];
  if (known !== undefined) {
    return known;
  }
  // An operator reading a raw reason code can still call for help with the
  // exact word. Silence would be worse than jargon.
  return `${reason}${detail === undefined || detail === "" ? "" : ` — ${detail}`}`;
}

export type FinopsResult = { ok: true } | { ok: false; error: string };

function resultOf(ack: FinopsAck): FinopsResult {
  return ack.ok ? { ok: true } : { ok: false, error: messageFor(ack.reason, ack.detail) };
}

// --- Gate ----------------------------------------------------------------------------

interface FinopsGate {
  readonly personId: string;
  readonly org: OrgSummary;
  readonly viewer: FinopsViewer;
}

/**
 * Membership + `finops.view`: the one door onto every finance surface.
 *
 * Existence privacy: without the grant the workspace is not "locked", it is
 * ABSENT — a member with no finance grant learns nothing about the org's books.
 */
async function finopsGate(orgSlug: string): Promise<FinopsGate | null> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return null;
  }
  const viewer = await withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, (db) =>
    viewerOf(db, session.personId, org.id),
  );
  return viewer.canView ? { personId: session.personId, org, viewer } : null;
}

/**
 * The org ids where this person holds `finops.view` — the shell's Finance gate.
 * ONE grants read for the whole navigation, expanded by the finops capability
 * engine, so the nav and the surface can never disagree about who may look.
 */
export async function finopsOrgIds(): Promise<string[]> {
  const session = await currentSession();
  if (session === null) {
    return [];
  }
  const held = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    grantsFor(db, session.personId),
  );
  return [
    ...new Set(
      held
        .filter(
          (grant) =>
            grant.revokedAt === null &&
            grant.scopeType === "org" &&
            finopsCapabilitiesOf(grant.capabilitySet).includes("finops.view"),
        )
        .map((grant) => grant.scopeId),
    ),
  ];
}

/** The cheap gate a page resolves BEFORE it streams (see PX-7's notFound rule). */
export async function financeGate(orgSlug: string): Promise<OrgSummary | null> {
  return (await finopsGate(orgSlug))?.org ?? null;
}

// --- Finance authority (grants) ------------------------------------------------------

export interface FinanceAuthorityView {
  readonly org: OrgSummary;
  readonly grants: readonly FinanceGrantRow[];
  readonly members: readonly { personId: string; name: string | null; phone: string }[];
  /** Whether the VIEWER may hand out finance authority — the frozen `grant.issue`. */
  readonly canIssue: boolean;
  /** Whether the VIEWER may open the finance workspace — gates the org page's link. */
  readonly canView: boolean;
}

/**
 * Who holds finance authority in this org, and may the viewer change it.
 *
 * ONE read for the whole org page's finance needs: the grants panel AND the
 * workspace link's gate. A door must not cost a second tenant resolution.
 */
export async function financeAuthority(orgSlug: string): Promise<FinanceAuthorityView | null> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return null;
  }
  return withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, async (db) => {
    const [granted, canIssue, canView] = await Promise.all([
      financeGrantsOf(db, org.id),
      can(db, session.personId, { scopeType: "org", scopeId: org.id }, "grant.issue"),
      canFinops(db, session.personId, org.id, "finops.view"),
    ]);
    // Same rule as the settlement panel: the member list is the directory, and
    // it exists only to fill the Grant control.
    const members = canIssue ? await membersOf(db, org.id) : [];
    return {
      org,
      // Same redaction as the settlement panel: the holder's name, not their
      // number, unless the reader can actually hand the role out.
      grants: granted.map((grant) => (canIssue ? grant : { ...grant, phone: "" })),
      members: members.map((member) => ({
        personId: member.personId,
        name: member.name,
        phone: member.phone,
      })),
      canIssue,
      canView,
    } satisfies FinanceAuthorityView;
  });
}

const GRANT_ERRORS: Record<string, string> = {
  forbidden: "You do not have permission to hand out finance authority.",
  unknown_set: "That is not a finance role.",
};

/**
 * Issue a finance grant — IP-6's one sanctioned cross-context write (§19,
 * ADR-5), gated by the FROZEN `grant.issue`. Deliberately NOT the frozen
 * `issueGrantAction`: that path writes an unvalidated set with no finance audit.
 */
export async function issueFinanceAuthorityAction(
  orgSlug: string,
  personId: string,
  capabilitySet: string,
): Promise<FinopsResult> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return { ok: false, error: messageFor("not_authorized") };
  }
  const result = await withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, (db) =>
    issueFinopsGrant(db, session.personId, org.id, personId, capabilitySet),
  );
  revalidatePath(`/org/${orgSlug}`, "layout");
  return result.ok
    ? { ok: true }
    : { ok: false, error: GRANT_ERRORS[result.reason] ?? result.reason };
}

export async function revokeFinanceAuthorityAction(
  orgSlug: string,
  grantId: string,
): Promise<FinopsResult> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return { ok: false, error: messageFor("not_authorized") };
  }
  const result = await withTenantDb(dbHandle, { personId: session.personId, orgId: org.id }, (db) =>
    revokeFinopsGrant(db, session.personId, org.id, grantId),
  );
  revalidatePath(`/org/${orgSlug}`, "layout");
  return result.ok
    ? { ok: true }
    : { ok: false, error: GRANT_ERRORS[result.reason] ?? result.reason };
}

// --- Reads ---------------------------------------------------------------------------

export interface FinanceWorkspace {
  readonly org: OrgSummary;
  readonly board: OpsBoardView;
  readonly register: readonly RegisterRow[];
  readonly viewer: FinopsViewer;
}

export async function financeWorkspace(orgSlug: string): Promise<FinanceWorkspace | null> {
  const gate = await finopsGate(orgSlug);
  if (gate === null) {
    return null;
  }
  return withTenantDb(dbHandle, { personId: gate.personId, orgId: gate.org.id }, async (db) => {
    const deps = webFinopsDeps(db);
    const [board, register] = await Promise.all([
      opsBoardView(deps, db, gate.org.id),
      registerView(deps, gate.org.id),
    ]);
    return { org: gate.org, board, register, viewer: gate.viewer } satisfies FinanceWorkspace;
  });
}

export interface DeliveryWorkspace {
  readonly org: OrgSummary;
  readonly deliveries: DeliveriesView;
  readonly viewer: FinopsViewer;
}

export async function deliveryWorkspace(orgSlug: string): Promise<DeliveryWorkspace | null> {
  const gate = await finopsGate(orgSlug);
  if (gate === null) {
    return null;
  }
  return withTenantDb(dbHandle, { personId: gate.personId, orgId: gate.org.id }, async (db) => {
    const deliveries = await deliveriesView(webFinopsDeps(db), gate.org.id);
    return { org: gate.org, deliveries, viewer: gate.viewer } satisfies DeliveryWorkspace;
  });
}

export interface ReconciliationWorkspace {
  readonly org: OrgSummary;
  readonly reconciliation: ReconciliationView;
  readonly viewer: FinopsViewer;
}

export async function reconciliationWorkspace(
  orgSlug: string,
): Promise<ReconciliationWorkspace | null> {
  const gate = await finopsGate(orgSlug);
  if (gate === null) {
    return null;
  }
  return withTenantDb(dbHandle, { personId: gate.personId, orgId: gate.org.id }, async (db) => {
    const reconciliation = await reconciliationView(webFinopsDeps(db), gate.org.id);
    return { org: gate.org, reconciliation, viewer: gate.viewer } satisfies ReconciliationWorkspace;
  });
}

export interface DocumentWorkspace {
  readonly org: OrgSummary;
  readonly detail: DocumentDetailView;
  readonly viewer: FinopsViewer;
}

export async function documentWorkspace(
  orgSlug: string,
  docId: string,
): Promise<DocumentWorkspace | null> {
  const gate = await finopsGate(orgSlug);
  if (gate === null) {
    return null;
  }
  return withTenantDb(dbHandle, { personId: gate.personId, orgId: gate.org.id }, async (db) => {
    const detail = await documentDetailView(webFinopsDeps(db), gate.org.id, docId);
    if (detail === null) {
      return null;
    }
    return { org: gate.org, detail, viewer: gate.viewer } satisfies DocumentWorkspace;
  });
}

// --- Issuance (PX-8 completion) ------------------------------------------------------
//
// The lifecycle's ENTRANCE. Two `finops.manage` commands dam everything
// downstream: without a declared profile `assembleIssue` refuses
// `profile_missing`, and without an open receipt series the follower's
// auto-issue skips every candidate with `no_open_receipt_series`. Once both
// exist, the certified POLICY carries the rest — the follower issues receipts on
// capture and the issuance policy dispatches them.
//
// `issueDueReceipts` is deliberately NOT exposed as an operator command: the
// follower already calls it (follower.ts) and the policy stays authoritative.

/**
 * Declare the org's finance profile — the one-time act that opens the lifecycle.
 * `autoReceipt` is the platform's own existing field; this toggles it, nothing more.
 */
export async function declareProfileAction(
  orgSlug: string,
  input: { legalName: string; posture: string; gstin?: string; autoReceipt: boolean },
): Promise<FinopsResult> {
  const posture = input.posture;
  if (!isTaxPosture(posture)) {
    return { ok: false, error: "Choose whether this organization is registered for GST." };
  }
  const gstin = input.gstin?.trim() ?? "";
  return command(orgSlug, async (deps, actor) =>
    resultOf(
      await declareProfile(
        deps,
        actor,
        {
          legalName: input.legalName.trim(),
          posture,
          // The platform refuses a GSTIN without registration and demands one
          // with it; the field is simply absent when it does not apply.
          ...(posture === "gst-registered" && gstin !== "" ? { gstin } : {}),
          autoReceipt: input.autoReceipt,
        },
        newId(),
      ),
    ),
  );
}

/** Amend the profile. The platform demands a reason; every version stays addressable. */
export async function amendProfileAction(
  orgSlug: string,
  input: {
    reason: string;
    legalName?: string;
    posture?: string;
    gstin?: string;
    autoReceipt?: boolean;
  },
): Promise<FinopsResult> {
  if (input.reason.trim() === "") {
    return { ok: false, error: messageFor("reason_required") };
  }
  const posture = input.posture;
  if (posture !== undefined && !isTaxPosture(posture)) {
    return { ok: false, error: "Choose whether this organization is registered for GST." };
  }
  const gstin = input.gstin?.trim();
  return command(orgSlug, async (deps, actor) =>
    resultOf(
      await amendProfile(
        deps,
        actor,
        {
          reason: input.reason.trim(),
          ...(input.legalName !== undefined ? { legalName: input.legalName.trim() } : {}),
          ...(posture !== undefined ? { posture } : {}),
          // `null` CLEARS the GSTIN (deregistration); absent leaves it alone.
          ...(posture === "none"
            ? { gstin: null }
            : gstin !== undefined && gstin !== ""
              ? { gstin }
              : {}),
          ...(input.autoReceipt !== undefined ? { autoReceipt: input.autoReceipt } : {}),
        },
        newId(),
      ),
    ),
  );
}

/**
 * Open a numbering lane. ONE per org · kind · fiscal year, forever — the platform
 * makes that structural; this only asks. No number is generated here: `nextNumber`
 * is the platform's own derived projection.
 */
export async function openSeriesAction(
  orgSlug: string,
  input: { kind: string; fy: string; prefix: string },
): Promise<FinopsResult> {
  const kind = input.kind;
  if (!isSeriesKind(kind)) {
    return { ok: false, error: "Choose what this series numbers." };
  }
  if (!isFiscalYear(input.fy)) {
    return { ok: false, error: "Enter a fiscal year like 2026-27." };
  }
  if (input.prefix.trim() === "") {
    return { ok: false, error: "Give the series a prefix, like RCT." };
  }
  return command(orgSlug, async (deps, actor) =>
    resultOf(
      await openSeries(deps, actor, { kind, fy: input.fy, prefix: input.prefix.trim() }, newId()),
    ),
  );
}

/**
 * Issue a receipt for a captured payment — the manual twin of the follower's
 * policy. Same writer, same guards; only the executor differs (a person, named).
 */
export async function issueReceiptAction(
  orgSlug: string,
  seriesId: string,
  paymentId: string,
): Promise<FinopsResult> {
  return command(orgSlug, async (deps, actor) =>
    resultOf(
      await issueReceipt(
        deps,
        { kind: "person", actor, capability: "finops.document" },
        { seriesId, paymentId },
        newId(),
      ),
    ),
  );
}

/** Issue a tax invoice — always a human act; policy never invoices (IP-6 §8.6). */
export async function issueInvoiceAction(
  orgSlug: string,
  seriesId: string,
  caseId: string,
  teamId: string,
): Promise<FinopsResult> {
  return command(orgSlug, async (deps, actor) =>
    resultOf(await issueInvoice(deps, actor, { seriesId, caseId, teamId }, newId())),
  );
}

/**
 * Issue a correction — override-adjacent: it needs a reason and the compensating
 * upstream fact it quotes. The original is never altered, only linked.
 */
export async function issueCorrectionAction(
  orgSlug: string,
  input: {
    seriesId: string;
    correctsDocId: string;
    causeStreamType: string;
    causeStreamId: string;
    causeSeq: string;
    reason: string;
  },
): Promise<FinopsResult> {
  if (input.reason.trim() === "") {
    return { ok: false, error: messageFor("reason_required") };
  }
  const causeStreamType = input.causeStreamType;
  if (causeStreamType !== "payment" && causeStreamType !== "case") {
    return { ok: false, error: "A correction must quote a payment or a case." };
  }
  const seq = Number(input.causeSeq);
  if (!Number.isSafeInteger(seq) || seq < 0) {
    return { ok: false, error: "Quote the event number the correction stands on." };
  }
  return command(orgSlug, async (deps, actor) =>
    resultOf(
      await issueCorrection(
        deps,
        actor,
        {
          seriesId: input.seriesId,
          correctsDocId: input.correctsDocId,
          causeStreamType,
          causeStreamId: input.causeStreamId,
          causeSeq: seq,
          reason: input.reason.trim(),
        },
        newId(),
      ),
    ),
  );
}

// --- Operator actions (existing writers only; no new commands) -----------------------

/**
 * Run a finops command: resolve the tenant, build the ACTOR from the grants the
 * person actually holds, and hand over to the platform. The capability check is
 * the platform's own — this never decides authorization, it only reports it.
 */
async function command(
  orgSlug: string,
  run: (
    deps: ReturnType<typeof webFinopsDeps>,
    actor: Awaited<ReturnType<typeof finopsActor>>,
    context: { org: OrgSummary; db: Db },
  ) => Promise<FinopsResult>,
): Promise<FinopsResult> {
  const session = await requireSession();
  const org = await withTenantDb(dbHandle, { personId: session.personId }, (db) =>
    resolveTenant(db, session.personId, orgSlug),
  );
  if (org === null) {
    return { ok: false, error: messageFor("not_authorized") };
  }
  const result = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: org.id },
    async (db) => {
      const deps = webFinopsDeps(db);
      const actor = await finopsActor(db, session.personId, org.id);
      // `db` is handed on deliberately: any capability check a caller needs must
      // run INSIDE this tenant boundary, never on the ambient handle.
      return run(deps, actor, { org, db });
    },
  );
  revalidatePath(`/org/${orgSlug}/money`, "layout");
  return result;
}

/**
 * Retry a failed delivery. The platform's retry is a NEW dispatch cloned from
 * the failed one — a failed dispatch is terminal and is never resurrected
 * (IP-6 §8.3). This exposes exactly that, and calls it what it is.
 */
export async function retryDeliveryAction(
  orgSlug: string,
  dispatchId: string,
): Promise<FinopsResult> {
  return command(orgSlug, async (deps, actor) =>
    resultOf(await retryDispatch(deps, actor, dispatchId, newId())),
  );
}

/** Cancel a delivery before it lands. The platform demands a reason; so do we. */
export async function cancelDeliveryAction(
  orgSlug: string,
  dispatchId: string,
  reason: string,
): Promise<FinopsResult> {
  if (reason.trim() === "") {
    return { ok: false, error: messageFor("reason_required") };
  }
  return command(orgSlug, async (deps, actor) =>
    resultOf(await cancelDispatch(deps, actor, dispatchId, reason.trim(), newId())),
  );
}

/**
 * Confirm a delivery by hand — for a channel that offers no provider callback.
 * It is recorded AS a human note against your name, never as provider truth.
 */
export async function confirmDeliveryAction(
  orgSlug: string,
  dispatchId: string,
  note: string,
): Promise<FinopsResult> {
  if (note.trim() === "") {
    return { ok: false, error: messageFor("reason_required") };
  }
  return command(orgSlug, async (deps, actor) =>
    resultOf(await confirmDispatchManually(deps, actor, dispatchId, note.trim(), newId())),
  );
}

/** Requeue a dead job — the DLQ's one operator exit. The platform gates it. */
export async function requeueJobAction(orgSlug: string, jobId: string): Promise<FinopsResult> {
  return command(orgSlug, async (deps, actor) => {
    const result = await requeueDeadJob(deps, actor, jobId);
    return result.ok ? { ok: true } : { ok: false, error: messageFor(result.reason ?? "unknown") };
  });
}

/**
 * Run the follower now — the resolution for a stalled ingest.
 *
 * `runFollower` is a raw platform function with no capability check of its own
 * (the runner calls it as the system). A HUMAN invoking it must hold
 * `finops.operate`, so this gates it — inside the tenant boundary, on the same
 * db the command runs on. Idempotent: it consumes from the org's cursors forward.
 */
export async function runFollowerAction(orgSlug: string): Promise<FinopsResult> {
  return command(orgSlug, async (deps, actor, { org, db }) => {
    if (!(await canFinops(db, actor.personId, org.id, "finops.operate"))) {
      return { ok: false, error: messageFor("not_authorized") };
    }
    await runFollower(deps, org.id);
    return { ok: true };
  });
}

/**
 * Rewind the follower — the documented stall/divergence recovery.
 *
 * This drops the org's cursors and re-consumes settlement from the beginning.
 * It is safe because every follower effect is source-keyed and idempotent, but
 * it is not small, so it is gated on `finops.operate` and confirmed in the UI.
 * The platform takes no seq: the rewind is total, and this says so rather than
 * offering a precision it does not have.
 */
export async function rewindFollowerAction(orgSlug: string): Promise<FinopsResult> {
  return command(orgSlug, async (deps, actor, { org, db }) => {
    if (!(await canFinops(db, actor.personId, org.id, "finops.operate"))) {
      return { ok: false, error: messageFor("not_authorized") };
    }
    await rewindFollower(deps, org.id, actor.personId);
    // Re-consume immediately: a rewind that leaves the org at zero until the
    // next runner tick would look like data loss to the operator who ran it.
    await runFollower(deps, org.id);
    return { ok: true };
  });
}
