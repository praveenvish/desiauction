/**
 * The Competition domain (IP-3, docs 38/39/42/43/44). Competition ≡ the Canon's
 * Tournament (the product's stage); Season is a minimal org-owned container.
 * Every lifecycle here is an explicit machine (doc 39): typed states, typed
 * transitions with guards, fail-closed. Illegal transitions are unrepresentable.
 * Pure — no storage, no ambient time (a Clock is injected where time is needed).
 */

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
  | { type: "withdraw" }; // player-initiated, available pre-pool-lock

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

export type RegistrationRole = "batter" | "bowler" | "all_rounder" | "wicket_keeper";

export const REGISTRATION_ROLES: readonly RegistrationRole[] = [
  "batter",
  "bowler",
  "all_rounder",
  "wicket_keeper",
];

export function isRegistrationRole(value: string): value is RegistrationRole {
  return (REGISTRATION_ROLES as readonly string[]).includes(value);
}

const REGISTRATION_EDGES: Record<RegistrationStatus, ReadonlySet<RegistrationEvent["type"]>> = {
  draft: new Set(["submit"]),
  submitted: new Set(["approve", "reject", "waitlist", "withdraw"]),
  waitlisted: new Set(["approve", "reject", "withdraw"]),
  approved: new Set(["withdraw"]), // withdrawable pre-pool-lock (doc 42); pool lock is IP-4
  rejected: new Set(), // terminal for the applicant; a fresh registration is a new row
  withdrawn: new Set(),
};

const EVENT_TARGET: Record<RegistrationEvent["type"], RegistrationStatus> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
  waitlist: "waitlisted",
  withdraw: "withdrawn",
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

// --- Naming (shared with the orgs slug discipline) ----------------------------

export type NameResult = { ok: true; value: string } | { ok: false; reason: "too_short" };

/** Upholds: competition/team/season names are trimmed and at least 3 chars. */
export function validateName(input: string): NameResult {
  const trimmed = input.trim();
  return trimmed.length >= 3 ? { ok: true, value: trimmed } : { ok: false, reason: "too_short" };
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
