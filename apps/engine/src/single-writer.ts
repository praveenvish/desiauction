import type postgres from "postgres";

/**
 * THE SINGLE-WRITER LEASE.
 *
 * The engine holds every live auction's state in memory and applies commands
 * through a per-auction FIFO queue, which makes it the single mutation
 * authority — but only WITHIN one process. Across processes the guarantee was
 * platform configuration (a `fly.toml`, in the deployment of the day) plus
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
 * enforced one: the lock lives as long as the owning SESSION, so there is no
 * lease table, no expiry arithmetic and no janitor to run. A second session is
 * refused while the first holds it, and acquires cleanly the moment the first
 * disconnects.
 *
 * WHAT ENDS THE SESSION IS THE CONNECTION CLOSING — not the process dying, and
 * those come apart in exactly one case. This comment used to claim that "a
 * crashed or hard-killed engine never wedges its replacement", which is right
 * for the reason it names but wrong about its reach: when a process is killed
 * the KERNEL closes its sockets, so `kill -9` really does free the lease at
 * once (re-verified 2026-08-31 — the replacement booted immediately).
 *
 * The lease wedges when the connection is severed WITHOUT a close: the database
 * host or VM restarting, a laptop sleeping, a NAT table losing its entry, a
 * network partition. Nothing reaches the server, so it keeps a backend open for
 * a peer that will never speak again — and keeps honouring its lock. Observed
 * 2026-08-31 after a Docker Desktop restart: the backend sat `idle` for four
 * hours holding the lease and every replacement died at boot. Postgres is right
 * to honour that session; the mistake is assuming it can always tell.
 *
 * Two things follow, and both are load-bearing:
 *   1. The DATABASE must probe for peers that stopped answering
 *      (`tcp_keepalives_idle` — set on the local container in
 *      docker-compose.yml, and required of every deployed database; see
 *      docs/operations/DEPLOYMENT.md). This is the ONLY thing that bounds how
 *      long a severed connection holds the lease.
 *   2. A refusal must say WHICH it is. "Another engine is running" and "a corpse
 *      is holding the lock" demand opposite responses from an operator, and the
 *      lock alone cannot tell them apart — so on refusal we look the holder up
 *      and name it. See `describeLeaseHolder`.
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

/**
 * How long a holder may sit idle before it is certainly NOT a running engine.
 *
 * A live engine re-asserts the lease on its reserved connection every
 * `LEASE_CHECK_MS` (10s, apps/engine/src/index.ts), so its backend can never be
 * idle for a minute. Six missed re-assertions is not a slow engine; it is a
 * corpse. Deliberately generous — calling a live writer orphaned would invite an
 * operator to terminate the one process legitimately holding the gavel.
 */
export const LEASE_ORPHAN_AFTER_SECONDS = 60;

/** Who holds the lease, as `pg_stat_activity` sees them. */
export interface LeaseHolder {
  readonly pid: number;
  readonly applicationName: string;
  readonly state: string;
  readonly idleSeconds: number | null;
  readonly clientAddr: string | null;
  /** Idle far longer than any live engine could be — a session outliving its process. */
  readonly likelyOrphaned: boolean;
}

interface HolderRow {
  readonly pid: number;
  readonly application_name: string;
  readonly state: string | null;
  readonly idle_seconds: string | number | null;
  readonly client_addr: string | null;
}

/**
 * Name the session holding the lease, or null if it cannot be determined.
 *
 * NEVER THROWS. This runs on the failure path of boot, where the only thing
 * worse than an unhelpful error is a different, misleading one: if the
 * diagnostic query itself fails, the caller must still report the refusal it
 * actually observed.
 */
export async function describeLeaseHolder(sql: postgres.Sql): Promise<LeaseHolder | null> {
  try {
    const rows = await sql<HolderRow[]>`
      select
        a.pid,
        coalesce(a.application_name, '') as application_name,
        a.state,
        extract(epoch from (now() - a.state_change)) as idle_seconds,
        host(a.client_addr) as client_addr
      from pg_locks l
      join pg_stat_activity a using (pid)
      where l.locktype = 'advisory'
        and l.classid = ${SINGLE_WRITER_LOCK_CLASS}::oid
        and l.objid = ${SINGLE_WRITER_LOCK_KEY}::oid
        and l.granted
      limit 1
    `;
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    // postgres.js returns `numeric` as a string; `extract(epoch ...)` is numeric.
    const idleSeconds = row.idle_seconds === null ? null : Number(row.idle_seconds);
    const state = row.state ?? "unknown";
    return {
      pid: row.pid,
      applicationName: row.application_name,
      state,
      idleSeconds,
      clientAddr: row.client_addr,
      likelyOrphaned:
        state === "idle" && idleSeconds !== null && idleSeconds > LEASE_ORPHAN_AFTER_SECONDS,
    };
  } catch {
    return null;
  }
}

/**
 * The refusal — and, when we can tell, WHY.
 *
 * The two causes need opposite responses. A live second instance means the
 * orchestrator was asked for two writers and this exit is the system working.
 * An orphaned backend means nothing is running and the operator must terminate
 * a corpse to recover. Emitting one message for both is what turned a two-line
 * fix into an investigation.
 */
export class SingleWriterLeaseUnavailable extends Error {
  readonly holder: LeaseHolder | null;

  constructor(holder: LeaseHolder | null = null) {
    super(SingleWriterLeaseUnavailable.describe(holder));
    this.name = "SingleWriterLeaseUnavailable";
    this.holder = holder;
  }

  private static describe(holder: LeaseHolder | null): string {
    if (holder === null) {
      return "another engine instance already holds the single-writer lease — refusing to start a second writer";
    }
    if (holder.likelyOrphaned) {
      const idle = Math.round(holder.idleSeconds ?? 0);
      return (
        `the single-writer lease is held by an ORPHANED postgres backend (pid ${String(holder.pid)}, ` +
        `${holder.state} for ${String(idle)}s) — no live engine re-asserts for that long, so its process is gone ` +
        `and only the session survives. Recover with: select pg_terminate_backend(${String(holder.pid)});`
      );
    }
    return (
      `another engine instance already holds the single-writer lease (pid ${String(holder.pid)}, ` +
      `${holder.state}) — refusing to start a second writer`
    );
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
      // Look the holder up BEFORE handing the connection back, so the refusal
      // can name a corpse as a corpse.
      const holder = await describeLeaseHolder(sql);
      reserved.release();
      throw new SingleWriterLeaseUnavailable(holder);
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
