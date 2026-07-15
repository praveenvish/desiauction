/**
 * The OrgJournal aggregate (IP-5_ARCHITECTURE §9): the ONLY place money moves.
 *
 * Every financial mutation is one balanced, append-only, double-entry posting on
 * the org's single journal stream. Wallets are VIEWS over the fold — no balance
 * is stored anywhere, in any table, ever. Three properties are machine-enforced
 * by the reducer rather than documented and hoped for:
 *
 *   1. legs sum to zero            → `unbalanced_posting`
 *   2. legs match a CLOSED template → `template_shape_mismatch`
 *      (there is no free-form journal entry: money moves in named shapes only)
 *   3. one cause, one posting       → `duplicate_posting_source`
 *
 * plus conservation: no account may be driven below zero against its natural
 * side (`negative_account_flow`) — you cannot refund money you never collected,
 * nor discharge dues that do not exist.
 */

import { addPaise, deductPaise, paise, type Paise } from "@desiauction/core";

import {
  arr,
  money,
  num,
  obj,
  str,
  type ReplayFailure,
  type SettlementEventEnvelope,
} from "./events";

// --- The chart of accounts (closed set of families) --------------------------------

export type AccountFamily = "dues" | "case-control" | "funds" | "waived" | "refund-liability";

export const REFUND_LIABILITY_ACCOUNT = "refund-liability";

export function duesAccount(caseId: string, teamId: string): string {
  return `dues:${caseId}:${teamId}`;
}

export function caseControlAccount(caseId: string): string {
  return `case:${caseId}`;
}

export function fundsAccount(method: string): string {
  return `funds:${method}`;
}

export function waivedAccount(caseId: string): string {
  return `waived:${caseId}`;
}

export interface ParsedAccount {
  readonly family: AccountFamily;
  readonly caseId: string | null;
  readonly teamId: string | null;
  readonly method: string | null;
}

/** Fail-closed: an account outside the closed families does not parse, so it
 * cannot appear in a posting that folds. */
export function parseAccount(account: string): ParsedAccount | null {
  const parts = account.split(":");
  const head = parts[0];
  if (head === "dues" && parts.length === 3 && parts[1] !== "" && parts[2] !== "") {
    return { family: "dues", caseId: parts[1] ?? null, teamId: parts[2] ?? null, method: null };
  }
  if (head === "case" && parts.length === 2 && parts[1] !== "") {
    return { family: "case-control", caseId: parts[1] ?? null, teamId: null, method: null };
  }
  if (head === "funds" && parts.length >= 2 && parts[1] !== "") {
    return {
      family: "funds",
      caseId: null,
      teamId: null,
      method: parts.slice(1).join(":"),
    };
  }
  if (head === "waived" && parts.length === 2 && parts[1] !== "") {
    return { family: "waived", caseId: parts[1] ?? null, teamId: null, method: null };
  }
  if (account === REFUND_LIABILITY_ACCOUNT) {
    return { family: "refund-liability", caseId: null, teamId: null, method: null };
  }
  return null;
}

/**
 * The natural side of each family. Conservation is enforced against it: a
 * debit-natural account may never hold more credits than debits (and vice
 * versa) — the arithmetic statement of "money you never had cannot move".
 */
const NATURAL_SIDE: Record<AccountFamily, "debit" | "credit"> = {
  dues: "debit",
  "case-control": "credit",
  funds: "debit",
  waived: "debit",
  "refund-liability": "credit",
};

// --- Postings (the closed template set) --------------------------------------------

export type PostingTemplate =
  "obligation" | "collection" | "overpaid-collection" | "waiver" | "refund";

export const POSTING_TEMPLATES: readonly PostingTemplate[] = [
  "obligation",
  "collection",
  "overpaid-collection",
  "waiver",
  "refund",
];

export function isPostingTemplate(value: string): value is PostingTemplate {
  return (POSTING_TEMPLATES as readonly string[]).includes(value);
}

export type LegDirection = "debit" | "credit";

