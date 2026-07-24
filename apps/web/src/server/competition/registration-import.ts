import {
  isBattingStyle,
  isBowlingStyle,
  registrationNumber,
  type CsvRegistrationRow,
} from "@desiauction/core";
import { auditLog, newId, people, registrations, type Db } from "@desiauction/db";
import { inArray } from "drizzle-orm";

// CSV import commit (M-IP3-2, doc 42 "Import Assistant stages rows"). Validation
// happens in core (parseRegistrationCsv) BEFORE this runs — the caller only
// commits a fully-valid file (no partial corruption). Imported players are
// unverified person STUBS (phone is the identity anchor, C-24); each still lands
// in `submitted` and enters the pool through the same human approval gate
// (invariant 5). The whole import is one transaction: rollback-safe.

export interface ImportResult {
  imported: number;
  duplicates: number; // rows whose person was already registered here
}

export async function commitRegistrationImport(
  db: Db,
  competitionId: string,
  orgId: string,
  actorId: string,
  rows: readonly CsvRegistrationRow[],
): Promise<ImportResult> {
  if (rows.length === 0) {
    return { imported: 0, duplicates: 0 };
  }
  return db.transaction(async (tx) => {
    // Resolve existing people by phone in one query, then create stubs for the rest.
    const phones = [...new Set(rows.map((r) => r.phone))];
    const existing = await tx
      .select({ id: people.id, phone: people.phone })
      .from(people)
      .where(inArray(people.phone, phones));
    const personByPhone = new Map(existing.map((p) => [p.phone, p.id]));

    for (const phone of phones) {
      if (!personByPhone.has(phone)) {
        const id = newId();
        const name = rows.find((r) => r.phone === phone)?.name ?? null;
        await tx.insert(people).values({ id, phone, name });
        personByPhone.set(phone, id);
      }
    }

    let imported = 0;
    let duplicates = 0;
    for (const row of rows) {
      const personId = personByPhone.get(row.phone);
      if (personId === undefined) {
        continue;
      }
      const id = newId();
      const inserted = await tx
        .insert(registrations)
        .values({
          id,
          orgId,
          competitionId,
          personId,
          role: row.role,
          status: "submitted",
          registrationNumber: registrationNumber(id),
          ...(row.basePriceBand !== null ? { basePriceBand: row.basePriceBand } : {}),
          // DA-28: whatever the file supplied, so an imported player is not
          // permanently thinner than one who self-registered.
          ...(row.dateOfBirth !== null ? { dateOfBirth: row.dateOfBirth } : {}),
          ...(isBattingStyle(row.battingStyle ?? "") ? { battingStyle: row.battingStyle } : {}),
          ...(isBowlingStyle(row.bowlingStyle ?? "") ? { bowlingStyle: row.bowlingStyle } : {}),
        })
        // Already registered here → skip, don't corrupt the batch.
        .onConflictDoNothing({
          target: [registrations.competitionId, registrations.personId],
        })
        .returning({ id: registrations.id });
      if (inserted.length > 0) {
        imported++;
        // DA-27: the batch row below is subject=competition, so a timeline
        // keyed on the REGISTRATION found nothing and an imported player's
        // history began at their first approval — as if they had appeared
        // from nowhere. Self-registration has always written its own row.
        await tx.insert(auditLog).values({
          id: newId(),
          actor: actorId,
          action: "registration.imported",
          scopeType: "org",
          scopeId: orgId,
          subject: id,
          meta: { source: "csv_import" },
        });
      } else {
        duplicates++;
      }
    }

    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "registration.imported",
      scopeType: "org",
      scopeId: orgId,
      subject: competitionId,
      meta: { imported: String(imported), duplicates: String(duplicates) },
    });
    return { imported, duplicates };
  });
}
