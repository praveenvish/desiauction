import {
  isBattingStyle,
  isBowlingStyle,
  normalizeTeamName,
  planImport,
  registrationNumber,
  type CsvRegistrationRow,
  type ExistingRegistration,
  type FieldChange,
  type ImportPolicy,
} from "@desiauction/core";
import { auditLog, newId, people, registrations, teams, type Db } from "@desiauction/db";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";

import { reinstateWithdrawn } from "./registrations";

// CSV import commit (M-IP3-2, doc 42 "Import Assistant stages rows"). Validation
// happens in core (parseRegistrationCsv) BEFORE this runs — every row that
// reaches here fully validated, whether the organizer committed a clean file or
// chose to skip the rows that did not (`skipInvalid`). This function's contract
// is unchanged by that choice: it is handed VALID rows and writes all of them,
// in one transaction, or none. Imported players are
// unverified person STUBS (phone is the identity anchor, C-24); each still lands
// in `submitted` and enters the pool through the same human approval gate
// (invariant 5). The whole import is one transaction: rollback-safe.
//
// DA-35 — DELIBERATE: no competition-status check, for the same reason
// `addPlayerByPhone` has none. Closure shuts the PUBLIC door against strangers
// arriving from a shared link; an organizer importing a roster they already
// hold is the authority that closed it, not a stranger walking through it.
// `submitRegistration` (the public path) keeps its `not_open` refusal, which is
// where closure has to bite. The import dialog says which of the two you are in.

export interface ImportResult {
  imported: number;
  /**
   * Rows whose person already held a registration and whose values the file
   * CHANGED. Formerly counted as "duplicates" and written nowhere: the second
   * file did nothing, and every correction stayed in the spreadsheet.
   */
  updated: number;
  /** Rows the file agrees with entirely — read, compared, and left alone. */
  unchanged: number;
  /** Rows whose person had withdrawn and is back in triage. */
  reinstated: number;
  /** Existing nameless person stubs the file was able to name. */
  named: number;
}

/**
 * What is already stored for these phones, in the shape the diff compares
 * against. One query for the whole file, not one per row.
 */
