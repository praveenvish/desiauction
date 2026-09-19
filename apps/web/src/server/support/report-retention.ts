import {
  emailVerifications,
  messageOutbox,
  otpCodes,
  problemReportScreenshots,
  problemReports,
  reviewReports,
} from "@desiauction/db";
import { and, inArray, isNotNull, lt } from "drizzle-orm";

import { db } from "../db";

/**
 * HOW LONG A REPORT IS KEPT (FR-1 Phase 1).
 *
 * Three periods, because the three things have different lives:
 *
 *   · The SCREENSHOT — ninety days. It is the most sensitive thing in the row
 *     (a picture of somebody's screen) and its usefulness ends when the bug is
 *     reproduced or fixed, which is days, not months.
 *   · The ADDRESS it came from — ninety days. Its only purpose is refusing a
 *     flood, and that purpose is over within the hour.
 *   · The REPORT — twenty-four months, matching demo requests: "has anybody
 *     told us this before?" is a question worth answering a year later.
 *
 * A deleted report takes its screenshot with it (ON DELETE CASCADE, 0064).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const SCREENSHOT_RETENTION_MS = 90 * DAY_MS;
export const REPORT_IP_RETENTION_MS = 90 * DAY_MS;
export const REPORT_RETENTION_MS = 24 * 30 * DAY_MS;

export interface ReportPurgeResult {
  readonly reportsDeleted: number;
  readonly screenshotsDeleted: number;
  readonly addressesCleared: number;
}

export async function purgeExpiredProblemReports(
  now: Date = new Date(),
): Promise<ReportPurgeResult> {
  const reports = await db
    .delete(problemReports)
    .where(lt(problemReports.createdAt, new Date(now.getTime() - REPORT_RETENTION_MS)))
    .returning({ id: problemReports.id });

  const screenshots = await db
    .delete(problemReportScreenshots)
    .where(
      lt(problemReportScreenshots.createdAt, new Date(now.getTime() - SCREENSHOT_RETENTION_MS)),
    )
    .returning({ id: problemReportScreenshots.reportId });

  const cleared = await db
    .update(problemReports)
    .set({ requestIp: null })
    .where(
      and(
        isNotNull(problemReports.requestIp),
        lt(problemReports.createdAt, new Date(now.getTime() - REPORT_IP_RETENTION_MS)),
      ),
    )
    .returning({ id: problemReports.id });

  return {
    reportsDeleted: reports.length,
    screenshotsDeleted: screenshots.length,
    addressesCleared: cleared.length,
  };
}

/**
 * SHORT-LIVED SECURITY RECORDS (security review, launch Phase 5).
 *
 * Three stores kept a network address or a code row forever although their
 * only use ends within the hour: the per-IP and per-phone send caps look back
 * sixty minutes, a code lives fifteen, and a review report's address exists
 * only to refuse a flood. Account erasure cleared them per person; nothing
 * cleared them by age. A day of slack keeps a lockout investigation possible.
 */
export const SECURITY_RECORD_RETENTION_MS = DAY_MS;

export interface SecurityPurgeResult {
  readonly deliveredMailDeleted: number;
  readonly phoneCodesDeleted: number;
  readonly emailCodesDeleted: number;
  readonly reviewAddressesCleared: number;
}

export async function purgeSpentSecurityRecords(
  now: Date = new Date(),
): Promise<SecurityPurgeResult> {
  const before = new Date(now.getTime() - SECURITY_RECORD_RETENTION_MS);
  const phoneCodes = await db
    .delete(otpCodes)
    .where(lt(otpCodes.createdAt, before))
    .returning({ id: otpCodes.id });
  const emailCodes = await db
    .delete(emailVerifications)
    .where(lt(emailVerifications.createdAt, before))
    .returning({ id: emailVerifications.id });
  // Personal mail (0079) once it is settled — sent, suppressed or given up on
  // — is a copy of a name and a price the product holds elsewhere. Thirty days
  // covers "I never got it" questions; pending rows are never touched.
  const deliveredMail = await db
    .delete(messageOutbox)
    .where(
      and(
        inArray(messageOutbox.status, ["sent", "suppressed", "failed"]),
        lt(messageOutbox.createdAt, new Date(now.getTime() - 30 * DAY_MS)),
      ),
    )
    .returning({ id: messageOutbox.id });
  const reviewAddresses = await db
    .update(reviewReports)
    .set({ reporterIp: null })
    .where(and(isNotNull(reviewReports.reporterIp), lt(reviewReports.createdAt, before)))
    .returning({ id: reviewReports.id });
  return {
    deliveredMailDeleted: deliveredMail.length,
    phoneCodesDeleted: phoneCodes.length,
    emailCodesDeleted: emailCodes.length,
    reviewAddressesCleared: reviewAddresses.length,
  };
}
