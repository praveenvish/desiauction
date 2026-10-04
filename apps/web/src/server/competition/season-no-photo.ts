import { competitions } from "@desiauction/db";
import { isNoPhotoStyle, type NoPhotoStyle } from "@desiauction/ui";
import { eq } from "drizzle-orm";
import { cache } from "react";

import { systemDb } from "../db";

/**
 * How this season draws a player with no photo (0107) — for the layouts that
 * hand it to every `PlayerImage` below them.
 *
 * Read by slug on the system pool and ungated, like `seasonUnit`: the season
 * tree has public children (spectate, overlay, register), and what it reveals
 * is a drawing preference, not a fact about anyone. Cached per request, so the
 * layout and a page that also needs it read the row once.
 */
export const seasonNoPhotoStyle = cache(async (slug: string): Promise<NoPhotoStyle> => {
  const [row] = await systemDb
    .select({ style: competitions.noPhotoStyle })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  return isNoPhotoStyle(row?.style) ? row.style : "initials";
});
