import { people, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";

/**
 * The address the delivery adapter may use, or null.
 *
 * Reads `email_verified_at`, never the column alone. An address a person typed
 * and never confirmed is a string, and the adapter refusing `no_email_on_file`
 * is the correct outcome for it.
 */
export async function verifiedEmailOf(db: Db, personId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: people.email, verifiedAt: people.emailVerifiedAt })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  return row?.verifiedAt == null ? null : (row.email ?? null);
}
