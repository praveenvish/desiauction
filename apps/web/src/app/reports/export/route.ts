import { toCsv } from "@desiauction/core";

import { currentSession } from "../../../server/auth/actions";
import { reportRows, type ReportTable } from "../../../server/console/reports";
import { reportsView } from "../../../server/console/views";

// Reads cookies and the database; never cached, never prerendered.
export const dynamic = "force-dynamic";

/** Byte-order mark, as an escape so no invisible character lives in source. */
const BOM = "\uFEFF";

const TABLES = new Set<ReportTable>(["registrations", "teams", "buys"]);

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
}

/**
 * One report table as a file — built from the SAME `reportsView` the page
 * renders, so it carries exactly the gates the page does: the season must be
 * one this person reviews (an exact slug match, never the page's "most recent"
 * fallback), and a money table (team spend, top buys) exists only for money
 * sight. Anything else gets the same 404 a stranger gets, so the route never
 * confirms a season it will not show.
 */
export async function GET(request: Request): Promise<Response> {
  if ((await currentSession()) === null) {
    return notFound();
  }
  const url = new URL(request.url);
  const slug = url.searchParams.get("season") ?? "";
  const table = url.searchParams.get("table") ?? "";
  // Slugs are lower-case kebab; anything else is not one, and it would also
  // reach the Content-Disposition header below.
  if (!/^[a-z0-9-]{1,120}$/.test(slug) || !TABLES.has(table as ReportTable)) {
    return notFound();
  }
  const view = await reportsView(slug);
  if (view.season?.slug !== slug || view.report === null) {
    return notFound();
  }
  const rows = reportRows(view.report, table as ReportTable);
  if (rows === null) {
    return notFound();
  }
  const csv = toCsv(rows.header, rows.rows);
  // A BOM so Excel reads "₹" and Devanagari names as UTF-8 (see export-dialog).
  return new Response(`${BOM}${csv}`, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-${table}.csv"`,
      "cache-control": "no-store",
    },
  });
}
