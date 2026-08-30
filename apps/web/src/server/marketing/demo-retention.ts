import { demoRequests } from "@desiauction/db";
import { and, isNotNull, lt } from "drizzle-orm";

import { db } from "../db";

/**
 * THE PROMISE IN THE POLICY, IN CODE.
 *
 * `/legal/data-retention` states two periods for demo requests: the request
 * itself for twenty-four months, and the network address it arrived from for
 * ninety days. A retention policy nothing enforces is not a policy, it is a
 * paragraph — and this is the one place on the platform where the data belongs
 * to people who never opened an account and have the least recourse if we
 * forget about them.
 *
 * The two periods are deliberately different. The request has a business life:
 * somebody who asked in March and comes back in November should not be a
 * stranger. The IP has exactly one purpose — refusing a flood — and outlives
 * its usefulness in hours, so ninety days is already generous.
 *
 * A REQUEST WITH A BOOKING CASCADES. `demo_bookings.demo_request_id` is
 * ON DELETE CASCADE, so deleting the request takes its bookings with it and
 * nothing is left pointing at a row that is gone.
 */

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const REQUEST_RETENTION_MS = 24 * MONTH_MS;
export const IP_RETENTION_MS = 90 * DAY_MS;

export interface PurgeResult {
  readonly requestsDeleted: number;
  readonly addressesCleared: number;
}

export async function purgeExpiredDemoData(now: Date = new Date()): Promise<PurgeResult> {
  const deleted = await db
    .delete(demoRequests)
    .where(lt(demoRequests.createdAt, new Date(now.getTime() - REQUEST_RETENTION_MS)))
    .returning({ id: demoRequests.id });

  // Cleared in place rather than deleted: the request is still inside its own
  // retention window and still useful to whoever answers it. Only the address
  // has expired.
  const cleared = await db
    .update(demoRequests)
    .set({ requestIp: null })
    .where(
      and(
        isNotNull(demoRequests.requestIp),
        lt(demoRequests.createdAt, new Date(now.getTime() - IP_RETENTION_MS)),
      ),
    )
    .returning({ id: demoRequests.id });

  return { requestsDeleted: deleted.length, addressesCleared: cleared.length };
}
