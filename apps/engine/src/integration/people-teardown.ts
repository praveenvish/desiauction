import {
  consentRecords,
  grants,
  orgMembers,
  paddleGrants,
  paddles,
  people,
  registrations,
} from "@desiauction/db";
import { inArray } from "drizzle-orm";

import { db } from "../db.js";

/**
 * DELETE THESE PEOPLE, AND EVERY ROW THAT WOULD REFUSE TO LET THEM GO.
 *
 * Migration 0040 gave all eleven `person_id` columns real foreign keys, six of
 * them `ON DELETE RESTRICT`. From that day a suite's `afterAll` could pass every
 * assertion and still fail, because the last statement — `delete from people` —
 * hit a 23503 and took the whole suite red with nothing wrong with the engine.
 * Worse than a red suite: the run then leaks a person and its children into the
 * shared database, and that residue is what later makes an unrelated failure
 * look like a product bug (audit PA-1 §21).
 *
 * THE BUG WAS A SCOPE MISMATCH, not a missing delete. The teardowns removed
 * children `where org_id = <this suite's org>` and then removed people
 * `where id in (<this suite's people>)`. Those are two different questions. Any
 * row that references one of these people from a DIFFERENT org — and the engine
 * writes `paddle_grants` through the real production command path, not by
 * direct insert — survives the first delete and blocks the second. Observed in
 * `nightly-verify` on 2026-09-01..04: four consecutive nights, always
 * `live-engine`, always `paddle_grants_person_id_people_id_fk`.
 *
 * TWO OF THE SIX WERE NEVER DELETED AT ALL. `grants` and `consent_records`
 * appear in no engine teardown, so the moment a test writes a capability grant
 * or a consent record for a bidder, the same failure returns wearing a
 * different constraint name.
 *
 * So this asks ONE question — "which rows point at these people?" — and asks it
 * of every table that can answer. The org-scoped deletes each suite already
 * performs stay where they are: they clear the auction graph, which is a
 * different job. This runs immediately before `people`.
 *
 * The order is dependency order, not preference: `registrations` is referenced
 * by `lots.registration_id` and `paddles` by `bids` and `lots.sold_to_paddle_id`,
 * so both go last among the children, after the auction graph is already gone.
 */
export async function deletePeopleCascading(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  // Leaves first — nothing references these.
  await db.delete(paddleGrants).where(inArray(paddleGrants.personId, [...ids]));
  await db.delete(grants).where(inArray(grants.personId, [...ids]));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, [...ids]));
  await db.delete(orgMembers).where(inArray(orgMembers.personId, [...ids]));
  // Referenced by the auction graph, which the caller's org-scoped deletes have
  // already removed by the time this runs.
  await db.delete(paddles).where(inArray(paddles.personId, [...ids]));
  await db.delete(registrations).where(inArray(registrations.personId, [...ids]));

  await db.delete(people).where(inArray(people.id, [...ids]));
}
