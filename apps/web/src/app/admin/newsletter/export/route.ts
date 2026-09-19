import { toCsv } from "@desiauction/core";

import { recordAdminAccess } from "../../../../server/admin/access-log";
import { platformAdminGate } from "../../../../server/admin/authz";
import { newsletterAddresses } from "../../../../server/marketing/newsletter";
import { asPerson } from "../../../../server/tenant";

// Reads cookies and the database; never cached, never prerendered.
export const dynamic = "force-dynamic";

/**
 * Every address on the product-news list, as a file. Recorded as its own
 * access, because it is the one read here that hands over the whole list.
 * Anyone without `platform.admin` gets the same 404 the console gives them.
 */
export async function GET(): Promise<Response> {
  const admin = await platformAdminGate();
  if (admin === null) {
    return new Response("Not found", { status: 404 });
  }
  await recordAdminAccess(admin, "newsletter-export", null);
  const rows = await asPerson(admin.personId, (db) => newsletterAddresses(db));
  const csv = toCsv(
    ["email", "subscribed_at"],
    rows.map((row) => [row.email, row.createdAt.toISOString()]),
  );
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="newsletter-addresses.csv"',
      "cache-control": "no-store",
    },
  });
}
