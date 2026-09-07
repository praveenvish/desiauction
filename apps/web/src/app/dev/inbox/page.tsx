import { desc, eq } from "drizzle-orm";
import { otpInbox } from "@desiauction/db";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import { db } from "../../../server/db";
import "./inbox.css";

// Development-only OTP delivery surface (IP-2_DESIGN D3). Structurally absent
// outside development: production builds 404 this route before any query.
// ?phone=+91... filters server-side (the e2e suites rely on this).
export const dynamic = "force-dynamic";

export default async function DevInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>;
}) {
  if (env.NODE_ENV !== "development") {
    notFound();
  }
  const { phone } = await searchParams;
  const rows = await db
    .select()
    .from(otpInbox)
    .where(phone !== undefined ? eq(otpInbox.phone, phone) : undefined)
    .orderBy(desc(otpInbox.createdAt))
    .limit(100);
  return (
    <main className="inbox">
      <h1>Dev OTP inbox</h1>
      <p>Latest 100 codes. This page does not exist outside development.</p>
      <table>
        <thead>
          <tr>
            <th>Phone</th>
            <th>Code</th>
            <th>At</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.phone}</td>
              <td data-testid={`code-${row.phone}`}>{row.code}</td>
              <td>
                {/* Pinned like every other time in the product: a bare call
                    reads the HOST zone, so this page showed UTC on a server and
                    IST on a laptop for the same row. Dev-only, but the one
                    unpinned formatter left in the tree. */}
                {row.createdAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