export interface PostingLeg {
  readonly account: string;
  readonly direction: LegDirection;
  readonly amount: number; // integer paise, always non-negative (direction carries sign)
}

export interface BuiltPosting {
  readonly template: PostingTemplate;
  readonly legs: readonly PostingLeg[];
}

/**
 * Obligation: recognise a case's dues. ONE cause (ObligationsComputed) → ONE
 * posting (§9.4/§17.7): each team's dues account is debited and the case's
 * control account is credited with the total. Legs are ordered by teamId, so
 * the same computation always serialises to the same bytes.
 */
export function buildObligationPosting(
  caseId: string,
  items: readonly { readonly teamId: string; readonly amount: number }[],
): BuiltPosting {
  const ordered = [...items].sort((a, b) =>
    a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0,
  );
  const legs: PostingLeg[] = ordered.map((item) => ({
    account: duesAccount(caseId, item.teamId),
    direction: "debit",
    amount: paise(item.amount),
  }));
  const total = ordered.reduce<Paise>((sum, item) => addPaise(sum, paise(item.amount)), paise(0));
  legs.push({ account: caseControlAccount(caseId), direction: "credit", amount: total });
  return { template: "obligation", legs };
}

/**
 * Collection: money in. When the capture exceeds what the team still owes (a
 * waiver raced the order), the excess lands in `refund-liability` in the SAME
 * balanced posting — the Overpaid Collection shape. The template is chosen
 * deterministically by the numbers, never by a caller.
 */
export function buildCollectionPosting(
  caseId: string,
  teamId: string,
  method: string,
  amount: number,
  outstanding: number,
): BuiltPosting {
  const captured = paise(amount);
  const owed = paise(outstanding);
  if (captured <= owed) {
    return {
      template: "collection",
      legs: [
        { account: fundsAccount(method), direction: "debit", amount: captured },
        { account: duesAccount(caseId, teamId), direction: "credit", amount: captured },
      ],
    };
  }
  const excess = deductPaise(captured, owed);
  const excessAmount = excess.ok ? excess.value : paise(0);
  return {
    template: "overpaid-collection",
    legs: [
      { account: fundsAccount(method), direction: "debit", amount: captured },
      { account: duesAccount(caseId, teamId), direction: "credit", amount: owed },
      { account: REFUND_LIABILITY_ACCOUNT, direction: "credit", amount: excessAmount },
    ],
  };
}

/** Waiver: audited forgiveness — visible in its own account, never a quiet zeroing. */
export function buildWaiverPosting(caseId: string, teamId: string, amount: number): BuiltPosting {
  return {
    template: "waiver",
    legs: [
      { account: waivedAccount(caseId), direction: "debit", amount: paise(amount) },
      { account: duesAccount(caseId, teamId), direction: "credit", amount: paise(amount) },
    ],
  };
}

/**
 * Refund: money out, LIABILITY FIRST — the over-collected excess is returned
 * before any legitimately collected due is reversed. Only the dues-debiting
 * portion reinstates an obligation (§8.1), which is exactly why an overpayment
 * can be refunded without resurrecting a debt that was already settled.
 */
export function buildRefundPosting(
  caseId: string,
  teamId: string,
  method: string,
  amount: number,
  remainingLiability: number,
): BuiltPosting {
  const refund = paise(amount);
  const liability = paise(remainingLiability);
  const fromLiability = refund <= liability ? refund : liability;
  const fromDuesResult = deductPaise(refund, fromLiability);
  const fromDues = fromDuesResult.ok ? fromDuesResult.value : paise(0);
  const legs: PostingLeg[] = [];
  if (fromLiability > 0) {
    legs.push({
      account: REFUND_LIABILITY_ACCOUNT,
      direction: "debit",
      amount: fromLiability,
    });
  }
  if (fromDues > 0) {
    legs.push({ account: duesAccount(caseId, teamId), direction: "debit", amount: fromDues });
  }
  legs.push({ account: fundsAccount(method), direction: "credit", amount: refund });
  return { template: "refund", legs };
}