export async function existingForImport(
  db: Db,
  competitionId: string,
  phones: readonly string[],
): Promise<Map<string, ExistingRegistration & { id: string }>> {
  if (phones.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      id: registrations.id,
      phone: people.phone,
      status: registrations.status,
      role: registrations.role,
      basePriceBand: registrations.basePriceBand,
      dateOfBirth: registrations.dateOfBirth,
      battingStyle: registrations.battingStyle,
      bowlingStyle: registrations.bowlingStyle,
      feeStatus: registrations.feeStatus,
      feeAmountPaise: registrations.feeAmountPaise,
      feeReference: registrations.feeReference,
      note: registrations.note,
      fatherName: registrations.fatherName,
      jerseyName: registrations.jerseyName,
      jerseyNumber: registrations.jerseyNumber,
      tshirtSize: registrations.tshirtSize,
      trouserSize: registrations.trouserSize,
      // The diff compares NAMES on both sides, so the stored side joins the
      // team in rather than making a pure module resolve a ULID.
      teamName: teams.name,
      isIcon: registrations.isIcon,
      isCaptain: registrations.isCaptain,
      isRetained: registrations.isRetained,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    // LEFT: most registrations have no team, and an inner join here would have
    // hidden every one of them from the re-import plan.
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(and(eq(registrations.competitionId, competitionId), inArray(people.phone, [...phones])));
  /*
   * Keyed by phone, and the key must never be null.
   *
   * The query above filters `inArray(people.phone, phones)` on real numbers, so
   * a phone-less person (possible since 0062) cannot match it — but the type
   * says `string | null`, and a null key would silently collapse EVERY such
   * person into one bucket. Dropping them explicitly states the invariant
   * instead of trusting the WHERE clause to keep holding it.
   */
  return new Map(
    rows
      .filter((row): row is typeof row & { phone: string } => row.phone !== null)
      .map(({ phone, ...rest }) => [phone, rest]),
  );
}

/** The column set a planned change touches, as drizzle values. */
function changedValues(
  changes: readonly FieldChange[],
  row: CsvRegistrationRow,
  /** The file's team name resolved to an id — the diff speaks names, the table ids. */
  teamId: string | null,
): Record<string, unknown> {
  const all: Record<string, unknown> = {
    role: row.role,
    basePriceBand: row.basePriceBand,
    dateOfBirth: row.dateOfBirth,
    battingStyle: row.battingStyle,
    bowlingStyle: row.bowlingStyle,
    ...deskFields(row),
    // `teamName` is what the plan named; `teamId` is what the column holds.
    teamName: teamId,
    isIcon: row.isIcon,
    isCaptain: row.isCaptain,
    isRetained: row.isRetained,
  };
  // ONLY the fields the plan named. The preview showed the organizer this exact
  // list; writing anything else would make the preview a lie.
  const out: Record<string, unknown> = {};
  for (const change of changes) {
    if (change.field in all) {
      // The plan's field name is the diff's; the column is the table's, and
      // only the team differs between them.
      out[change.field === "teamName" ? "teamId" : change.field] = all[change.field];
    }
  }
  return out;
}

/**
 * The marks a file supplied, and only those.
 *
 * Same rule as `deskFields`, and it matters more here: absent must stay ABSENT.
 * A club whose sheet lists four retentions leaves fifty-six cells empty, and
 * writing `false` into those would clear every Icon and Captain an organizer
 * had set by hand — a re-import that silently emptied the season's squads.
 */
function squadMarks(row: CsvRegistrationRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (row.isIcon !== null) {
    out["isIcon"] = row.isIcon;
  }
  if (row.isCaptain !== null) {
    out["isCaptain"] = row.isCaptain;
  }
  if (row.isRetained !== null) {
    out["isRetained"] = row.isRetained;
  }
  return out;
}

/**
 * The desk + kit columns a file supplied, and only those.
 *
 * Absent stays ABSENT rather than becoming null: an organizer who typed a note
 * on the dashboard and then imported a corrected roster should not lose it to a
 * column their form never had.
 */
function deskFields(row: CsvRegistrationRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (row.feeStatus !== null) {
    out["feeStatus"] = row.feeStatus;
  }
  if (row.feeAmountPaise !== null) {
    out["feeAmountPaise"] = row.feeAmountPaise;
  }
  if (row.feeReference !== null) {
    out["feeReference"] = row.feeReference;
  }
  if (row.note !== null) {
    out["note"] = row.note;
  }
  if (row.fatherName !== null) {
    out["fatherName"] = row.fatherName;
  }
  if (row.jerseyName !== null) {
    out["jerseyName"] = row.jerseyName;
  }
  if (row.jerseyNumber !== null) {
    out["jerseyNumber"] = row.jerseyNumber;
  }
  if (row.tshirtSize !== null) {
    out["tshirtSize"] = row.tshirtSize;
  }
  if (row.trouserSize !== null) {
    out["trouserSize"] = row.trouserSize;
  }
  return out;
}

export async function commitRegistrationImport(
  db: Db,
  competitionId: string,
  orgId: string,
  actorId: string,
  rows: readonly CsvRegistrationRow[],
  /** Default is the safe one: add what is missing, never revert a hand edit. */
  policy: ImportPolicy = "fill-blanks",
): Promise<ImportResult> {
  if (rows.length === 0) {
    return { imported: 0, updated: 0, unchanged: 0, reinstated: 0, named: 0 };
  }
  return db.transaction(async (tx) => {
    /*
     * The season's teams, by the name a spreadsheet would write.
     *
     * Loaded once rather than per row, and matched on the normalized name so
     * "andheri arrows", "Andheri  Arrows" and "Andheri-Arrows" are one team.
     * The PARSER already refused a name that matches none of these, so anything
     * unresolved here is a team deleted between preview and commit — which
     * leaves the player teamless rather than failing the batch, exactly as an
     * organizer importing before creating teams would.
     */
    const teamRows = await tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.competitionId, competitionId));
    const teamByName = new Map(teamRows.map((team) => [normalizeTeamName(team.name), team.id]));
    const teamIdFor = (row: CsvRegistrationRow): string | null =>
      row.teamName === null ? null : (teamByName.get(normalizeTeamName(row.teamName)) ?? null);

    /*
     * DA-04, at import scale: a team has exactly one captain, and
     * `registrations_team_captain_uq` makes two unrepresentable. The single-row
     * writer resolves that by DEMOTING the incumbent, because an organizer
     * naming a new captain means "this player instead" — the same reading
     * applies to a file. Two captains for one team WITHIN the file were already
     * refused by the parser, where there is no "instead" to honour.
     */
    const demoteOthers = async (teamId: string, keep: string): Promise<void> => {
      await tx
        .update(registrations)
        .set({ isCaptain: false })
        .where(
          and(
            eq(registrations.competitionId, competitionId),
            eq(registrations.teamId, teamId),
            eq(registrations.isCaptain, true),
            ne(registrations.id, keep),
          ),
        );
    };

    // Resolve existing people by phone in one query, then create stubs for the rest.
    const phones = [...new Set(rows.map((r) => r.phone))];
    const existing = await tx
      .select({ id: people.id, phone: people.phone, name: people.name })
      .from(people)
      .where(inArray(people.phone, phones));
    const personByPhone = new Map(existing.map((p) => [p.phone, p.id]));

    let named = 0;
    for (const phone of phones) {
      const name = rows.find((r) => r.phone === phone)?.name ?? null;
      if (!personByPhone.has(phone)) {
        const id = newId();
        await tx.insert(people).values({ id, phone, name });
        personByPhone.set(phone, id);
        continue;
      }
      /*
       * NAME A STUB THE FILE CAN NAME.
       *
       * `addPlayerByPhone` has always done this and the comments here claim the
       * two paths mirror each other — they did not. A person created by some
       * earlier import or invite has a phone and no name; every screen then
       * showed "Unnamed" for a player whose name was sitting in the column we
       * had just read. An EXISTING name is never overwritten: it is the
       * person's own, not ours to correct from a spreadsheet.
       */
      const found = existing.find((person) => person.phone === phone);
      if (found !== undefined && found.name === null && name !== null && name !== "") {
        const updated = await tx
          .update(people)
          .set({ name })
          .where(and(eq(people.id, found.id), isNull(people.name)))
          .returning({ id: people.id });
        named += updated.length;
      }
    }

    /*
     * THE SECOND FILE IS THE NORMAL CASE.
     *
     * The plan is computed against what is already stored and decides each row
     * exactly once — new, changed, unchanged, or reinstate. It is the SAME
     * computation the preview showed the organizer, run again here against the
     * file rather than against anything the browser sent back.
     */
    const stored = await existingForImport(tx, competitionId, phones);
    const diff = planImport(rows, stored, policy);
    const planByLine = new Map(diff.rows.map((entry) => [entry.line, entry.plan]));

    let imported = 0;
    let updated = 0;
    let unchanged = 0;
    let reinstated = 0;
    for (const row of rows) {
      const personId = personByPhone.get(row.phone);
      if (personId === undefined) {
        continue;
      }
      const plan = planByLine.get(row.line);
      const record = stored.get(row.phone);

      // Already here, and the file agrees with every column it carries.
      if (plan?.kind === "unchanged") {
        unchanged++;
        continue;
      }

      // Already here, and the file changes something. Status is untouched —
      // an approved player stays approved through a re-import (rule 3).
      if (plan?.kind === "changed" && record !== undefined) {
        const changedTeam = teamIdFor(row);
        const values = changedValues(plan.changes, row, changedTeam);
        if (Object.keys(values).length > 0) {
          if (values["isCaptain"] === true && changedTeam !== null) {
            await demoteOthers(changedTeam, record.id);
          }
          await tx.update(registrations).set(values).where(eq(registrations.id, record.id));
        }
        updated++;
        await tx.insert(auditLog).values({
          id: newId(),
          actor: actorId,
          action: "registration.updated",
          scopeType: "org",
          scopeId: orgId,
          subject: record.id,
          // The field-level delta, so "who changed this player's phone" has an
          // answer that does not require reading a spreadsheet's history.
          meta: {
            source: "csv_import",
            changed: plan.changes.map((c) => c.field).join(","),
            ...Object.fromEntries(
              plan.changes.map((c) => [c.field, `${c.from ?? "(blank)"} -> ${c.to}`]),
            ),
          },
        });
        continue;
      }

      const id = newId();
      /*
       * BEFORE the insert, not after.
       *
       * `registrations_team_captain_uq` is a real index, so a row arriving as
       * this team's captain COLLIDES with the incumbent at insert time — the
       * whole batch aborts, and an organizer importing a corrected roster is
       * told nothing more useful than "duplicate key". Demoting first is what
       * makes the armband change hands instead, which is what a file naming a
       * new captain means. The id is minted above precisely so it can be
       * excluded here, before the row it names exists.
       */
      const landingTeam = teamIdFor(row);
      if (row.isCaptain === true && landingTeam !== null) {
        await demoteOthers(landingTeam, id);
      }
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
          // Desk + kit (0034). Spread only when the file carried them, so an
          // import that maps none of these leaves the column defaults alone
          // rather than writing nulls over a value entered by hand.
          ...deskFields(row),
          // The squad the file already knew. Spread only when it said so, so a
          // sheet with no icon column changes no marks.
          ...(row.teamName !== null ? { teamId: teamIdFor(row) } : {}),
          ...squadMarks(row),
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
        continue;
      }
      /*
       * A WITHDRAWAL IS NOT A LIFE SENTENCE HERE EITHER.
       *
       * The conflict target is TOTAL — it includes withdrawn rows — so a player
       * who withdrew and then appeared on the organizer's final sheet was
       * counted as an already-registered "duplicate" and left withdrawn, while
       * the self-service and add-by-hand paths both reinstated them. Same rule,
       * same helper, same single exit from `withdrawn` that core allows.
       */
      const restored = await reinstateWithdrawn(tx, competitionId, personId, {
        role: row.role,
        basePriceBand: row.basePriceBand,
        profile: {
          ...(row.dateOfBirth !== null ? { dateOfBirth: row.dateOfBirth } : {}),
          ...(row.battingStyle !== null ? { battingStyle: row.battingStyle } : {}),
          ...(row.bowlingStyle !== null ? { bowlingStyle: row.bowlingStyle } : {}),
        },
      });
      if (restored === null) {
        // Live registration the plan did not mark changed — nothing to do.
        unchanged++;
        continue;
      }
      reinstated++;
      await tx.insert(auditLog).values({
        id: newId(),
        actor: actorId,
        action: "registration.imported",
        scopeType: "org",
        scopeId: orgId,
        subject: restored.id,
        // The timeline must read apply → withdraw → rejoin, not a second
        // application appearing from nowhere (the DA-27 reason, on this path).
        meta: { source: "csv_import", reinstated: "true" },
      });
    }

    await tx.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "registration.imported",
      scopeType: "org",
      scopeId: orgId,
      subject: competitionId,
      meta: {
        imported: String(imported),
        updated: String(updated),
        unchanged: String(unchanged),
        reinstated: String(reinstated),
        named: String(named),
      },
    });
    return { imported, updated, unchanged, reinstated, named };
  });
}
