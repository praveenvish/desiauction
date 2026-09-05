/**
 * RUNTIME POSTURE — the finops ledger, under the production role recipe.
 *
 * PA-1R Phase 2 found this by probing rather than reading: under the documented
 * four-role recipe, the shipped finance workspace could not issue a receipt.
 * `ops/db/create-app-role.sql` carried `revoke insert, update, delete on
 * finops_events from desiauction_app` (freeze §8.2, "the runner is the
 * writer"), while PX-8's Issue receipt / Issue invoice / Declare profile /
 * Open series actions all append finops events through the app pool. Every
 * local process connects as the OWNER, for which grants are inert, so the whole
 * feature passed every suite and would have failed on the first real receipt.
 *
 * The revoke was also incoherent: the app role holds full DML on every
 * projection REBUILT FROM this log, so blocking only the append contained
 * nothing. The line now sits where it means something, and this file is what
 * holds it there — both halves, because a grant that only allows is half a
 * rule:
 *
 *   append  → ALLOWED  (the workspace works)
 *   rewrite → REFUSED  (invariants 10 and 24; history is evidence)
 */
import { createDb } from "@desiauction/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Fixtures and assertions run as the OWNER; the behaviour under test is
// exercised on the app pool below.
const owner = createDb(process.env["OWNER_DATABASE_URL"] ?? "");
const app = createDb(process.env["DATABASE_URL"] ?? "");

// char(26): a short id is padded by Postgres and then never matches a bound
// parameter, which looks exactly like RLS refusing. Pad, do not count.
const id = (label: string): string => label.padEnd(26, "0");

const ORG = id("01M1POSTUREFINOPSORG");
const EVENT = id("01M1POSTUREFINOPSEVT");

async function clear(): Promise<void> {
  await owner.sql`delete from finops_events where id = ${EVENT}`;
}

beforeAll(clear);
afterAll(async () => {
  await clear();
  await Promise.all([owner.sql.end(), app.sql.end()]);
});

/** One event, appended the way the writer appends: inside a tenant boundary. */
async function appendAsApp(): Promise<void> {
  await app.sql.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${ORG}, true)`;
    await tx`
      insert into finops_events
        (id, org_id, stream_type, stream_id, seq, type, payload, at_ms, actor, command_id, correlation_id)
      values
        (${EVENT}, ${ORG}, 'profile', ${id("01M1POSTUREFINOPSSTR")}, 1, 'ProfileDeclared',
         '{}', 1, ${id("01M1POSTUREFINOPSACT")}, ${id("01M1POSTUREFINOPSCMD")}, ${id("01M1POSTUREFINOPSCOR")})
    `;
  });
}

describe("POSTURE — the finops ledger under the app role", () => {
  it("can APPEND, or the finance workspace cannot issue anything", async () => {
    await expect(
      appendAsApp(),
      "the app role cannot append finops events — every Issue receipt / Issue invoice / " +
        "Declare profile / Open series click fails in production with permission denied",
    ).resolves.not.toThrow();

    const rows = await owner.sql`select id from finops_events where id = ${EVENT}`;
    expect(rows.length).toBe(1);
  });

  it("can NEVER rewrite history — invariants 10 and 24 are the database's job", async () => {
    await appendAsApp().catch(() => undefined); // idempotent for a solo run
    await expect(
      app.sql`update finops_events set type = 'Tampered' where id = ${EVENT}`,
      "the app role could UPDATE the finops event log — the evidence every " +
        "projection is rebuilt from is rewritable by the internet-facing tier",
    ).rejects.toThrow(/permission denied/i);

    await expect(
      app.sql`delete from finops_events where id = ${EVENT}`,
      "the app role could DELETE from the finops event log",
    ).rejects.toThrow(/permission denied/i);

    // And the row is exactly as it was written.
    const rows = (await owner.sql`
      select type from finops_events where id = ${EVENT}
    `) as unknown as { type: string }[];
    expect(rows[0]?.type).toBe("ProfileDeclared");
  });
});
