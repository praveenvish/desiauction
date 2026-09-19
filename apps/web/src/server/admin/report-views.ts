import { people, problemReportScreenshots, problemReports, type Db } from "@desiauction/db";
import { desc, eq, sql } from "drizzle-orm";

import { systemDb } from "../db";

/**
 * THE PROBLEM-REPORT QUEUE, AS A PROJECTION (FR-1 Phase 1).
 *
 * Read-only like every module in administration; the write lives in
 * `server/support/report-desk.ts`. On the system pool, as every admin read is —
 * `problem_reports` has no org and no RLS, so the pool does no RLS work here.
 *
 * THE SCREENSHOT IS NOT IN THE ROW. The queue says whether one exists; the
 * bytes come from `reportScreenshot`, one at a time, through a gated route.
 * Listing fifty reports must not pull fifty images into the page.
 */

export interface ReportQueueRow {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly pageUrl: string;
  readonly context: Record<string, string>;
  readonly replyEmail: string | null;
  /** Null for a guest, or a person since deleted. */
  readonly reporterName: string | null;
  readonly signedIn: boolean;
  readonly status: string;
  readonly createdAt: Date;
  readonly triagedAt: Date | null;
  readonly hasScreenshot: boolean;
}

export interface ReportQueue {
  readonly open: readonly ReportQueueRow[];
  readonly closed: readonly ReportQueueRow[];
}

const RECENT_LIMIT = 100;

/** `db` is injectable so the read-only proof can drive it through a refusing handle. */
export async function reportQueue(db: Db = systemDb): Promise<ReportQueue> {
  const rows = await db
    .select({
      id: problemReports.id,
      category: problemReports.category,
      description: problemReports.description,
      pageUrl: problemReports.pageUrl,
      context: problemReports.context,
      replyEmail: problemReports.replyEmail,
      personId: problemReports.personId,
      reporterName: people.name,
      status: problemReports.status,
      createdAt: problemReports.createdAt,
      triagedAt: problemReports.triagedAt,
      hasScreenshot: sql<boolean>`${problemReportScreenshots.reportId} is not null`,
    })
    .from(problemReports)
    .leftJoin(people, eq(people.id, problemReports.personId))
    .leftJoin(problemReportScreenshots, eq(problemReportScreenshots.reportId, problemReports.id))
    .orderBy(desc(problemReports.createdAt))
    .limit(RECENT_LIMIT);

  const shaped: ReportQueueRow[] = rows.map((row) => ({
    id: row.id,
    category: row.category,
    description: row.description,
    pageUrl: row.pageUrl,
    context: row.context,
    replyEmail: row.replyEmail,
    reporterName: row.reporterName,
    signedIn: row.personId !== null,
    status: row.status,
    createdAt: row.createdAt,
    triagedAt: row.triagedAt,
    hasScreenshot: row.hasScreenshot,
  }));
  return {
    open: shaped.filter((row) => row.status === "new" || row.status === "triaged"),
    closed: shaped.filter((row) => row.status !== "new" && row.status !== "triaged"),
  };
}

/** One screenshot's bytes, for the gated route. Null when there is none. */
export async function reportScreenshot(
  reportId: string,
): Promise<{ contentType: string; bytes: Buffer } | null> {
  const [row] = await systemDb
    .select({
      contentType: problemReportScreenshots.contentType,
      bytes: problemReportScreenshots.bytes,
    })
    .from(problemReportScreenshots)
    .where(eq(problemReportScreenshots.reportId, reportId))
    .limit(1);
  return row ?? null;
}
