import { NextResponse } from "next/server";

import { recordAdminAccess } from "../../../../../server/admin/access-log";
import { platformSupportGate } from "../../../../../server/admin/authz";
import { reportScreenshot } from "../../../../../server/admin/report-views";

/**
 * ONE SCREENSHOT, TO ONE OPERATOR (FR-1 Phase 1).
 *
 * The picture of somebody's screen is the most sensitive thing a report holds,
 * which is why it never went to the public media store. This is the only way
 * out: `platform:support`, or a 404 that does not admit the report exists.
 *
 * `private, no-store` so no shared cache and no back-button cache keeps a copy.
 * The content type is the one sniffed from the bytes at upload and pinned by a
 * CHECK in 0064, and `sandbox` means that even a browser that decided to treat
 * the response as a document could not run anything in it.
 */
export const dynamic = "force-dynamic";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> },
): Promise<NextResponse> {
  const operator = await platformSupportGate();
  const { reportId } = await params;
  if (operator === null || !ULID.test(reportId)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const shot = await reportScreenshot(reportId);
  if (shot === null) {
    return new NextResponse("Not found", { status: 404 });
  }
  await recordAdminAccess(operator, "reports", reportId);
  return new NextResponse(new Uint8Array(shot.bytes), {
    status: 200,
    headers: {
      "Content-Type": shot.contentType,
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="report-${reportId}"`,
      // Restated in next.config.mjs, whose site-wide header would otherwise win.
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
    },
  });
}
