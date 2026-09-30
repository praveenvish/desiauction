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
 * phone, the mailbox, or the account asking) and the source address. Only one
 * request at a time counts and inserts for a given subject or address, so each
 * counts a table that already contains the one before it.
 *
 * The SEND is deliberately outside: the caller sends after this returns, so no
 * lock and no database connection is ever held across a provider call.
 *
 * TRIED, NEVER WAITED FOR. The first version of this took the locks and
 * queued behind whoever held them — which makes every waiting request hold a
 * pooled database connection while it waits. A flood from one address (and in
 * India one address is a whole carrier's customers) could then keep all ten of
 * the pool's connections waiting, and the auction's own actions share that
 * pool. Caught in review. So a lock that is taken is an ANSWER, given at once:
 * somebody is already sending to this handset, or from this address, at this
 * instant. `contended` says what that answer is for each caller. A refused
 * request costs one statement and returns its connection.
 *
 * Subject first, then address, always. The platform-wide ceiling is not
 * locked: the worst the race can do there is overshoot a ceiling of thousands
 * by the width of the connection pool.
 */
export async function withSendLock<T>(
  db: Db,
  keys: { subject: string; requestIp: string | null },
  run: (tx: Db) => Promise<T>,
  contended: (lock: "subject" | "address") => T,
): Promise<T> {
  return db.transaction(async (tx) => {
    const locks: { name: "subject" | "address"; key: string }[] = [
      { name: "subject", key: `code-send:subject:${keys.subject}` },
      ...(keys.requestIp === null
        ? []
        : [{ name: "address" as const, key: `code-send:ip:${keys.requestIp}` }]),
    ];
    for (const lock of locks) {
      const [row] = (await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${lock.key}, 0)) as held`,
      )) as unknown as [{ held: boolean }];
      if (!row.held) {
        return contended(lock.name);
      }
    }
    // A transaction handle answers every query the pool-level handle does; the
    // limit checks below only select and insert.
    return run(tx);
  });
}
