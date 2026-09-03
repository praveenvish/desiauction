/**
 * WHICH FEATURES ARE ON, AND WHO SAID SO.
 *
 * The platform's first feature switch (docs/63 asked for runtime, org-scopable
 * flags with a kill switch; none existed until WR-1). Pure: the rows come from
 * `feature_settings`, the environment and the tier come from the caller, and
 * this decides.
 *
 * THE ORDER IS THE POLICY. A feature is on only when every layer agrees:
 *
 *   env → tier → platform → org → auction
 *
 * The environment is the deploy-time kill switch. The tier is the commercial
 * gate, and like every tier rule it must only ever be asked at setup surfaces,
 * never on the bid path (`tiers.ts`). The platform row REPLACES the code
 * default — that is how a dark feature is lit for everyone, or a lit one is
 * killed at runtime. Org and auction rows can only SUBTRACT: a club or an
 * organizer may switch a feature off for themselves, and nothing below the
 * platform can switch one on over a higher layer's no.
 *
 * Absence means "no opinion": an org that never opened the screen keeps what
 * the platform decided, exactly as `org_messaging_settings` behaves.
 */

import { TIERS } from "./tiers";
import type { Tier } from "./tiers";

export interface FeatureDefinition {
  readonly label: string;
  /** What the feature does when no platform row exists. */
  readonly defaultEnabled: boolean;
  /** The lowest Pass tier that includes it; `free` = every tier. */
  readonly minTier: Tier;
}

export const FEATURES = {
  my_plan: { label: "My plan", defaultEnabled: true, minTier: "free" },
} as const satisfies Record<string, FeatureDefinition>;

export type Feature = keyof typeof FEATURES;

export function isFeature(value: string): value is Feature {
  return Object.hasOwn(FEATURES, value);
}

export const FEATURE_SCOPE_TYPES = ["platform", "org", "auction"] as const;
export type FeatureScopeType = (typeof FEATURE_SCOPE_TYPES)[number];

/** Platform rows use the same singleton scope id the platform grants do. */
export const FEATURE_PLATFORM_SCOPE_ID = "00000000000000000000000000";

export interface FeatureSettingLike {
  readonly scopeType: FeatureScopeType;
  readonly feature: string;
  readonly enabled: boolean;
}

export type FeatureDenial = "env" | "tier" | "default" | "platform" | "org" | "auction";

export interface FeatureResolution {
  readonly enabled: boolean;
  /** The first layer that said no, in policy order; null when enabled. */
  readonly deniedBy: FeatureDenial | null;
}

export interface FeatureContext {
  /** The deploy-time kill switch. Omitted = on. */
  readonly envEnabled?: boolean;
  /** The season's Pass tier. Omitted = not asked (the bid path never asks). */
  readonly tier?: Tier;
}

function tierIndex(tier: Tier): number {
  return TIERS.indexOf(tier);
}

export function resolveFeature(
  feature: Feature,
  rows: readonly FeatureSettingLike[],
  context: FeatureContext = {},
): FeatureResolution {
  const definition = FEATURES[feature];
  if (context.envEnabled === false) {
    return { enabled: false, deniedBy: "env" };
  }
  if (context.tier !== undefined && tierIndex(context.tier) < tierIndex(definition.minTier)) {
    return { enabled: false, deniedBy: "tier" };
  }
  const mine = rows.filter((row) => row.feature === feature);
  const platform = mine.find((row) => row.scopeType === "platform");
  if (platform === undefined ? !definition.defaultEnabled : !platform.enabled) {
    return { enabled: false, deniedBy: platform === undefined ? "default" : "platform" };
  }
  if (mine.some((row) => row.scopeType === "org" && !row.enabled)) {
    return { enabled: false, deniedBy: "org" };
  }
  if (mine.some((row) => row.scopeType === "auction" && !row.enabled)) {
    return { enabled: false, deniedBy: "auction" };
  }
  return { enabled: true, deniedBy: null };
}
