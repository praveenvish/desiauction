import { erasureRequests, newId, people, type Db } from "@desiauction/db";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";

/**
 * ERASURE REQUESTS — the record of somebody asking, and of the answer.
 *
 * Plain functions over a handle the caller has already scoped: the person's own
 * boundary for filing and withdrawing, the privacy desk's for deciding. The
 * table has no RLS (it is platform-to-person data, like `consent_records`), so
 * every query here names the person or the request it is about — there is no
 * policy underneath to catch a query that forgets.
 */

export interface MyErasureRequest {
  id: string;
  status: "requested" | "completed" | "declined" | "withdrawn";
  requestedAt: Date;
  decidedAt: Date | null;
  /** Shown to the person only when the desk declined — it is the reason why. */
  decisionNote: string | null;
}

/** The person's most recent request, if any. */
export async function latestRequestOf(db: Db, personId: string): Promise<MyErasureRequest | null> {
  const [row] = await db
    .select({
      id: erasureRequests.id,
      status: erasureRequests.status,
      requestedAt: erasureRequests.requestedAt,
      decidedAt: erasureRequests.decidedAt,
      decisionNote: erasureRequests.decisionNote,
    })
    .from(erasureRequests)
    .where(eq(erasureRequests.personId, personId))
    .orderBy(desc(erasureRequests.requestedAt))
    .limit(1);
  return row ?? null;
}

/** Longest reason kept. The desk needs a sentence, not an essay. */
export const REASON_LIMIT = 1000;

/**
 * File a request. Idempotent: the partial unique index admits one OPEN request
 * per person, so a second press returns the first rather than an error.
 */
export async function fileRequest(
  db: Db,
  personId: string,
  reason: string | null,
): Promise<{ id: string; created: boolean }> {
  const trimmed = reason?.trim().slice(0, REASON_LIMIT) ?? "";
  const inserted = await db
    .insert(erasureRequests)
    .values({ id: newId(), personId, reason: trimmed === "" ? null : trimmed })
    .onConflictDoNothing()
    .returning({ id: erasureRequests.id });
  if (inserted[0] !== undefined) {
    return { id: inserted[0].id, created: true };
  }
  const open = await latestRequestOf(db, personId);
  return { id: open?.id ?? "", created: false };
}

/** The person takes their open request back. False when there was none open. */
export async function withdrawRequest(db: Db, personId: string): Promise<boolean> {
  const updated = await db
    .update(erasureRequests)
    .set({ status: "withdrawn", decidedBy: personId, decidedAt: new Date() })
    .where(and(eq(erasureRequests.personId, personId), eq(erasureRequests.status, "requested")))
    .returning({ id: erasureRequests.id });
  return updated.length > 0;
}

/** Declining needs a reason the person will read. */
export async function declineRequest(
  db: Db,
  input: { requestId: string; operatorId: string; note: string },
): Promise<boolean> {
  const note = input.note.trim().slice(0, REASON_LIMIT);
  if (note === "") {
    return false;
  }
  const updated = await db
    .update(erasureRequests)
    .set({
      status: "declined",
      decidedBy: input.operatorId,
      decidedAt: new Date(),
      decisionNote: note,
    })
    .where(and(eq(erasureRequests.id, input.requestId), eq(erasureRequests.status, "requested")))
    .returning({ id: erasureRequests.id });
  return updated.length > 0;
}

export interface QueueRow {
  id: string;
  personId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  reason: string | null;
  requestedAt: Date;
}

/** Open requests, oldest first — the order the seven-day promise runs in. */
export async function openRequests(db: Db): Promise<QueueRow[]> {
  return db
    .select({
      id: erasureRequests.id,
      personId: erasureRequests.personId,
      name: people.name,
      phone: people.phone,
      email: people.email,
      reason: erasureRequests.reason,
      requestedAt: erasureRequests.requestedAt,
    })
    .from(erasureRequests)
    .innerJoin(people, and(eq(people.id, erasureRequests.personId), isNull(people.erasedAt)))
    .where(eq(erasureRequests.status, "requested"))
    .orderBy(asc(erasureRequests.requestedAt));
}

export interface DecidedRow {
  id: string;
  status: "completed" | "declined" | "withdrawn";
  requestedAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
}

/** The recent history, newest first, without naming anybody who was erased. */
export async function recentDecisions(db: Db, limit = 20): Promise<DecidedRow[]> {
  const rows = await db
    .select({
      id: erasureRequests.id,
      status: erasureRequests.status,
      requestedAt: erasureRequests.requestedAt,
      decidedAt: erasureRequests.decidedAt,
      decisionNote: erasureRequests.decisionNote,
    })
    .from(erasureRequests)
    // The exact complement of the queue's filter, so the two lists partition
    // the table between them.
    .where(ne(erasureRequests.status, "requested"))
    .orderBy(desc(erasureRequests.decidedAt))
    .limit(limit);
  return rows.filter((row): row is DecidedRow => row.status !== "requested");
}
