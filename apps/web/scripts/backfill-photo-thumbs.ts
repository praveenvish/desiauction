// SMALL-COPY BACKFILL. Every player photo now gets a 256px WebP copy beside it
// when it is attached (`thumbKeyOf`, `writeThumbnail`), and the small frames —
// list rows, squad cards, lineups — load that copy instead of the stored
// original (up to 2048px). Photos attached before that change have no copy, so
// those frames still fall back to the full photo. This makes the missing ones.
//
// It reads each photo back from storage, makes the copy, and writes it. Rows
// are never changed: the copy's key is derived from the photo's own. Idempotent
// — re-running rewrites the same copies, so it is safe after a partial run.
//
// Dry run is the DEFAULT. Nothing is written unless you pass --apply.
//
//   pnpm --filter @desiauction/web backfill:thumbs            # count only
//   pnpm --filter @desiauction/web backfill:thumbs --apply    # write
import { MAX_IMAGE_BYTES, thumbKeyOf } from "@desiauction/core";
import { createDb, people, registrations } from "@desiauction/db";
import { isNotNull } from "drizzle-orm";

import { writeThumbnail } from "../src/server/media/ingest.js";
import { storage } from "../src/server/media/index.js";

// Every org's photos, so it reads on the RLS-exempt system pool, like
// seed:admin. Locally DATABASE_URL is the same superuser.
const URL_ = process.env["SYSTEM_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (URL_ === undefined) {
  throw new Error(
    "DATABASE_URL is required (run via pnpm --filter @desiauction/web backfill:thumbs)",
  );
}
const apply = process.argv.includes("--apply");
const handle = createDb(URL_);

async function photoKeys(): Promise<string[]> {
  const own = await handle.db
    .select({ key: people.photoUrl })
    .from(people)
    .where(isNotNull(people.photoUrl));
  const entry = await handle.db
    .select({ key: registrations.enteredPhotoKey })
    .from(registrations)
    .where(isNotNull(registrations.enteredPhotoKey));
  const keys = new Set<string>();
  for (const row of [...own, ...entry]) {
    if (row.key !== null && thumbKeyOf(row.key) !== null) {
      keys.add(row.key);
    }
  }
  return [...keys];
}

async function main(): Promise<void> {
  const keys = await photoKeys();
  console.log(`${String(keys.length)} player photo(s) found.`);
  if (!apply) {
    console.log("Dry run — nothing written. Re-run with --apply to make the small copies.");
    return;
  }
  let made = 0;
  let missing = 0;
  let failed = 0;
  for (const key of keys) {
    const read = await storage.readObject(key, MAX_IMAGE_BYTES);
    if (read.status !== "ok") {
      missing++;
      continue;
    }
    if (await writeThumbnail(storage, key, read.bytes)) {
      made++;
    } else {
      failed++;
    }
  }
  console.log(
    `Made ${String(made)} small copies · ${String(missing)} photo(s) not in storage · ${String(failed)} failed.`,
  );
}

main()
  .then(async () => {
    await handle.sql.end();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await handle.sql.end();
    process.exit(1);
  });
