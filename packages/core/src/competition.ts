/**
 * The Competition domain (IP-3, docs 38/39/42/43/44). Competition ≡ the Canon's
 * Tournament (the product's stage); Season is a minimal org-owned container.
 * Every lifecycle here is an explicit machine (doc 39): typed states, typed
 * transitions with guards, fail-closed. Illegal transitions are unrepresentable.
 * Pure — no storage, no ambient time (a Clock is injected where time is needed).
 */

import { CRICKET_ROLE_KEYS } from "./sports";

import type { CricketRole } from "./sports";

// --- Competition lifecycle (pre-auction slice; doc 39 Tournament machine) -----
// Draft → Setup → RegistrationOpen ⇄ RegistrationClosed → [AuctionReady …IP-4].
// AuctionReady and beyond are IP-4 guards (invariant 15/16) — declared, not stubbed.

export type CompetitionStatus = "draft" | "setup" | "registration_open" | "registration_closed";

export const COMPETITION_STATUSES: readonly CompetitionStatus[] = [
  "draft",
  "setup",
  "registration_open",
  "registration_closed",
];

// Guard inputs a transition may consult. Kept explicit so the guard is pure and
// the caller must supply proof of the real-world precondition (doc 44 gates).
export interface CompetitionReadiness {
  hasName: boolean;
  hasDates: boolean;
  hasLocation: boolean;
}

const COMPETITION_EDGES: Record<CompetitionStatus, readonly CompetitionStatus[]> = {
  draft: ["setup"],
  // Setup → RegistrationOpen needs identity minimums (doc 44 → RegistrationOpen).
  setup: ["registration_open"],
  // Reopening / closing intake is normal and free, both directions (doc 39).
  registration_open: ["registration_closed"],
  registration_closed: ["registration_open"],
};

export type TransitionResult =
  { ok: true } | { ok: false; reason: "illegal_transition" | "guard_failed" };

/**
 * Upholds: only declared edges are legal, and Setup→RegistrationOpen additionally
 * requires the doc-44 identity minimums (name, dates, location). Everything else
 * fails closed.
 */
export function competitionTransition(
  from: CompetitionStatus,
  to: CompetitionStatus,
  readiness?: CompetitionReadiness,
): TransitionResult {
  if (!COMPETITION_EDGES[from].includes(to)) {
    return { ok: false, reason: "illegal_transition" };
  }
  if (from === "setup" && to === "registration_open") {
    const ready =
      readiness !== undefined && readiness.hasName && readiness.hasDates && readiness.hasLocation;
    if (!ready) {
      return { ok: false, reason: "guard_failed" };
    }
  }
  return { ok: true };
}

// --- Registration lifecycle (doc 39 Registration machine) ---------------------
// Draft → Submitted → Verified → Approved → InPool
//                  ↘ Rejected            ↘ Withdrawn
//                  ↘ Waitlisted → Approved
// Mobile is verified through the frozen Identity OTP before submit, so a
// session-authenticated submit lands in `submitted` already mobile-verified.

export type RegistrationStatus =
  "draft" | "submitted" | "approved" | "rejected" | "waitlisted" | "withdrawn";

export const REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "waitlisted",
  "withdrawn",
];

// Triage + player actions, as typed events (doc 39: transitions are events).
export type RegistrationEvent =
  | { type: "submit" }
  | { type: "approve" } // requires a human — invariant 5 (enforced at the action layer)
  | { type: "reject"; reason: RejectionReason; note?: string } // private reason — invariant 6
  | { type: "waitlist" }
  | { type: "withdraw" } // player-initiated, available pre-pool-lock
  | { type: "restore" }; // organizer undo: rejected/withdrawn → submitted (re-triageable)

export type RejectionReason = "duplicate" | "ineligible" | "withdrew" | "capacity" | "other";

export const REJECTION_REASONS: readonly RejectionReason[] = [
  "duplicate",
  "ineligible",
  "withdrew",
  "capacity",
  "other",
];

export function isRejectionReason(value: string): value is RejectionReason {
  return (REJECTION_REASONS as readonly string[]).includes(value);
}

