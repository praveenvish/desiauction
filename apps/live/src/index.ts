import { readEnv } from "./env.js";
import { liveDatabase } from "./database.js";
import { readLive } from "./reader.js";
import { createServer } from "./server.js";
const env = readEnv();
const notifications: { hub?: (fixtureId: string) => void } = {};
const database = await liveDatabase(env.LIVE_DATABASE_URL, (fixtureId) => {
  notifications.hub?.(fixtureId);
});
const application = createServer(
  env,
  (id, proof) => readLive(database.reader.db, id, proof),
  async () => {
    if (!database.ready()) return false;
    await database.reader.sql`select 1`;
    return true;
  },
);
notifications.hub = application.hub.notify;
try {
  await application.server.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  await database.close();
  throw error;
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await application.server.close();
  } finally {
    await database.close();
  }
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
