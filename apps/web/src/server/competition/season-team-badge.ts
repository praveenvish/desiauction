import { competitions } from "@desiauction/db";
import { DEFAULT_TEAM_BADGE, isTeamBadge, type TeamBadge } from "@desiauction/ui";
import { eq } from "drizzle-orm";
import { cache } from "react";

import { systemDb } from "../db";

/**
 * How this season draws a team with no logo (0111) — the shield or initials —
 * for the layouts that hand it to every team badge below them, and for the
 * posters and link cards that draw one on the server.
 *
 * Read by slug on the system pool and ungated, like `seasonNoPhotoStyle`: a
 * drawing preference, not a fact about anyone. Cached per request.
 */
export const seasonTeamBadge = cache(async (slug: string): Promise<TeamBadge> => {
  const [row] = await systemDb
    .select({ badge: competitions.teamBadge })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  return isTeamBadge(row?.badge) ? row.badge : DEFAULT_TEAM_BADGE;
});
