import type postgres from "postgres";

/**
 * THE SINGLE-WRITER LEASE.
 *
 * The engine holds every live auction's state in memory and applies commands
 * through a per-auction FIFO queue, which makes it the single mutation
 * authority — but only WITHIN one process. Across processes the guarantee was
 * `fly.toml` (`min_machines_running = 1`, `auto_stop_machines = false`) plus
 * human discipline, and nothing in the code stopped a second instance: a
 * `fly scale 2` for "capacity", a bluegreen deploy strategy, or an orchestrator
 * that briefly overlaps old and new would put TWO timer authorities on one
 * gavel. Money survives that — `auction_events (auction_id, seq)` is unique, so
 * the loser's whole transaction rolls back and nothing double-sells — but the
 * room does not: two instances broadcast divergent snapshots to different
 * owners, run duplicate 250ms watchdogs, and collide on every append until one
 * halts mid-lot.
 *
 * A Postgres SESSION-LEVEL advisory lock turns the documented invariant into an
 * enforced one. It is the right primitive precisely because of how it ends: the
 * lock is held for as long as the owning session lives and is released
 * automatically when that session goes away, so a crashed or hard-killed engine
 * never wedges its replacement — no lease table, no expiry arithmetic, no
 * janitor. Verified against the real database before this was written: a second
 * session is refused while the first holds it, and acquires cleanly the moment
 * the first disconnects.
 *
 * It is held on a RESERVED connection, not a pooled one, because a pooled query
 * can be handed a different socket next time and the lock would be released
 * behind our back.
 */

/**
 * The lock's coordinates. Advisory locks are a single flat namespace shared by
 * everything on the database, so the pair is arbitrary but must be stable and
 * unique to this purpose — never derive it from something that can change.
 */
export const SINGLE_WRITER_LOCK_CLASS = 0x0de5_1a11;
export const SINGLE_WRITER_LOCK_KEY = 1;

export interface SingleWriterLease {
  /** Release the lock and hand the connection back (graceful shutdown). */
  release: () => Promise<void>;
  /**
   * Is this process still the writer? False means the lease was lost — the
   * connection dropped and the database handed our lock to somebody else.
   */
  held: () => boolean;
  /** Re-assert the lease; called on the watchdog cadence. */
  verify: () => Promise<boolean>;
}

export class SingleWriterLeaseUnavailable extends Error {
  constructor() {
    super(
      "another engine instance already holds the single-writer lease — refusing to start a second writer",
    );
    this.name = "SingleWriterLeaseUnavailable";
  }
}

/**
 * Claim the lease, or throw `SingleWriterLeaseUnavailable`.
 *
 * `pg_try_advisory_lock` is the non-blocking form ON PURPOSE: a second instance
 * must fail loudly and immediately so the orchestrator surfaces a failed boot,
 * rather than waiting silently for a lock it should never get and looking
 * healthy while serving nothing.
 */
export async function acquireSingleWriterLease(sql: postgres.Sql): Promise<SingleWriterLease> {
  const reserved = await sql.reserve();
  let lost = false;
  try {
    const [row] = await reserved<{ ok: boolean }[]>`
      select pg_try_advisory_lock(${SINGLE_WRITER_LOCK_CLASS}, ${SINGLE_WRITER_LOCK_KEY}) as ok
    `;
    if (row?.ok !== true) {
      reserved.release();
      throw new SingleWriterLeaseUnavailable();
    }
  } catch (error) {
    if (!(error instanceof SingleWriterLeaseUnavailable)) {
      reserved.release();
    }
    throw error;
  }

  return {
    held: () => !lost,
    /**
     * Re-assert on the reserved connection. If it dropped and postgres.js
     * silently reconnected underneath us, the advisory lock died with the old
     * session — so asking again is not paranoia, it is the only way to notice.
     * A successful re-acquire on a NEW session is still us holding it; what we
     * must catch is somebody ELSE holding it, and the connection being gone.
     */
    verify: async () => {
      if (lost) {
        return false;
      }
      try {
        const [row] = await reserved<{ ok: boolean }[]>`
          select pg_try_advisory_lock(${SINGLE_WRITER_LOCK_CLASS}, ${SINGLE_WRITER_LOCK_KEY}) as ok
        `;
        if (row?.ok !== true) {
          lost = true;
          return false;
        }
        // Re-acquiring on a session that already holds it nests the lock, so
        // give the extra level straight back and stay at exactly one.
        await reserved`
          select pg_advisory_unlock(${SINGLE_WRITER_LOCK_CLASS}, ${SINGLE_WRITER_LOCK_KEY})
        `;
        return true;
      } catch {
        // The connection is unusable; we cannot claim to be the writer.
        lost = true;
        return false;
      }
    },
    release: async () => {
      try {
        await reserved`
          select pg_advisory_unlock(${SINGLE_WRITER_LOCK_CLASS}, ${SINGLE_WRITER_LOCK_KEY})
        `;
      } catch {
        // Losing the connection releases the lock anyway — that is the whole
        // reason this is a session lock and not a row in a table.
      } finally {
        lost = true;
        reserved.release();
      }
    },
  };
}
