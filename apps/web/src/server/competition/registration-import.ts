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

import { captainLockRefusal } from "./captain-lock";
import { reinstateWithdrawn } from "./registrations";
import type { CaptainRefusal } from "./roster-lock";

/** New people per INSERT statement — well inside Postgres's 65,535 bind limit. */
const PEOPLE_INSERT_CHUNK = 500;

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
  /**
   * Existing nameless accounts the file named — for THIS SEASON only, as the
   * entry's `enteredName`. The account itself is never named from a file.
   */
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
): Promise<Map<string, ExistingRegistration & { id: string; teamId: string | null }>> {
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
      photoDriveId: registrations.photoDriveId,
      // The diff compares NAMES on both sides, so the stored side joins the
      // team in rather than making a pure module resolve a ULID.
      teamName: teams.name,
      // The id beside the name: the armband's demote is scoped to the team the
      // player is ON, which a file with no team column never names.
      teamId: registrations.teamId,
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
  if (row.photoDriveId !== null) {
    out["photoDriveId"] = row.photoDriveId;
  }
  return out;
}

/**
 * A role or base-price band the file changes once the auction has opened; the
 * file is not imported (audit F-D4).
 *
 * The single-row edit has refused these since the roster lock existed
 * (`planRegistrationEdit`, `rosterLocked`): a band IS a lot's base price and a
 * role is how the room and the owners' plans read a player, both already
 * priced against. A re-imported sheet was the way round it. Refused rather
 * than silently stripped, because the preview listed the change and an import
 * that quietly did less than it showed would make the preview a lie.
 */
export class RosterFieldImportRefused extends Error {
  constructor(readonly player: string) {
    super("roster field import refused");
  }
}

/** A captain change in the file that the opened auction refuses; the file is not imported. */
export class CaptainImportRefused extends Error {
  constructor(readonly refusal: CaptainRefusal) {
    super(`captain import refused: ${refusal.kind}`);
  }
}

