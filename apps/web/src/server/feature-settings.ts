import {
  FEATURE_PLATFORM_SCOPE_ID,
  resolveFeature,
  type Feature,
  type FeatureResolution,
  type FeatureSettingLike,
  type Tier,
} from "@desiauction/core";
import { auditLog, featureSettings, newId, type Db } from "@desiauction/db";
import { and, eq, or, sql } from "drizzle-orm";

import { env } from "../env";
import { systemDb } from "./db";

/**
 * FEATURE SWITCHES, READ AND WRITTEN (WR-1).
 *
 * The decision is pure and lives in core (`resolveFeature`: env → tier →
 * platform → org → auction, layers only subtract). This module fetches the
 * rows that decision needs and records the flips.
 *
 * Two pools, on purpose. Org and auction rows are tenant data and are read on
 * the caller's `withTenantDb` transaction, where the ordinary org policy scopes
 * them. Platform rows have no tenant (`org_id IS NULL`) and are therefore
 * invisible to the app pool by construction; they are read on the system pool,
 * which is the platform-read role. Nothing here writes a platform row: that is
 * a platform-admin act and waits for its own capability (Phase 1.5).
 */

/** One deploy-time switch per feature; a new feature adds its line here or does not compile. */
const ENV_ENABLED: Readonly<Record<Feature, () => boolean>> = {
  my_plan: () => !env.MY_PLAN_DISABLED,
};

function envEnabledFor(feature: Feature): boolean {
  return ENV_ENABLED[feature]();
}

export interface FeatureScope {
  orgId: string;
  /** Null when asking at the org level (no auction in hand). */
  auctionId: string | null;
}

/** The platform, org and auction rows that bear on one feature in one scope. */
export async function featureRowsFor(db: Db, scope: FeatureScope): Promise<FeatureSettingLike[]> {
  const columns = {
    scopeType: featureSettings.scopeType,
    feature: featureSettings.feature,
    enabled: featureSettings.enabled,
  };
  const [platformRows, tenantRows] = await Promise.all([
    systemDb
      .select(columns)
      .from(featureSettings)
      .where(
        and(
          eq(featureSettings.scopeType, "platform"),
          eq(featureSettings.scopeId, FEATURE_PLATFORM_SCOPE_ID),
        ),
      ),
    db
      .select(columns)
      .from(featureSettings)
      .where(
        and(
          eq(featureSettings.orgId, scope.orgId),
          or(
            and(eq(featureSettings.scopeType, "org"), eq(featureSettings.scopeId, scope.orgId)),
            scope.auctionId === null
              ? sql`false`
              : and(
                  eq(featureSettings.scopeType, "auction"),
                  eq(featureSettings.scopeId, scope.auctionId),
                ),
          ),
        ),
      ),
  ]);
  return [...platformRows, ...tenantRows];
}

/**
 * Is this feature on here? Ask the tier only from setup surfaces (the plan
 * page, the organizer's switch) — never from anything on the bid path.
 */
export async function featureEnabled(
  db: Db,
  feature: Feature,
  scope: FeatureScope,
  tier?: Tier,
): Promise<FeatureResolution> {
  const rows = await featureRowsFor(db, scope);
  return resolveFeature(feature, rows, {
    envEnabled: envEnabledFor(feature),
    ...(tier === undefined ? {} : { tier }),
  });
}

export interface SetAuctionFeatureInput {
  orgId: string;
  auctionId: string;
  feature: Feature;
  enabled: boolean;
  actorId: string;
}

/**
 * An organizer switches a feature on or off for one auction.
 *
 * The row and its audit record land in the caller's transaction together
 * (doc 48: audit failure fails the action). The audit carries WHICH switch
 * moved and which way — never anything from the feature's own data.
 */
export async function setAuctionFeature(db: Db, input: SetAuctionFeatureInput): Promise<void> {
  await db
    .insert(featureSettings)
    .values({
      id: newId(),
      orgId: input.orgId,
      scopeType: "auction",
      scopeId: input.auctionId,
      feature: input.feature,
      enabled: input.enabled,
      updatedBy: input.actorId,
    })
    .onConflictDoUpdate({
      target: [featureSettings.scopeType, featureSettings.scopeId, featureSettings.feature],
      set: { enabled: input.enabled, updatedBy: input.actorId, updatedAt: new Date() },
    });
  await db.insert(auditLog).values({
    id: newId(),
    actor: input.actorId,
    action: "auction.feature_toggled",
    scopeType: "org",
    scopeId: input.orgId,
    subject: input.auctionId,
    meta: { feature: input.feature, enabled: input.enabled },
  });
}
