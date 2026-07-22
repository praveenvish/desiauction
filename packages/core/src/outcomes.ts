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
}

const ACTION_FIELD = {
  "competition.created": "competitionsCreated",
  "competition.cloned": "competitionsCloned",
  "team.created": "teamsCreated",
  "registration.submitted": "registrationsSubmitted",
  "registration.team_assigned": "playersAssigned",
} as const satisfies Record<(typeof OUTCOME_ACTIONS)[number], keyof OutcomeMetrics>;

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
  };
  const fieldFor = ACTION_FIELD as Record<string, keyof OutcomeMetrics>;
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
  return metrics;
}