/** How much of a refund reinstates the team's obligation (the dues-debiting part). */
export function refundReinstatement(posting: BuiltPosting, caseId: string, teamId: string): Paise {
  const account = duesAccount(caseId, teamId);
  return posting.legs.reduce<Paise>(
    (sum, leg) =>
      leg.account === account && leg.direction === "debit" ? addPaise(sum, paise(leg.amount)) : sum,
    paise(0),
  );
}

// --- Shape closure: what makes the template set a LAW, not a convention -------------

function legsBalance(legs: readonly PostingLeg[]): boolean {
  let debits = paise(0);
  let credits = paise(0);
  for (const leg of legs) {
    if (leg.direction === "debit") {
      debits = addPaise(debits, paise(leg.amount));
    } else {
      credits = addPaise(credits, paise(leg.amount));
    }
  }
  return debits === credits;
}

function sideTotal(legs: readonly PostingLeg[], direction: LegDirection): Paise {
  return legs
    .filter((leg) => leg.direction === direction)
    .reduce<Paise>((sum, leg) => addPaise(sum, paise(leg.amount)), paise(0));
}

function familiesOf(
  legs: readonly PostingLeg[],
  direction: LegDirection,
): (AccountFamily | null)[] {
  return legs
    .filter((leg) => leg.direction === direction)
    .map((leg) => parseAccount(leg.account)?.family ?? null);
}

/**
 * Validate a posting against its named template. This is the mechanism behind
 * "no free-form journal entry exists": a posting whose legs do not match the
 * shape its template declares cannot fold, so it cannot be money.
 */
export function validatePostingShape(
  template: PostingTemplate,
  legs: readonly PostingLeg[],
): boolean {
  if (legs.length < 2 || !legsBalance(legs)) {
    return false;
  }
  if (
    legs.some(
      (leg) =>
        parseAccount(leg.account) === null || !Number.isSafeInteger(leg.amount) || leg.amount < 0,
    )
  ) {
    return false;
  }
  const debitFamilies = familiesOf(legs, "debit");
  const creditFamilies = familiesOf(legs, "credit");

  switch (template) {
    case "obligation": {
      // N dues debits (one case) + exactly one case-control credit.
      if (creditFamilies.length !== 1 || creditFamilies[0] !== "case-control") {
        return false;
      }
      if (debitFamilies.length < 1 || debitFamilies.some((family) => family !== "dues")) {
        return false;
      }
      const control = legs.find((leg) => leg.direction === "credit");
      const caseId = control === undefined ? null : (parseAccount(control.account)?.caseId ?? null);
      return (
        caseId !== null &&
        legs
          .filter((leg) => leg.direction === "debit")
          .every((leg) => parseAccount(leg.account)?.caseId === caseId)
      );
    }
    case "collection": {
      return (
        legs.length === 2 &&
        debitFamilies.length === 1 &&
        debitFamilies[0] === "funds" &&
        creditFamilies.length === 1 &&
        creditFamilies[0] === "dues"
      );
    }
    case "overpaid-collection": {
      // One funds debit; the credit side splits dues + refund-liability.
      if (legs.length !== 3 || debitFamilies.length !== 1 || debitFamilies[0] !== "funds") {
        return false;
      }
      const sorted = [...creditFamilies].sort();
      return (
        sorted.length === 2 &&
        sorted[0] === "dues" &&
        sorted[1] === "refund-liability" &&
        sideTotal(legs, "credit") === sideTotal(legs, "debit")
      );
    }
    case "waiver": {
      return (
        legs.length === 2 &&
        debitFamilies.length === 1 &&
        debitFamilies[0] === "waived" &&
        creditFamilies.length === 1 &&
        creditFamilies[0] === "dues"
      );
    }
    case "refund": {
      // Exactly one funds credit; debits are liability and/or dues (liability-first).
      if (creditFamilies.length !== 1 || creditFamilies[0] !== "funds") {
        return false;
      }
      if (debitFamilies.length < 1 || debitFamilies.length > 2) {
        return false;
      }
      return debitFamilies.every((family) => family === "refund-liability" || family === "dues");
    }
  }
}

