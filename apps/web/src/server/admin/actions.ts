"use server";

import type { OutcomeMetrics } from "@desiauction/core";

import { env } from "../../env";
import { systemDb } from "../db";
import { webFinopsDeps } from "../financial-operations/deps";
import { platformAdminGate } from "./authz";
import {
  auditExplorer,
  messagingOverview,
  organizationDetail,
  organizationDirectory,
  organizationExists,
  outcomesProjection,
  sportCatalogueProjection,
  personExists,
  platformHealth,
  platformOverview,
  userDetail,
  userDirectory,
  type AuditFilters,
  type AuditPage,
  type MessagingOverview,
  type OrgDetail,
  type OrgDirectory,
  type OrgFilter,
  type PlatformHealth,
  type PlatformOverview,
  type SportCatalogueRow,
  type UserDetail,
  type UserDirectory,
  type UserDirectoryFilter,
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

/**
 * The sport catalogue, read (SP-1 Phase 1). Gated like every other admin read;
 * there is no matching writer, deliberately — see `sportCatalogueProjection`.
 */
export async function adminSportCatalogue(): Promise<SportCatalogueRow[] | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return sportCatalogueProjection(systemDb);
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
  after?: string,
): Promise<OrgDirectory | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return organizationDirectory(systemDb, { query, filter, after });
}

/**
 * Record existence, answered BEFORE the Suspense boundary opens.
 *
 * A boundary above a `notFound()` commits a 200 first (the PX-2 finding), so a
 * miss discovered inside `<Suspense>` produced an HTTP 200 carrying a "this
 * page doesn't exist" body — while the identical URL returned a hard 404 to a
 * non-admin. Gate, exist, then stream.
 */
export async function adminOrganizationExists(slug: string): Promise<boolean> {
  if ((await platformAdminGate()) === null) {
    return false;
  }
  return organizationExists(systemDb, slug);
}

export async function adminPersonExists(personId: string): Promise<boolean> {
  if ((await platformAdminGate()) === null) {
    return false;
  }
  return personExists(systemDb, personId);
}

export async function adminOrganization(slug: string): Promise<OrgDetail | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return organizationDetail(systemDb, slug);
}

export async function adminUsers(
  query?: string,
  after?: string,
  filter?: UserDirectoryFilter,
): Promise<UserDirectory | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return userDirectory(systemDb, query ?? "", after, filter ?? "all");
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

/**
 * Messaging configuration and the live suppression list.
 *
 * The environment is read HERE, not inside the projection, so the projection
 * stays pure and the read-only proof can drive it with an empty one. It reads
 * the PARSED env rather than `process.env`, which §11 confines to `env.ts` —
 * the widening cast is safe because every field on it is a string, a string
 * array or undefined, and the projection only ever asks "is this name set?".
 *
 * The question it answers had no answer before: a template's registered DLT id
 * lives in a variable, a shape without one refuses to send, and "can this
 * deployment text anyone?" was decidable only by inspecting a running process.
 */
export async function adminMessaging(): Promise<MessagingOverview | null> {
  if ((await platformAdminGate()) === null) {
    return null;
  }
  return messagingOverview(systemDb, env as unknown as Record<string, string | undefined>);
}

/** Nav-only: whether to render the Platform admin door in the avatar menu. */
export async function adminNavVisible(): Promise<boolean> {
  return (await platformAdminGate()) !== null;
}