/** The organizer's own words about one decision. Doc 42's "other+note". */
export const REJECTION_NOTE_LIMIT = 2000;

/**
 * BUILD A REJECTION, AND MAKE "OTHER" MEAN SOMETHING.
 *
 * `RegistrationEvent` has carried `note?: string` since this machine was
 * written and the database column has always existed, but nothing ever supplied
 * one — so a decline for `other` recorded only that no category fitted. Doc 42
 * spells the categories as "duplicate, ineligible, withdrew, capacity,
 * OTHER+NOTE": the note is not a decoration on `other`, it is the half that
 * carries the meaning. Required there, optional for the four that already say
 * what they are.
 *
 * INVARIANT 6 GOVERNS WHERE THE RESULT MAY GO. The player is told a respectful
 * sentence derived from the CATEGORY; neither the raw category nor this note
 * may reach them. That is enforced where the projections are built — the
 * player's own read model does not select the column — not here.
 *
 * Here rather than in the web app because `"use server"` modules may only
 * export async functions, so a rule living there cannot be unit-tested; and
 * because this is a rule about the event, which is defined three lines up.
 */
export function rejectionEvent(
  reason: string,
  note?: string,
): { ok: true; event: RegistrationEvent } | { ok: false; error: string } {
  if (!isRejectionReason(reason)) {
    return { ok: false, error: "Choose a reason to reject." };
  }
  const trimmed = (note ?? "").trim().slice(0, REJECTION_NOTE_LIMIT);
  if (reason === "other" && trimmed === "") {
    return {
      ok: false,
      error: "Say what the reason was — \u201cother\u201d on its own records nothing.",
    };
  }
  return {
    ok: true,
    event: trimmed === "" ? { type: "reject", reason } : { type: "reject", reason, note: trimmed },
  };
}

/**
 * THE PLAYING ROLES, DECLARED ONCE (Phase 0).
 *
 * This list used to be spelled out here as well as in `player-profile.ts`, and
 * two more times in the web app. Four copies of four strings is survivable; two
 * different LABELS for the same role was not, and that is what four copies
 * produced. The sport pack owns the vocabulary now and this is a re-export, so
 * the type every registration writer is checked against still resolves to the
 * same literal union it always did.
 */
export type RegistrationRole = CricketRole;

export const REGISTRATION_ROLES: readonly RegistrationRole[] = CRICKET_ROLE_KEYS;

/*
 * `isRegistrationRole` lived here and is gone, for the reason `parseRole` did:
 * a cricket-only question under a sport-neutral name. Use `isRoleIn(pack, …)`.
 */

const REGISTRATION_EDGES: Record<RegistrationStatus, ReadonlySet<RegistrationEvent["type"]>> = {
  draft: new Set(["submit"]),
  submitted: new Set(["approve", "reject", "waitlist", "withdraw"]),
  waitlisted: new Set(["approve", "reject", "withdraw"]),
  approved: new Set(["withdraw"]), // withdrawable pre-pool-lock (doc 42); pool lock is IP-4
  // Rejected / withdrawn are recoverable only via an explicit organizer restore —
  // the single audited exit, never a hidden path (M-IP3-2 aggregate contract).
  rejected: new Set(["restore"]),
  withdrawn: new Set(["restore"]),
};

const EVENT_TARGET: Record<RegistrationEvent["type"], RegistrationStatus> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
  waitlist: "waitlisted",
  withdraw: "withdrawn",
  restore: "submitted",
};

export type RegistrationTransition =
  | { ok: true; next: RegistrationStatus }
  | { ok: false; reason: "illegal_transition" | "reason_required" };

/**
 * Upholds: only declared edges are legal; a reject must name a private reason
 * category (invariant 6). Approval's human-gate (invariant 5) is enforced where
 * the capability is checked — the machine cannot see intent, only legality.
 */
