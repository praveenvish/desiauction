import { createDb, otpInbox } from "@desiauction/db";
import { desc, eq } from "drizzle-orm";

/**
 * READ THE SIGN-IN CODE FROM THE DATABASE, NOT FROM A PAGE.
 *
 * Every spec used to open a second browser page on `/dev/inbox?phone=…` and
 * scrape the code out of the DOM. Two problems with that, one structural and
 * one that costs the whole suite:
 *
 * STRUCTURAL. `/dev/inbox` is dev-only BY DESIGN — a production build 404s it
 * before it runs a query, so OTP codes cannot leak from a real deployment. That
 * is a property worth keeping, and it is also the single reason this suite
 * cannot run against a pre-compiled production server the way CI does. Reading
 * the row directly removes the dependency without weakening the gate.
 *
 * COST. Each read was a full SSR page load with its own database query, and
 * there are a dozen logins in a run. Those page loads land on the same dev
 * server whose memory pressure has been restarting it mid-test.
 *
 * The connection is opened and closed per read. A module-level pool would be
 * faster, but Playwright runs each spec file in its own worker process and
 * there is no per-worker teardown hook to close it — a leaked postgres
 * connection keeps the worker alive after its tests finish, which is a far
 * worse failure than a few milliseconds.
 */

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://desiauction:desiauction@localhost:5433/desiauction";

/**
 * The most recent code minted for a phone.
 *
 * Polls, because the caller races the server action that mints it. Specs
 * already wait for the form to flip to its code step first — this is the
 * belt to that braces, and it turns a rare flake into a slightly slower pass.
 */
export async function latestOtp(phone: string, timeoutMs = 5000): Promise<string> {
  const e164 = phone.startsWith("+") ? phone : `+91${phone}`;
  const handle = createDb(DATABASE_URL);
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const [row] = await handle.db
        .select({ code: otpInbox.code })
        .from(otpInbox)
        .where(eq(otpInbox.phone, e164))
        .orderBy(desc(otpInbox.createdAt))
        .limit(1);
      if (row !== undefined) {
        return row.code;
      }
      if (Date.now() >= deadline) {
        // Named loudly. A silent "" here would fail at the code field with
        // "that code didn't match", which sends the next reader hunting through
        // the login flow for a bug that is actually a missing row.
        throw new Error(`no OTP was minted for ${e164} within ${String(timeoutMs)}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    await handle.sql.end({ timeout: 5 });
  }
}
