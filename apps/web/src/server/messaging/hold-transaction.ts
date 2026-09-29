import type { Db } from "@desiauction/db";
import { sql } from "drizzle-orm";

/**
 * How often the waiting transaction says it is still there. The pool ends a
 * session that sits idle inside a transaction for sixty seconds
 * (packages/db `DEFAULT_IDLE_TXN_TIMEOUT_MS`), so this is a third of that.
 */
export const KEEPALIVE_EVERY_MS = 20_000;

/**
 * DO SOMETHING SLOW WITHOUT LOSING THE TRANSACTION THAT IS WAITING FOR IT
 * (PRR 2026-09-29).
 *
 * A decision notice is sent from inside the club's transaction: the recipients
 * are read on it, the messages go out on the queue's own pool, and the record
 * of who was told is written back on it afterwards. While the messages are
 * going out that transaction has nothing to do — and Postgres ends a session
 * that is idle in a transaction for a minute. Approving a hundred players sends
 * two hundred messages one after another; at a fifth of a second each that is
 * past the limit. The session was cut, every "we told them" row was lost, and
 * the batch was reported as failed although each message had been delivered.
 *
 * A cheap statement on the waiting transaction, a few times a minute, is all it
 * takes to be not idle. Nothing about the send changes: same order, same
 * messages, same rows afterwards.
 *
 * A failed keepalive is ignored on purpose. If the transaction really has gone,
 * the write that follows will say so, and that is the error worth reporting.
 */
export async function keepingTransactionAlive<T>(
  db: Db,
  run: () => Promise<T>,
  everyMs: number = KEEPALIVE_EVERY_MS,
): Promise<T> {
  const timer = setInterval(() => {
    void db.execute(sql`select 1`).catch(() => undefined);
  }, everyMs);
  try {
    return await run();
  } finally {
    clearInterval(timer);
  }
}