// --- The fold ----------------------------------------------------------------------

export interface AccountBalance {
  debits: number;
  credits: number;
}

export interface PostingRecord {
  readonly postingId: string;
  readonly eventSeq: number;
  /** The event's server time — carried so recovery can heal the row exactly. */
  readonly atMs: number;
  readonly template: PostingTemplate;
  readonly caseId: string | null;
  readonly teamId: string | null;
  readonly sourceStream: string;
  readonly sourceSeq: number;
  readonly legs: readonly PostingLeg[];
  readonly memo: string | null;
}

export interface ReceiptRecord {
  readonly receiptId: string;
  readonly receiptNo: number;
  readonly caseId: string;
  readonly teamId: string;
  readonly amount: number;
  credited: number;
}

export interface JournalProjection {
  accounts: Record<string, AccountBalance>;
  postings: Record<string, PostingRecord>;
  /** `${sourceStream}#${sourceSeq}` → postingId. One cause, one posting. */
  sources: Record<string, string>;
  receipts: Record<string, ReceiptRecord>;
  receiptCount: number;
  creditNoteCount: number;
  recoveries: number;
  lastSeq: number;
  eventCount: number;
}

export type JournalReplayResult = { ok: true; projection: JournalProjection } | ReplayFailure;

export function emptyJournal(): JournalProjection {
  return {
    accounts: {},
    postings: {},
    sources: {},
    receipts: {},
    receiptCount: 0,
    creditNoteCount: 0,
    recoveries: 0,
    lastSeq: 0,
    eventCount: 0,
  };
}

function applyLegs(projection: JournalProjection, legs: readonly PostingLeg[]): boolean {
  const touched = new Set<string>();
  for (const leg of legs) {
    const balance = projection.accounts[leg.account] ?? { debits: 0, credits: 0 };
    if (leg.direction === "debit") {
      balance.debits = addPaise(paise(balance.debits), paise(leg.amount));
    } else {
      balance.credits = addPaise(paise(balance.credits), paise(leg.amount));
    }
    projection.accounts[leg.account] = balance;
    touched.add(leg.account);
  }
  // Conservation: every touched account must stay non-negative on its natural side.
  for (const account of touched) {
    const parsed = parseAccount(account);
    const balance = projection.accounts[account];
    if (parsed === null || balance === undefined) {
      return false;
    }
    const natural = NATURAL_SIDE[parsed.family];
    const positive = natural === "debit" ? balance.debits : balance.credits;
    const negative = natural === "debit" ? balance.credits : balance.debits;
    if (!deductPaise(paise(positive), paise(negative)).ok) {
      return false;
    }
  }
  return true;
}

/**
 * Fold the journal stream into accounts, postings and documents. Deterministic
 * and fail-closed. The genesis fold is THE definition of the journal (§14) —
 * checkpoints (checkpoint.ts) are byte-verified acceleration and hold no
 * independent authority.
 */
export function replayJournal(events: readonly SettlementEventEnvelope[]): JournalReplayResult {
  return foldJournalEvents(emptyJournal(), events);
}

