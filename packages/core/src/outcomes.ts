/**
 * Business-outcome aggregation (Outcome Governance). Pure: turns audit-log event
 * counts into North-Star outcome metrics — Competition Creation, Repeat Usage,
 * clone adoption, registration. The audit log is the durable, server-side
 * evidence source; this is the arithmetic over it, unit-tested so the numbers a
 * platform admin reads are trustworthy. No IO, no ambient time.
 *
 * A cloned competition emits BOTH `competition.created` (via `createCompetition`)
 * and `competition.cloned`, so a clone counts as the org's next creation — which
 * is exactly right: cloning IS repeat creation, and it surfaces in both
 * `repeatOrgRate` and `cloneAdoptionRate` ("share of creations that were clones").
 */

import { normalizeShareSource } from "./attribution";

export const OUTCOME_ACTIONS = [
  "competition.created",
  "competition.cloned",
  "team.created",
  "registration.submitted",
  "registration.team_assigned",
] as const;

export interface OutcomeMetrics {
  windowDays: number;
  competitionsCreated: number;
  competitionsCloned: number;
  teamsCreated: number;
  registrationsSubmitted: number;
  /** `registration.team_assigned` — a player placed on a squad (sold). */
  playersAssigned: number;
  /** Orgs that created ≥1 competition in the window. */
  orgsCreating: number;
  /** Orgs that created ≥2 — the repeat-usage (retention) signal. */
  orgsRepeating: number;
  /** orgsRepeating / orgsCreating, 0..1. */
  repeatOrgRate: number;
  /** competitionsCloned / competitionsCreated, 0..1. */
  cloneAdoptionRate: number;
  /** Registrations broken down by (bounded) share source — the acquisition loop. */
  registrationsBySource: Record<string, number>;
}

type CountField =
  | "competitionsCreated"
  | "competitionsCloned"
  | "teamsCreated"
  | "registrationsSubmitted"
  | "playersAssigned";

const ACTION_FIELD = {
  "competition.created": "competitionsCreated",
  "competition.cloned": "competitionsCloned",
  "team.created": "teamsCreated",
  "registration.submitted": "registrationsSubmitted",
  "registration.team_assigned": "playersAssigned",
} as const satisfies Record<(typeof OUTCOME_ACTIONS)[number], CountField>;

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Fold grouped audit counts into the outcome metrics. `orgCompetitionCounts` is
 * the per-org tally of `competition.created` events in the window (one number
 * per org that created anything) — the basis of the repeat-usage rate.
 */
export function summarizeOutcomes(input: {
  windowDays: number;
  actionCounts: readonly { action: string; count: number }[];
  orgCompetitionCounts: readonly number[];
  /** Grouped `registration.submitted` counts keyed by raw (untrusted) source. */
  registrationSources?: readonly { source: string | null; count: number }[];
}): OutcomeMetrics {
  const metrics: OutcomeMetrics = {
    windowDays: input.windowDays,
    competitionsCreated: 0,
    competitionsCloned: 0,
    teamsCreated: 0,
    registrationsSubmitted: 0,
    playersAssigned: 0,
    orgsCreating: 0,
    orgsRepeating: 0,
    repeatOrgRate: 0,
    cloneAdoptionRate: 0,
    registrationsBySource: {},
  };
  const fieldFor = ACTION_FIELD as Record<string, CountField | undefined>;
  for (const row of input.actionCounts) {
    const field = fieldFor[row.action];
    if (field !== undefined) {
      metrics[field] = Math.max(0, Math.trunc(row.count));
    }
  }
  metrics.orgsCreating = input.orgCompetitionCounts.length;
  metrics.orgsRepeating = input.orgCompetitionCounts.filter((count) => count >= 2).length;
  metrics.repeatOrgRate = rate(metrics.orgsRepeating, metrics.orgsCreating);
  metrics.cloneAdoptionRate = rate(metrics.competitionsCloned, metrics.competitionsCreated);
  // Re-normalize the source at read time too: an old audit row may predate the
  // write-time allowlist, and cardinality must stay bounded regardless.
  for (const row of input.registrationSources ?? []) {
    const key = normalizeShareSource(row.source);
    metrics.registrationsBySource[key] =
      (metrics.registrationsBySource[key] ?? 0) + Math.max(0, Math.trunc(row.count));
  }
  return metrics;
}
