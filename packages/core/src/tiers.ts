/**
 * WHAT A PASS ACTUALLY BUYS.
 *
 * The pricing page has quoted "Up to 4 teams and 40 players" since PX-10 and
 * nothing in the platform knew it: no tier, no plan, no entitlement, no billing
 * — a free organizer could run sixteen teams and use the overlays. The RH-1
 * content review flagged it; the answer chosen was BLOCK, not warn.
 *
 * Pure, and deliberately so. The numbers below are the same ones the pricing
 * page prints, and a test holds the two together — a tier table that can drift
 * from the page selling it is worse than no tier table.
 *
 * WHERE THE LIMIT BITES, AND WHERE IT MUST NOT. A ceiling enforced at the wrong
 * moment is worse than no ceiling: refusing a bid at 9pm because a season is
 * one player over is an outage, not a paywall. So both limits are checked where
 * the ORGANIZER acts during setup — creating a team, approving a registration
 * into the pool — and nowhere on the auction path. Once the night starts,
 * nothing here can refuse anything.
 */

export const TIERS = ["free", "pro", "association"] as const;
export type Tier = (typeof TIERS)[number];

export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

export interface TierLimits {
  /** Teams a season may hold. `null` = agreed per contract, not counted here. */
  readonly teams: number | null;
  /** Approved players in the pool. `null` = agreed per contract. */
  readonly players: number | null;
}

/**
 * Doc 45 §Tiers, and the pricing page verbatim. Association is deliberately
 * uncounted: the page says "By agreement", and inventing a number here would
 * make the platform refuse something a signed contract permits.
 */
export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { teams: 4, players: 40 },
  pro: { teams: 16, players: 400 },
  association: { teams: null, players: null },
};

export type LimitSubject = "teams" | "players";

export type LimitDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly subject: LimitSubject;
      readonly tier: Tier;
      /** The ceiling that was reached. */
      readonly limit: number;
      /** How many already exist — equal to `limit` when the refusal is exact. */
      readonly current: number;
    };

/**
 * May this season add one more of `subject`?
 *
 * `current` is what already exists, so the caller asks BEFORE inserting. A
 * season sitting exactly on its ceiling is legal — it is the next one that is
 * refused, which is what "up to 4 teams" means to the person reading it.
 */
export function checkTierLimit(tier: Tier, subject: LimitSubject, current: number): LimitDecision {
  const limit = TIER_LIMITS[tier][subject];
  if (limit === null || current < limit) {
    return { ok: true };
  }
  return { ok: false, subject, tier, limit, current };
}

const TIER_LABEL: Record<Tier, string> = {
  free: "Free",
  pro: "Pro Pass",
  association: "Association",
};

export function tierLabel(tier: Tier): string {
  return TIER_LABEL[tier];
}

/**
 * The refusal, in the words the organizer needs: what stopped them, what the
 * ceiling is, and what to do about it. Never an enum, never a bare "forbidden".
 */
export function limitRefusalMessage(decision: Extract<LimitDecision, { ok: false }>): string {
  const noun = decision.subject === "teams" ? "teams" : "players in the pool";
  return `The ${tierLabel(decision.tier)} tier covers up to ${String(decision.limit)} ${noun}, and this season already has ${String(decision.current)}. Upgrade the season's pass to add more.`;
}

/**
 * THE TIER EVERY SEASON CREATED DURING BETA IS GRANTED.
 *
 * The pricing page promises, in as many words, that "tournaments started during
 * beta stay free forever" with "every tier, every feature". Beta has not ended,
 * so a season created today is covered by that promise and must not meet a
 * four-team ceiling — the enforcement above is real, and this is what keeps it
 * off the people who were told it would not apply to them.
 *
 * `association` is the tier whose limits are "by agreement", which is precisely
 * what a beta grant is. The column's own DEFAULT is `free`, the right answer
 * for everything created after this constant goes away.
 *
 * TODO(founder): delete this at GA and let the column default stand. It is one
 * line, it is greppable, and removing it is what turns the ceiling on for new
 * tournaments. The pricing page's beta banner has to change in the same commit.
 */
export const BETA_TIER: Tier = "association";