/** Continue a fold from an existing projection (used by checkpointed verification). */
export function foldJournalEvents(
  from: JournalProjection,
  events: readonly SettlementEventEnvelope[],
): JournalReplayResult {
  const projection = from;

  for (const event of events) {
    const fail = (reason: ReplayFailure["reason"]): JournalReplayResult => ({
      ok: false,
      atSeq: event.seq,
      reason,
    });
    if (event.seq !== projection.lastSeq + 1) {
      return fail("sequence_gap");
    }

    switch (event.type) {
      case "JournalPosted": {
        const postingId = str(event.payload, "postingId");
        const template = str(event.payload, "template");
        const rawLegs = arr(event.payload, "legs");
        const source = obj(event.payload["source"]);
        const sourceStream = source === null ? null : str(source, "stream");
        const sourceSeq = source === null ? null : num(source, "seq");
        const memo = str(event.payload, "memo");
        if (
          postingId === null ||
          template === null ||
          !isPostingTemplate(template) ||
          rawLegs === null ||
          sourceStream === null ||
          sourceSeq === null ||
          !Number.isSafeInteger(sourceSeq) ||
          sourceSeq < 1
        ) {
          return fail("malformed_posting");
        }
        if (projection.postings[postingId] !== undefined) {
          return fail("malformed_posting");
        }
        const legs: PostingLeg[] = [];
        for (const raw of rawLegs) {
          const leg = obj(raw);
          const account = leg === null ? null : str(leg, "account");
          const direction = leg === null ? null : str(leg, "direction");
          const amount = leg === null ? null : money(leg, "amount");
          if (
            account === null ||
            amount === null ||
            (direction !== "debit" && direction !== "credit")
          ) {
            return fail("malformed_posting");
          }
          legs.push({ account, direction, amount });
        }
        if (!legsBalance(legs)) {
          return fail("unbalanced_posting");
        }
        if (!validatePostingShape(template, legs)) {
          return fail("template_shape_mismatch");
        }
        const sourceKey = `${sourceStream}#${String(sourceSeq)}`;
        if (projection.sources[sourceKey] !== undefined) {
          return fail("duplicate_posting_source");
        }
        if (!applyLegs(projection, legs)) {
          return fail("negative_account_flow");
        }
        const dues = legs
          .map((leg) => parseAccount(leg.account))
          .find((parsed) => parsed !== null && parsed.family === "dues");
        const control = legs
          .map((leg) => parseAccount(leg.account))
          .find((parsed) => parsed !== null && parsed.family === "case-control");
        projection.postings[postingId] = {
          postingId,
          eventSeq: event.seq,
          atMs: event.atMs,
          template,
          caseId: dues?.caseId ?? control?.caseId ?? null,
          teamId: template === "obligation" ? null : (dues?.teamId ?? null),
          sourceStream,
          sourceSeq,
          legs,
          memo,
        };
        projection.sources[sourceKey] = postingId;
        break;
      }

      case "ReceiptIssued": {
        const receiptId = str(event.payload, "receiptId");
        const receiptNo = num(event.payload, "receiptNo");
        const caseId = str(event.payload, "caseId");
        const teamId = str(event.payload, "teamId");
        const amount = money(event.payload, "amount");
        const covers = arr(event.payload, "coversPostings");
        if (
          receiptId === null ||
          receiptNo === null ||
          caseId === null ||
          teamId === null ||
          amount === null ||
          covers === null ||
          projection.receipts[receiptId] !== undefined
        ) {
          return fail("malformed_receipt");
        }
        // Dense per-org series, allocated in journal order: a gap is a halt.
        if (receiptNo !== projection.receiptCount + 1) {
          return fail("malformed_receipt");
        }
        for (const raw of covers) {
          if (typeof raw !== "string" || projection.postings[raw] === undefined) {
            return fail("unknown_posting");
          }
        }
        projection.receipts[receiptId] = {
          receiptId,
          receiptNo,
          caseId,
          teamId,
          amount,
          credited: 0,
        };
        projection.receiptCount += 1;
        break;
      }

      case "CreditNoteIssued": {
        const noteNo = num(event.payload, "noteNo");
        const receiptId = str(event.payload, "receiptId");
        const amount = money(event.payload, "amount");
        const reason = str(event.payload, "reason");
        if (
          str(event.payload, "noteId") === null ||
          noteNo === null ||
          receiptId === null ||
          amount === null ||
          reason === null
        ) {
          return fail("malformed_receipt");
        }
        const receipt = projection.receipts[receiptId];
        if (receipt === undefined) {
          return fail("unknown_receipt");
        }
        if (noteNo !== projection.creditNoteCount + 1) {
          return fail("malformed_receipt");
        }
        // A receipt is never edited (invariant 24) — it is credited, and never
        // beyond what it was issued for.
        const headroom = deductPaise(paise(receipt.amount), paise(receipt.credited));
        if (!headroom.ok || !deductPaise(headroom.value, paise(amount)).ok) {
          return fail("malformed_receipt");
        }
        receipt.credited = addPaise(paise(receipt.credited), paise(amount));
        projection.creditNoteCount += 1;
        break;
      }

      case "JournalRecovered": {
        projection.recoveries += 1;
        break;
      }

      default:
        return fail("unknown_event_type");
    }

    projection.lastSeq = event.seq;
    projection.eventCount += 1;
  }

  return { ok: true, projection };
}

