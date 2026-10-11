import { competitions, type Db } from "@desiauction/db";
import { and, eq } from "drizzle-orm";

import { systemDb } from "../db";
import { TEAM_ENTRY_CODE } from "./team-entry-code";

// C41 Astra-approved pre-tenant reader. A code conveys submission access only.
// No roster, contacts, grants, captain identities or writes leave this module.
export async function entryCompetitionByCode(code: string, db: Db = systemDb) {
  if (!TEAM_ENTRY_CODE.test(code)) return null;
  const [row] = await db
    .select({
      id: competitions.id,
      orgId: competitions.orgId,
      name: competitions.name,
      sport: competitions.sport,
    })
    .from(competitions)
    .where(
      and(
        eq(competitions.entryCode, code),
        eq(competitions.teamFormation, "team_entry"),
        eq(competitions.status, "registration_open"),
      ),
    )
    .limit(1);
  return row ?? null;
}
