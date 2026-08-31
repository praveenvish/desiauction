import { describe, expect, it } from "vitest";

import {
  acquireSingleWriterLease,
  describeLeaseHolder,
  LEASE_ORPHAN_AFTER_SECONDS,
  SingleWriterLeaseUnavailable,
  SINGLE_WRITER_LOCK_CLASS,
  SINGLE_WRITER_LOCK_KEY,
} from "./single-writer.js";

/*
 * THE SINGLE-WRITER LEASE (audit 2026-08-26).
 *
 * The engine's whole correctness model is "one writer", and until this lease
 * existed that was enforced by fly.toml and human discipline — a `fly scale 2`
 * or a bluegreen deploy put two timer authorities on one gavel. These tests pin
 * the contract against a stubbed `sql` so they stay fast and hermetic; the
 * behaviour against a real database (second instance refused, lock released on
 * disconnect, replacement claims it cleanly) was proven by booting two real
 * engines before this was written.
 */

type Row = { ok: boolean };

// A minimal stand-in for postgres.js: `reserve()` hands back a tagged-template
// function whose answers each test scripts, plus the `release()` the real
// reserved connection has.
type Sql = Parameters<typeof acquireSingleWriterLease>[0];

interface Stub {
  sql: Sql;
  queries: string[];
  releasedCount: () => number;
}

/** `answers` scripts each `pg_try_advisory_lock` / unlock reply, in order. */
function stubSql(answers: boolean[]): Stub {
  return buildStub(() => {
    const next = answers.shift() ?? true;
    return Promise.resolve([{ ok: next }]);
  });
}

/** Succeeds for `n` queries, then behaves like a dropped connection. */
function stubSqlFailingAfter(n: number): Sql {
  let seen = 0;
  return buildStub(() => {
    seen += 1;
    return seen > n
      ? Promise.reject(new Error("connection lost"))
      : Promise.resolve([{ ok: true }]);
  }).sql;
}

function buildStub(answer: () => Promise<Row[]>): Stub {
  const queries: string[] = [];
  let released = 0;
  const reserved = Object.assign(
    (strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return answer();
    },
    { release: () => void (released += 1) },
  );
  return {
    sql: { reserve: () => Promise.resolve(reserved) } as unknown as Sql,
    queries,
    releasedCount: () => released,
  };
}