export function registrationTransition(
  from: RegistrationStatus,
  event: RegistrationEvent,
): RegistrationTransition {
  if (!REGISTRATION_EDGES[from].has(event.type)) {
    return { ok: false, reason: "illegal_transition" };
  }
  if (event.type === "reject" && !isRejectionReason(event.reason)) {
    return { ok: false, reason: "reason_required" };
  }
  return { ok: true, next: EVENT_TARGET[event.type] };
}

// --- Bulk operations (M-IP3-2) ------------------------------------------------
// The aggregate's bulk decision. Upholds the directive invariant "every bulk
// action behaves identically to N individual actions": it is literally the
// single-transition decision mapped over the batch, partitioned into the ones to
// APPLY and the ones to SKIP (with the same reason a single call would give). No
// bulk-only shortcut, no hidden path — the applier just executes this plan.

export interface RegistrationBatchItem {
  id: string;
  status: RegistrationStatus;
}

export interface RegistrationBatchPlan {
  apply: { id: string; next: RegistrationStatus }[];
  skip: { id: string; reason: "illegal_transition" | "reason_required" }[];
}

export function planRegistrationBatch(
  items: readonly RegistrationBatchItem[],
  event: RegistrationEvent,
): RegistrationBatchPlan {
  const plan: RegistrationBatchPlan = { apply: [], skip: [] };
  for (const item of items) {
    const decision = registrationTransition(item.status, event);
    if (decision.ok) {
      plan.apply.push({ id: item.id, next: decision.next });
    } else {
      plan.skip.push({ id: item.id, reason: decision.reason });
    }
  }
  return plan;
}

/**
 * A stable, human-quotable reference derived from the ULID — deterministic, needs
 * no counter (so no insert-time race), and searchable. Not a uniqueness key.
 */
export function registrationNumber(id: string): string {
  return `R${id.slice(-6).toUpperCase()}`;
}

/** Normalized grouping key for deterministic duplicate-name detection (doc 42). */
export function nameKey(name: string | null): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// --- Naming (shared with the orgs slug discipline) ----------------------------

export type NameResult =
  { ok: true; value: string } | { ok: false; reason: "too_short" | "too_long" };

/** Upholds: competition/team/season names are trimmed and at least 3 chars. */
/** DA-29: names were unbounded — a 45-character string of markup was accepted. */
export const NAME_MAX_LENGTH = 60;

export function validateName(input: string): NameResult {
  const trimmed = input.trim();
  if (trimmed.length < 3) {
    return { ok: false, reason: "too_short" };
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, value: trimmed };
}

/**
 * A monogram from the ALPHANUMERICS only (DA-29). Deriving it from raw input
 * turned `<img src=x …>` into the short name "<IM" — escaped and harmless, but
 * nonsense on every team chip and board.
 */
export function monogramFor(name: string): string {
  // \p{M} keeps combining marks attached: without it "मुंबई" loses its matras
  // and renders as "मबई". Slicing by GRAPHEME for the same reason — three code
  // units can cut a Devanagari cluster in half.
  const letters = name.replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
  const source = letters === "" ? name : letters;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const graphemes = [...segmenter.segment(source)].map((entry) => entry.segment);
  return graphemes.slice(0, 3).join("").toUpperCase();
}

/** Deterministic slug base (caller appends a ULID suffix for uniqueness, as orgs do). */
export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base === "" ? "competition" : base;
}

/** Upholds: a season year is a plausible four-digit year. */
export function isValidSeasonYear(year: number): boolean {
  return Number.isInteger(year) && year >= 2000 && year <= 2100;
}

/**
 * Name for a cloned competition ("Run it again" — retention). If the name ends
 * in a season year (19xx/20xx), bump it: "Sunday League 2026" → "Sunday League
 * 2027". Otherwise append " (Copy)". Deterministic; the caller still gets a
 * unique slug from the ULID suffix, so a duplicate name never collides.
 */
export function nextSeasonName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "Competition (Copy)";
  }
  const match = /^(.*\s)((?:19|20)\d{2})$/.exec(trimmed);
  if (match !== null) {
    const prefix = match[1] ?? "";
    const year = Number(match[2]);
    return `${prefix}${String(year + 1)}`;
  }
  return `${trimmed} (Copy)`;
}
