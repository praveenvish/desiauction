import { newId, orgImportMappings, type Db } from "@desiauction/db";
import { and, eq, isNull } from "drizzle-orm";

import type { ColumnMapping, DateOrder, ValueMaps } from "@desiauction/core";

/**
 * THE SAVED ANSWER TO "HOW IS THIS CLUB'S FORM READ".
 *
 * Storage only — the translation itself is pure and lives in core's
 * `import-mapping.ts`. Every call here runs inside a `withTenantDb` boundary,
 * so the org policy on the table is what scopes the rows; nothing in this file
 * filters by org for security, only for correctness of the LOOKUP.
 */

export interface SavedMapping {
  id: string;
  /** Null for the org's default; set for a single season's override. */
  competitionId: string | null;
  signature: string;
  label: string | null;
  mapping: ColumnMapping;
  valueMaps: ValueMaps;
  dateOrder: DateOrder;
}

/**
 * The mapping to use for a file with this layout, most specific first.
 *
 * A season's own override beats the club default, and that ordering is the
 * whole reason overrides exist: a club running one differently-shaped form for
 * one tournament must not have to break its default to do it.
 */
export async function savedMappingFor(
  db: Db,
  orgId: string,
  competitionId: string,
  signature: string,
): Promise<SavedMapping | null> {
  const rows = await db
    .select()
    .from(orgImportMappings)
    .where(and(eq(orgImportMappings.orgId, orgId), eq(orgImportMappings.signature, signature)));
  const hydrate = (row: (typeof rows)[number]): SavedMapping => ({
    id: row.id,
    competitionId: row.competitionId,
    signature: row.signature,
    label: row.label,
    mapping: row.mapping as ColumnMapping,
    valueMaps: row.valueMaps as ValueMaps,
    dateOrder: row.dateOrder,
  });
  const override = rows.find((row) => row.competitionId === competitionId);
  if (override !== undefined) {
    return hydrate(override);
  }
  const fallback = rows.find((row) => row.competitionId === null);
  return fallback === undefined ? null : hydrate(fallback);
}

export interface SaveMappingInput {
  competitionId: string | null;
  signature: string;
  label: string | null;
  mapping: ColumnMapping;
  valueMaps: ValueMaps;
  dateOrder: DateOrder;
}

/**
 * Remember a confirmed mapping, replacing the one it supersedes.
 *
 * UPDATE-THEN-INSERT rather than `onConflictDoUpdate`, because the uniqueness
 * that matters is split across two PARTIAL indexes (default vs override) and no
 * single conflict target names both. The read is inside the same transaction as
 * the write, so two organizers confirming the same form at once cannot both
 * insert — the loser's insert hits the partial index and is retried as an
 * update by the caller's next save. Losing a saved MAPPING is a nuisance, never
 * a data loss: the import it belongs to has not run yet.
 */
export async function saveImportMapping(
  db: Db,
  orgId: string,
  actorId: string,
  input: SaveMappingInput,
): Promise<SavedMapping> {
  return db.transaction(async (tx) => {
    const scope =
      input.competitionId === null
        ? isNull(orgImportMappings.competitionId)
        : eq(orgImportMappings.competitionId, input.competitionId);
    const [existing] = await tx
      .select({ id: orgImportMappings.id })
      .from(orgImportMappings)
      .where(
        and(
          eq(orgImportMappings.orgId, orgId),
          eq(orgImportMappings.signature, input.signature),
          scope,
        ),
      )
      .limit(1);

    const values = {
      mapping: input.mapping,
      valueMaps: input.valueMaps,
      dateOrder: input.dateOrder,
      label: input.label,
      updatedBy: actorId,
      updatedAt: new Date(),
    };
    if (existing !== undefined) {
      await tx.update(orgImportMappings).set(values).where(eq(orgImportMappings.id, existing.id));
      return { id: existing.id, ...input };
    }
    const id = newId();
    await tx.insert(orgImportMappings).values({
      id,
      orgId,
      competitionId: input.competitionId,
      signature: input.signature,
      createdBy: actorId,
      ...values,
    });
    return { id, ...input };
  });
}

/** Forget a saved mapping — the organizer's way out of a wrong one. */
export async function forgetImportMapping(db: Db, orgId: string, id: string): Promise<void> {
  await db
    .delete(orgImportMappings)
    .where(and(eq(orgImportMappings.orgId, orgId), eq(orgImportMappings.id, id)));
}
