import { createDb } from "@desiauction/db";
export async function liveDatabase(url: string, notify: (fixtureId: string) => void) {
  const listener = createDb(url, { max: 1, statementTimeoutMs: 0 });
  const reader = createDb(url, { max: 1, statementTimeoutMs: 30000 });
  let ready = false;
  // The owning listener handle performs no ordinary queries: listen uses a dedicated child.
  const subscription = await listener.sql
    .listen(
      "match_live",
      (payload) => {
        const [fixtureId, seq] = payload.split(":");
        if (fixtureId && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(fixtureId) && /^\d+$/.test(seq ?? ""))
          notify(fixtureId);
      },
      () => {
        ready = true;
      },
    )
    .catch(async (error: unknown) => {
      await Promise.all([listener.sql.end({ timeout: 2 }), reader.sql.end({ timeout: 2 })]);
      throw error;
    });
  ready = true;
  return {
    reader,
    ready: () => ready,
    async close() {
      ready = false;
      try {
        await subscription.unlisten();
      } finally {
        await Promise.all([listener.sql.end({ timeout: 2 }), reader.sql.end({ timeout: 2 })]);
      }
    },
  };
}
