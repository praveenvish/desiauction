import { problemReportScreenshots, problemReports } from "@desiauction/db";
import { and, isNotNull, lt } from "drizzle-orm";

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
