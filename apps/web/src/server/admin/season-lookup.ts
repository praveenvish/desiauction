import { competitions, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";

/**
 * Slug → which season, in which club — for the desks that ACT on a season (the
 * pass desk, the moderation desk).
 *
 * A platform operator is a member of no club, so this one question has to be
 * answered on the system pool, behind the desk's own gate. Everything the desk
 * then writes happens inside that club's tenant boundary, on the application
 * role — never here.
 */
export async function platformSeasonBySlug(
  db: Db,
  slug: string,
): Promise<{ id: string; orgId: string; name: string } | null> {
  const [row] = await db
    .select({ id: competitions.id, orgId: competitions.orgId, name: competitions.name })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  return row ?? null;
}
