import { organizations, settlementCases, withTenantDb } from "@desiauction/db";

import { dbHandle, systemDb } from "../db";
import { settlementDeps } from "./deps";
import { runCoordination, runPaymentCoordination, type SettlementActor } from "./writer";

/**
 * THE SCHEDULED CATCH-UP (PRR P1-3) — the missing caller for the repair the
 * money system documents but never invoked.
 *
 * `commitCase` coordinates the journal OUTSIDE the case transaction on purpose,
 * and its own comment says a crash in that seam "the catch-up scan repairs".
 * `runCoordination` / `runPaymentCoordination` are that scan — and a repo-wide
 * search found their only callers were tests. There was no cron, no route, no
 * admin button. A case could be marked settled while its journal posting was
 * never written, and nothing would ever heal it.
 *
 * This is the sweep, and — like the demo-reminder sweep — it is a FUNCTION with
 * an endpoint onto it, never a loop inside the certified finops runner (which is
 * dependency-cruiser-forbidden from any settlement write). Idempotent by
 * construction: every effect is skipped when already present, so the scheduler
 * may call it as often as it likes.
 *
 * Per org it runs inside a `withTenantDb` boundary so the writes are RLS-scoped,
 * with the same all-zero system actor the writer already uses for coordinator
 * events. One case or payment that will not fold (the restore-from-backup case)
 * is recorded and skipped, never allowed to halt the sweep for everyone else.
 */

// Matches writer.ts SYSTEM_ACTOR: coordinator-derived events name the system.
const SYSTEM_ACTOR = "00000000000000000000000000";

export interface CoordinationSweepReport {
  readonly orgs: number;
  readonly casesScanned: number;
  readonly paymentsScanned: number;
  readonly effectsRepaired: number;
  /** streamType:id for each case/payment whose log would not fold — needs a human. */
  readonly unhealable: readonly string[];
}

export async function sweepSettlementCoordination(): Promise<CoordinationSweepReport> {
  const orgs = await systemDb.select({ id: organizations.id }).from(organizations);
  let casesScanned = 0;
  let paymentsScanned = 0;
  let effectsRepaired = 0;
  const unhealable: string[] = [];

  for (const org of orgs) {
    await withTenantDb(dbHandle, { personId: SYSTEM_ACTOR, orgId: org.id }, async (db) => {
      const deps = settlementDeps(db);
      const actor: SettlementActor = { personId: SYSTEM_ACTOR, orgId: org.id, grants: [] };

      const cases = await db.select({ id: settlementCases.id }).from(settlementCases);
      for (const row of cases) {
        casesScanned += 1;
        try {
          effectsRepaired += await runCoordination(deps, actor, row.id);
        } catch (error) {
          unhealable.push(`case:${row.id} — ${String(error)}`);
        }
      }

      const paymentIds = await deps.store.loadPaymentIds(org.id);
      for (const paymentId of paymentIds) {
        paymentsScanned += 1;
        try {
          effectsRepaired += await runPaymentCoordination(deps, actor, paymentId);
        } catch (error) {
          unhealable.push(`payment:${paymentId} — ${String(error)}`);
        }
      }
    });
  }

  return {
    orgs: orgs.length,
    casesScanned,
    paymentsScanned,
    effectsRepaired,
    unhealable,
  };
}
