"use server";

import type { OutcomeMetrics } from "@desiauction/core";

import { systemDb } from "../db";
import { webFinopsDeps } from "../financial-operations/deps";
import { platformAdminGate } from "./authz";
import {
  adminSearch,
  auditExplorer,
  organizationDetail,
  organizationDirectory,
  outcomesProjection,
  platformHealth,
  platformOverview,
  userDetail,
  userDirectory,
  type AdminSearchHit,
  type AuditFilters,
  type AuditPage,
  type OrgDetail,
  type OrgDirectory,
  type OrgFilter,
  type PlatformHealth,
  type PlatformOverview,
  type UserDetail,
  type UserDirectory,
} from "./views";

/**
 * PX-9 Platform Administration — the internal RPC surface.
 *
 * Every export here has the same three-line shape: gate, read, return. There is
 * no fourth line. This module exports NO command, NO mutation and no wrapper
 * around one; administration observes and governs, and the operational writers
 * stay behind the consoles that own them (which re-gate every caller on their
 * own capability, platform admin or not — see the escalation suite).
 *
 * Reads run on the SYSTEM pool because administration is cross-tenant by
 * definition (PX-1 01 §2.4). The pool is RLS-exempt, so the gate above it is
 * load-bearing: `platformAdminGate` is evaluated FIRST, under RLS, on every
 * single one of these, and returns null for everyone else. Null in, null out —
 * callers render notFound().
 */

function deps() {
  return webFinopsDeps(systemDb);
}

export async function adminOverview(): Promise<PlatformOverview | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return platformOverview(deps(), systemDb);
}

// Outcome Governance: the audit-log-backed North-Star metrics (last N days).
export async function adminOutcomes(windowDays = 30): Promise<OutcomeMetrics | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return outcomesProjection(systemDb, windowDays);
}

export async function adminOrganizations(
  query?: string,
  filter?: OrgFilter,
): Promise<OrgDirectory | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return organizationDirectory(systemDb, { query, filter });
}

export async function adminOrganization(slug: string): Promise<OrgDetail | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return organizationDetail(systemDb, slug);
}

export async function adminUsers(query?: string): Promise<UserDirectory | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return userDirectory(systemDb, query ?? "");
}

export async function adminUser(personId: string): Promise<UserDetail | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return userDetail(systemDb, personId);
}

export async function adminAudit(filters: AuditFilters): Promise<AuditPage | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return auditExplorer(systemDb, filters);
}

export async function adminHealth(): Promise<PlatformHealth | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return platformHealth(deps(), systemDb);
}

/** Command search (CTO §6): navigation targets for the palette. Gated like the rest. */
export async function adminSearchAction(query: string): Promise<AdminSearchHit[]> {
  if ((await platformAdminGate()) === null) {
    return [];
  }
  return adminSearch(systemDb, query);
}

/** Nav-only: whether to render the Platform admin door in the avatar menu. */
export async function adminNavVisible(): Promise<boolean> {
  return (await platformAdminGate()) !== null;
}