export async function commitRegistrationImport(
  db: Db,
  competitionId: string,
  orgId: string,
  actorId: string,
  rows: readonly CsvRegistrationRow[],
  /** Default is the safe one: add what is missing, never revert a hand edit. */
  policy: ImportPolicy = "fill-blanks",
  /**
   * The season's auction, once it has left `scheduled`. A captain the file
   * changes is then held to the dashboard's rule (`captainChangeRefusal`), and
   * the first refusal aborts the whole file with `CaptainImportRefused`; a
   * changed role or band aborts it with `RosterFieldImportRefused`.
   */
  lockedAuctionId: string | null = null,
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
    // Phones that already had an account (0075): the season shows the name
    // this FILE gives, never the account's — see shown-name.ts. Named or not.
    const existingAccounts = new Set(existing.filter((p) => p.phone !== null).map((p) => p.phone));
    // The nameless ones among them: an entry that names one is counted as
    // `named`, which is the only naming a club's file can do.
    const namelessAccounts = new Set(
      existing.filter((p) => p.name === null && p.phone !== null).map((p) => p.phone),
    );

    // The first name the file gives each phone — the same row `find` returned,
    // without scanning the file once per phone.
    const nameByPhone = new Map<string, string>();
    for (const row of rows) {
      if (!nameByPhone.has(row.phone)) {
        nameByPhone.set(row.phone, row.name);
      }
    }

    /*
     * NEW PEOPLE IN ONE STATEMENT PER CHUNK, NOT ONE PER PERSON (S-4).
     *
     * A first import of a 300-player sheet used to be 300 sequential INSERTs
     * inside the transaction. It is now one multi-row insert per 500. ON
     * CONFLICT DO NOTHING plus a re-read also closes a race the loop had: a
     * person created by a concurrent sign-in between the lookup above and the
     * insert used to abort the whole import on the unique phone; now that
     * person is simply found and used.
     */
    const fresh = phones
      .filter((phone) => !personByPhone.has(phone))
      .map((phone) => ({ id: newId(), phone, name: nameByPhone.get(phone) ?? null }));
    for (let at = 0; at < fresh.length; at += PEOPLE_INSERT_CHUNK) {
      const chunk = fresh.slice(at, at + PEOPLE_INSERT_CHUNK);
      const created = await tx
        .insert(people)
        .values(chunk)
        .onConflictDoNothing()
        .returning({ id: people.id, phone: people.phone });
      for (const person of created) {
        if (person.phone !== null) {
          personByPhone.set(person.phone, person.id);
        }
      }
    }
    const raced = fresh.map((person) => person.phone).filter((phone) => !personByPhone.has(phone));
    if (raced.length > 0) {
      const late = await tx
        .select({ id: people.id, phone: people.phone })
        .from(people)
        .where(inArray(people.phone, raced));
      for (const person of late) {
        if (person.phone !== null) {
          personByPhone.set(person.phone, person.id);
        }
      }
    }

    /*
     * A FILE NAMES AN ENTRY, NEVER AN ACCOUNT (go-live gate, media P2).
     *
     * This used to write the file's name onto a nameless `people` row, on the
     * reasoning that every screen otherwise showed "Unnamed" for a player whose
     * name was sitting in the column just read. But `people.name` is platform-
     * wide: the stub may be another club's import or a real person who has not
     * finished onboarding, and whatever this club's spreadsheet called them
     * became what every other club — and the person — read. The name goes on
     * this season's registration instead (`enteredName`, 0075), which is what
     * the season's screens show (shown-name.ts). `addPlayerByPhone` does the
     * same.
     */
    let named = 0;

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
          if (lockedAuctionId !== null && ("role" in values || "basePriceBand" in values)) {
            throw new RosterFieldImportRefused(row.name || row.phone);
          }
          if (lockedAuctionId !== null && typeof values["isCaptain"] === "boolean") {
            const refusal = await captainLockRefusal(
              tx,
              lockedAuctionId,
              record.id,
              values["isCaptain"],
            );
            if (refusal !== null) {
              throw new CaptainImportRefused(refusal);
            }
          }
          /*
           * The EFFECTIVE captaincy on the EFFECTIVE team, as `setRegistrationMarks`
           * reads it — not the file's columns alone. A captain-only file for a
           * player already on a team carries no team column, so the demote used
           * to be skipped and the armband collided on the unique index; a file
           * that only MOVES a sitting captain collides the same way.
           */
          const landingTeam =
            "teamId" in values ? (values["teamId"] as string | null) : record.teamId;
          const landsAsCaptain =
            typeof values["isCaptain"] === "boolean" ? values["isCaptain"] : record.isCaptain;
          if (
            landsAsCaptain &&
            landingTeam !== null &&
            ("isCaptain" in values || "teamId" in values)
          ) {
            await demoteOthers(landingTeam, record.id);
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
          ...(existingAccounts.has(row.phone) && row.name !== "" ? { enteredName: row.name } : {}),
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
        // A new registration is on no squad the auction knows of, so it cannot
        // arrive as a captain once the auction has opened — the answer the
        // dashboard gives any player who is not on a squad. Thrown after the
        // insert so a withdrawn row the conflict skipped is not refused for a
        // mark the reinstatement below never writes.
        if (lockedAuctionId !== null && row.isCaptain === true) {
          throw new CaptainImportRefused({ kind: "not_in_squad", name: row.name || row.phone });
        }
        imported++;
        if (namelessAccounts.has(row.phone) && row.name !== "") {
          named++;
        }
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
      // The rejoin of a nameless account takes the file's name too — for this
      // season, and only where the entry has none of its own yet.
      if (namelessAccounts.has(row.phone) && row.name !== "") {
        const entry = await tx
          .update(registrations)
          .set({ enteredName: row.name })
          .where(and(eq(registrations.id, restored.id), isNull(registrations.enteredName)))
          .returning({ id: registrations.id });
        named += entry.length;
      }
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
