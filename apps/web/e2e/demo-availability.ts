import { createDb, demoAvailability, demoBlackouts, demoRequests, newId } from "@desiauction/db";
import { like } from "drizzle-orm";

/**
 * PUBLISHING AVAILABILITY FOR A TEST, DIRECTLY.
 *
 * The alternative is signing in as a platform operator, which needs a
 * `platform:demo` grant that is deliberately uninsertable by the application
 * role — it exists only via an out-of-band seed on the system pool. Driving
 * that through the UI would make every booking test a test of the grant model
 * instead, and the grant model has its own suite.
 *
 * Connection opened and closed per call, for the reason `otp.ts` gives at
 * length: Playwright has no per-worker teardown hook, and a leaked postgres
 * connection keeps the worker alive after its tests are done.
 */

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";

/** Everything this helper creates is stamped, so cleanup can find it. */
export const E2E_MARK = "E2E-DEMO1";

/**
 * Offer every weekday evening, so a booking test never has to care which day it
 * runs on. Real availability is a founder's decision; this is a fixture.
 */
export async function publishTestAvailability(): Promise<void> {
  const handle = createDb(DATABASE_URL);
  try {
    await handle.db
      .delete(demoAvailability)
      .where(like(demoAvailability.createdBy, `${E2E_MARK}%`));
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await handle.db.insert(demoAvailability).values({
        id: newId(),
        weekday,
        // 10:00 to 22:00 IST. Wide enough that the two-hour lead time can never
        // empty the whole day, whatever time the suite runs at.
        startMinute: 10 * 60,
        endMinute: 22 * 60,
        slotMinutes: 30,
        createdBy: `${E2E_MARK}${"0".repeat(26 - E2E_MARK.length)}`.slice(0, 26),
      });
    }
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}

export async function clearTestDemoData(): Promise<void> {
  const handle = createDb(DATABASE_URL);
  try {
    // Bookings cascade with their request (migration 0032's foreign key).
    await handle.db.delete(demoRequests).where(like(demoRequests.orgName, `%${E2E_MARK}%`));
    await handle.db
      .delete(demoAvailability)
      .where(like(demoAvailability.createdBy, `${E2E_MARK}%`));
    await handle.db.delete(demoBlackouts).where(like(demoBlackouts.createdBy, `${E2E_MARK}%`));
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}
