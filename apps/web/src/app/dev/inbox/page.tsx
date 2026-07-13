import { desc } from "drizzle-orm";
import { otpInbox } from "@desiauction/db";
import { notFound } from "next/navigation";

import { env } from "../../../env";
import { db } from "../../../server/db";
import "./inbox.css";

// Development-only OTP delivery surface (IP-2_DESIGN D3). Structurally absent
// outside development: production builds 404 this route before any query.
export const dynamic = "force-dynamic";

export default async function DevInboxPage() {
  if (env.NODE_ENV !== "development") {
    notFound();
  }
  const rows = await db.select().from(otpInbox).orderBy(desc(otpInbox.createdAt)).limit(20);
  return (
    <main className="inbox">
      <h1>Dev OTP inbox</h1>
      <p>Latest 20 codes. This page does not exist outside development.</p>
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
              <td>{row.createdAt.toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