describe("single-writer lease", () => {
  it("claims the lock and reports itself held", async () => {
    const { sql, queries } = stubSql([true]);
    const lease = await acquireSingleWriterLease(sql);
    expect(lease.held()).toBe(true);
    // It must be the NON-BLOCKING form: a second instance has to fail fast and
    // visibly, not wait quietly for a lock it should never receive.
    expect(queries[0]).toContain("pg_try_advisory_lock");
  });

  it("REFUSES to start when another instance already holds the lease", async () => {
    const { sql, releasedCount } = stubSql([false]);
    await expect(acquireSingleWriterLease(sql)).rejects.toBeInstanceOf(
      SingleWriterLeaseUnavailable,
    );
    // The connection must go back to the pool — a refused boot must not also
    // leak the socket it failed on.
    expect(releasedCount()).toBe(1);
  });

  it("treats a DEAD CONNECTION as a lost lease, never as a held one", async () => {
    // Acquire succeeds, then the connection dies before the first re-check.
    const failAfterAcquire = stubSqlFailingAfter(1);
    const lease = await acquireSingleWriterLease(failAfterAcquire);
    expect(lease.held()).toBe(true);

    // The advisory lock lives on the SESSION. If that session is gone, the lock
    // went with it and another instance may already hold it — so an unusable
    // connection must read as "not the writer", never as "probably fine".
    await expect(lease.verify()).resolves.toBe(false);
    expect(lease.held()).toBe(false);
  });

  it("verify() re-asserts the lock and unlocks the extra nesting level", async () => {
    // acquire=true, verify's try=true, then the compensating unlock.
    const { sql, queries } = stubSql([true, true, true]);
    const lease = await acquireSingleWriterLease(sql);
    await expect(lease.verify()).resolves.toBe(true);
    // Re-acquiring on a session that already holds it NESTS the lock; without
    // giving the level back, every check would leak one and the final unlock
    // would leave the lock held.
    expect(queries.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("verify() reports FALSE when somebody else now holds the lock", async () => {
    const { sql } = stubSql([true, false]);
    const lease = await acquireSingleWriterLease(sql);
    await expect(lease.verify()).resolves.toBe(false);
    // Once lost, it stays lost — the process is expected to die on this.
    expect(lease.held()).toBe(false);
    await expect(lease.verify()).resolves.toBe(false);
  });

  it("release() unlocks and hands the connection back", async () => {
    const { sql, queries, releasedCount } = stubSql([true, true]);
    const lease = await acquireSingleWriterLease(sql);
    await lease.release();
    expect(queries.some((q) => q.includes("pg_advisory_unlock"))).toBe(true);
    expect(releasedCount()).toBe(1);
    expect(lease.held()).toBe(false);
  });

  it("pins the lock coordinates so two versions cannot disagree about the key", () => {
    // If these ever drift between releases, an old and a new engine would take
    // DIFFERENT locks and both believe they are the only writer.
    expect(SINGLE_WRITER_LOCK_CLASS).toBe(0x0de5_1a11);
    expect(SINGLE_WRITER_LOCK_KEY).toBe(1);
  });
});

/*
 * THE CORPSE CASE (2026-08-31).
 *
 * The header used to promise that a hard-killed engine "never wedges its
 * replacement". It does: the process dies, the backend does not, and the lock
 * is honoured by a session nobody is driving. These tests pin the part that is
 * ours to get right — telling an operator WHICH of the two refusals they have.
 */
describe("single-writer lease · naming the holder", () => {
  /** A stub whose `sql` is also callable as a tagged template (the holder query). */
  function stubWithHolder(holderRows: unknown[], lockAnswer = false): Sql {
    const reserved = Object.assign(() => Promise.resolve([{ ok: lockAnswer }]), {
      release: () => undefined,
    });
    const sql = Object.assign(() => Promise.resolve(holderRows), {
      reserve: () => Promise.resolve(reserved),
    });
    return sql as unknown as Sql;
  }

  it("names an ORPHANED backend and prints the command that recovers it", async () => {
    const sql = stubWithHolder([
      {
        pid: 62,
        application_name: "postgres.js",
        state: "idle",
        // numeric comes back from postgres.js as a string — the real shape.
        idle_seconds: "14523.7",
        client_addr: "192.168.65.1",
      },
    ]);
    const error = await acquireSingleWriterLease(sql).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SingleWriterLeaseUnavailable);
    const refusal = error as SingleWriterLeaseUnavailable;
    expect(refusal.holder?.likelyOrphaned).toBe(true);
    expect(refusal.message).toContain("ORPHANED");
    // The operator must not have to look the recovery up.
    expect(refusal.message).toContain("pg_terminate_backend(62)");
  });

  it("does NOT call a live second instance orphaned", async () => {
    // Busy, or idle briefly — a running engine re-asserts every 10s.
    const sql = stubWithHolder([
      {
        pid: 71,
        application_name: "postgres.js",
        state: "idle",
        idle_seconds: String(LEASE_ORPHAN_AFTER_SECONDS - 1),
        client_addr: null,
      },
    ]);
    const error = await acquireSingleWriterLease(sql).catch((e: unknown) => e);
    const refusal = error as SingleWriterLeaseUnavailable;
    expect(refusal.holder?.likelyOrphaned).toBe(false);
    expect(refusal.message).toContain("refusing to start a second writer");
    // Telling an operator to terminate a LIVE writer would take the gavel out
    // of a running auction. That advice must never appear here.
    expect(refusal.message).not.toContain("pg_terminate_backend");
  });

  it("still refuses when the holder cannot be identified", async () => {
    const sql = stubWithHolder([]);
    const error = await acquireSingleWriterLease(sql).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SingleWriterLeaseUnavailable);
    expect((error as SingleWriterLeaseUnavailable).holder).toBeNull();
  });

  it("NEVER throws its own error over the refusal it was sent to explain", async () => {
    // The diagnostic query fails (no permission, catalog unavailable, whatever).
    // The boot must still fail with SingleWriterLeaseUnavailable, not with this.
    const reserved = Object.assign(() => Promise.resolve([{ ok: false }]), {
      release: () => undefined,
    });
    const sql = Object.assign(() => Promise.reject(new Error("permission denied")), {
      reserve: () => Promise.resolve(reserved),
    }) as unknown as Sql;
    await expect(describeLeaseHolder(sql)).resolves.toBeNull();
    await expect(acquireSingleWriterLease(sql)).rejects.toBeInstanceOf(
      SingleWriterLeaseUnavailable,
    );
  });
});
