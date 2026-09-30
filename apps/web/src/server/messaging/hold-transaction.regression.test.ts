// Against real Postgres, with the production idle limit shortened so the test
// takes a second instead of a minute: a transaction that outwaits the limit
// three times over is still there, because it was kept alive.
import { createDb, type Db, type DbHandle } from "@desiauction/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { keepingTransactionAlive } from "./hold-transaction";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

afterAll(async () => {
  await handle.sql.end({ timeout: 5 });
});

describe("a transaction that waits for a slow send", () => {
  // The other half — the SAME wait with no keepalive — was run while this was
  // written and is cut by Postgres after 400 ms, as expected. It is not kept as
  // a test: a session the server kills is reported by the driver from outside
  // the test (its rollback has no socket to write to), which fails the run for
  // behaving correctly.
  it("survives the same wait when it is kept alive, and the write after it lands", async () => {
    const result = await db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      await tx.execute(sql`set local idle_in_transaction_session_timeout = '400ms'`);
      const sent = await keepingTransactionAlive(
        tx,
        async () => {
          await wait(1_200);
          return "sent";
        },
        100,
      );
      const rows = await tx.execute(sql`select 42 as answer`);
      return { sent, answer: (rows as unknown as { answer: number }[])[0]?.answer };
    });
    expect(result).toEqual({ sent: "sent", answer: 42 });
  });

  it("passes the send's own failure through, and stops its timer either way", async () => {
    let ticks = 0;
    const counting = {
      execute: () => {
        ticks += 1;
        return Promise.resolve([]);
      },
    } as unknown as Db;
    await expect(
      keepingTransactionAlive(
        counting,
        async () => {
          await wait(120);
          throw new Error("provider down");
        },
        25,
      ),
    ).rejects.toThrow("provider down");
    const atFailure = ticks;
    expect(atFailure).toBeGreaterThan(1);
    await wait(120);
    expect(ticks).toBe(atFailure);
  });
});
