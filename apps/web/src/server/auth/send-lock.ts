import type { Db } from "@desiauction/db";
import { sql } from "drizzle-orm";

/**
 * ONE SENDER AT A TIME PER HANDSET, MAILBOX AND ADDRESS (PRR 2026-09-29).
 *
 * Every send cap in this directory is "count the recent rows, refuse if there
 * are too many, otherwise insert one" — and the count and the insert were
 * separate statements on a pooled connection. Twenty requests arriving together
 * all counted zero, all passed the 30-second cooldown and the five-an-hour cap,
 * and all sent. The caps held against a person pressing Resend; they did not
 * hold against a script, which is the only thing they exist to stop, and each
 * message that got through is one the platform pays a provider for.
 *
 * So the count and the insert now share a transaction, behind a
 * transaction-scoped advisory lock on WHAT IS BEING LIMITED: the subject (the
 * phone, the mailbox, or the account asking) and the source address. A second
 * request for the same subject waits the few milliseconds the first one takes,
 * then counts a table that already contains the first one's row.
 *
 * The SEND is deliberately outside: the caller sends after this returns, so no
 * lock and no database connection is ever held across a provider call.
 *
 * Subject first, then address, always — two requests can never hold the locks
 * in opposite orders, so they cannot deadlock. The platform-wide ceiling is not
 * locked: serialising every sign-in on one lock would be a queue an attacker
 * could fill, and the worst the race can do there is overshoot a ceiling of
 * thousands by the width of the connection pool.
 */
export async function withSendLock<T>(
  db: Db,
  keys: { subject: string; requestIp: string | null },
  run: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const lockKeys = [
      `code-send:subject:${keys.subject}`,
      ...(keys.requestIp === null ? [] : [`code-send:ip:${keys.requestIp}`]),
    ];
    for (const key of lockKeys) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    // A transaction handle answers every query the pool-level handle does; the
    // limit checks below only select and insert.
    return run(tx);
  });
}