// --- Wallets: derived views, never rows --------------------------------------------

export interface Wallet {
  readonly account: string;
  readonly family: AccountFamily;
  readonly debits: number;
  readonly credits: number;
  /** Signed against the account's natural side — always ≥ 0 by conservation. */
  readonly balance: number;
}

export function walletOf(projection: JournalProjection, account: string): Wallet | null {
  const parsed = parseAccount(account);
  if (parsed === null) {
    return null;
  }
  const balance = projection.accounts[account] ?? { debits: 0, credits: 0 };
  const natural = NATURAL_SIDE[parsed.family];
  const positive = natural === "debit" ? balance.debits : balance.credits;
  const negative = natural === "debit" ? balance.credits : balance.debits;
  const net = deductPaise(paise(positive), paise(negative));
  return {
    account,
    family: parsed.family,
    debits: balance.debits,
    credits: balance.credits,
    balance: net.ok ? net.value : 0,
  };
}

/** Every wallet in the org, in a deterministic order. */
export function wallets(projection: JournalProjection): readonly Wallet[] {
  return Object.keys(projection.accounts)
    .sort()
    .map((account) => walletOf(projection, account))
    .filter((wallet): wallet is Wallet => wallet !== null);
}

export interface TrialBalance {
  readonly debits: number;
  readonly credits: number;
  readonly balanced: boolean;
}

/** Upholds: the org's books balance at EVERY seq — checked, never assumed. */
export function trialBalance(projection: JournalProjection): TrialBalance {
  let debits = paise(0);
  let credits = paise(0);
  for (const balance of Object.values(projection.accounts)) {
    debits = addPaise(debits, paise(balance.debits));
    credits = addPaise(credits, paise(balance.credits));
  }
  return { debits, credits, balanced: debits === credits };
}

export interface StatementLine {
  readonly eventSeq: number;
  readonly postingId: string;
  readonly template: PostingTemplate;
  readonly direction: LegDirection;
  readonly amount: number;
  readonly sourceStream: string;
  readonly sourceSeq: number;
}

/** An account's statement: its legs in journal order. A fold, never a table. */
export function statementOf(
  projection: JournalProjection,
  account: string,
): readonly StatementLine[] {
  return Object.values(projection.postings)
    .sort((a, b) => a.eventSeq - b.eventSeq)
    .flatMap((posting) =>
      posting.legs
        .filter((leg) => leg.account === account)
        .map((leg) => ({
          eventSeq: posting.eventSeq,
          postingId: posting.postingId,
          template: posting.template,
          direction: leg.direction,
          amount: leg.amount,
          sourceStream: posting.sourceStream,
          sourceSeq: posting.sourceSeq,
        })),
    );
}

/** Postings that reference a case — the void guard's input (§11). */
export function postingsForCase(
  projection: JournalProjection,
  caseId: string,
): readonly PostingRecord[] {
  return Object.values(projection.postings)
    .filter((posting) => posting.caseId === caseId)
    .sort((a, b) => a.eventSeq - b.eventSeq);
}

/** What the org still owes back on over-collection (the refund-liability wallet). */
export function refundLiability(projection: JournalProjection): number {
  return walletOf(projection, REFUND_LIABILITY_ACCOUNT)?.balance ?? 0;
}
