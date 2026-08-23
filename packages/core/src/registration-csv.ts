/**
 * Deterministic registration CSV import parsing + validation (M-IP3-2). Pure —
 * no storage, no IO. The import path VALIDATES the whole file before any write
 * and REJECTS on any error (no partial corruption): a caller commits only when
 * `errors` is empty. RFC-4180-ish: quoted fields, doubled quotes, CRLF/LF, and
 * embedded newlines inside quotes are all handled.
 */

import { isRegistrationRole, type RegistrationRole } from "./competition";
import { normalizePhone } from "./phone";
import { parseBattingStyle, parseBowlingStyle } from "./player-profile";

export interface CsvRegistrationRow {
  line: number; // 1-based source line (header = line 1)
  name: string;
  phone: string; // normalized E.164
  role: RegistrationRole;
  basePriceBand: string | null;
  /**
   * DA-28: the optional profile a player supplies when they self-register.
   * Without these an imported player stayed permanently thinner than one who
   * signed up, with no organiser surface to fill the gap.
   */
  dateOfBirth: string | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
}

export interface CsvRowError {
  line: number;
  message: string;
}

export interface CsvParseResult {
  rows: CsvRegistrationRow[];
  errors: CsvRowError[];
}

const REQUIRED_HEADER = ["name", "phone", "role"] as const;

/** The four fields every player needs, however they arrive (CSV row or form). */
export interface NewPlayerInput {
  name: string;
  phone: string;
  role: string;
  basePriceBand?: string | null;
}

export type PlayerField = "name" | "phone" | "role" | "basePriceBand";

export interface PlayerFieldError {
  field: PlayerField;
  message: string;
}

export type NewPlayerCheck =
  | {
      ok: true;
      value: { name: string; phone: string; role: RegistrationRole; basePriceBand: string | null };
    }
  | { ok: false; errors: PlayerFieldError[] };

/**
 * The one validation truth for "a player joins this competition" — used per line
 * by the CSV parser AND by the organizer's manual add form, so a name/phone/role
 * that a file would reject cannot slip in through the dialog (or vice versa).
 * Field-keyed so a form can render each message under its own input; the CSV
 * path joins them into its one-line-per-row message.
 */
export function validateNewPlayer(
  input: NewPlayerInput,
  knownBands?: readonly string[],
): NewPlayerCheck {
  const name = input.name.trim();
  const rawPhone = input.phone.trim();
  const role = input.role.trim().toLowerCase();
  const band = (input.basePriceBand ?? "").trim();

  const errors: PlayerFieldError[] = [];
  if (name.length < 3) {
    errors.push({ field: "name", message: "name must be at least 3 characters" });
  }
  const phone = normalizePhone(rawPhone);
  if (!phone.ok) {
    errors.push({ field: "phone", message: `invalid phone "${rawPhone}"` });
  }
  if (!isRegistrationRole(role)) {
    errors.push({ field: "role", message: `invalid role "${role}"` });
  }
  if (
    band !== "" &&
    knownBands !== undefined &&
    !knownBands.some((known) => known.toUpperCase() === band.toUpperCase())
  ) {
    errors.push({
      field: "basePriceBand",
      message: `unknown base price band "${band}" (expected ${knownBands.join(", ")})`,
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      name,
      phone: phone.ok ? phone.phone : rawPhone,
      role: role as RegistrationRole,
      basePriceBand: band === "" ? null : band,
    },
  };
}

/** Tokenize CSV text into records of fields. Deterministic; no locale. */
export function tokenizeCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let sawAny = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    sawAny = true;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\r") {
      // swallow; the \n that follows ends the record
    } else if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return sawAny ? records : [];
}

/**
 * DA-14: an unknown band used to pass validation and fall back to the default
 * price, so a typo silently repriced a marquee player. Bands are declared by
 * the auction config; callers that know them pass them in, and every other
 * column already errors per line — this one now does too.
 */
export function parseRegistrationCsv(text: string, knownBands?: readonly string[]): CsvParseResult {
  const records = tokenizeCsv(text).filter(
    (fields) => !(fields.length === 1 && fields[0]?.trim() === ""),
  );
  if (records.length === 0) {
    return { rows: [], errors: [{ line: 1, message: "The file is empty." }] };
  }

  const header = (records[0] ?? []).map((h) => h.trim().toLowerCase());
  const index: Record<string, number> = {};
  header.forEach((h, i) => {
    index[h] = i;
  });
  const missing = REQUIRED_HEADER.filter((h) => index[h] === undefined);
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `Missing required column(s): ${missing.join(", ")}.` }],
    };
  }

  const rows: CsvRegistrationRow[] = [];
  const errors: CsvRowError[] = [];
  const seenPhones = new Map<string, number>();

  for (let r = 1; r < records.length; r++) {
    const line = r + 1; // 1-based, header is line 1
    const fields = records[r] ?? [];
    const rawName = (fields[index["name"] ?? -1] ?? "").trim();
    const rawPhone = (fields[index["phone"] ?? -1] ?? "").trim();
    const rawRole = (fields[index["role"] ?? -1] ?? "").trim().toLowerCase();
    const band =
      index["base_price_band"] !== undefined ? (fields[index["base_price_band"]] ?? "").trim() : "";
    const optional = (column: string): string =>
      index[column] !== undefined ? (fields[index[column]] ?? "").trim() : "";
    const dateOfBirth = optional("date_of_birth");
    const battingStyle = optional("batting_style");
    const bowlingStyle = optional("bowling_style");

    /*
     * THE TWO COLUMNS NOBODY CHECKED.
     *
     * Every other column errors per line; these two were passed through raw,
     * and `commitRegistrationImport` then dropped anything it did not
     * recognise — `isBattingStyle(...) ? {...} : {}`. Since the stored values
     * are snake_case tokens and every screen shows the LABEL, an organizer
     * typing what they can see lost the column entirely and was told the file
     * was clean. RH-1: 73 rows in, 73 styles carried, 0 stored, 0 errors shown.
     *
     * Now they are parsed the way a person writes them and REFUSED when they
     * cannot be placed — the same contract the band got in DA-14.
     */
    const parsedBatting = battingStyle === "" ? null : parseBattingStyle(battingStyle);
    const parsedBowling = bowlingStyle === "" ? null : parseBowlingStyle(bowlingStyle);

    const check = validateNewPlayer(
      { name: rawName, phone: rawPhone, role: rawRole, basePriceBand: band },
      knownBands,
    );
    const rowErrors = check.ok ? [] : check.errors.map((error) => error.message);
    if (battingStyle !== "" && parsedBatting === null) {
      rowErrors.push(`unknown batting style "${battingStyle}"`);
    }
    if (bowlingStyle !== "" && parsedBowling === null) {
      rowErrors.push(`unknown bowling style "${bowlingStyle}"`);
    }
    // The in-file duplicate check is the parser's alone (a form has no "file"),
    // and it needs the normalized phone even when another field failed — so a
    // repeat is still reported against the line that repeats it.
    const phone = normalizePhone(rawPhone);
    if (phone.ok) {
      const prior = seenPhones.get(phone.phone);
      if (prior !== undefined) {
        rowErrors.push(`duplicate phone in file (also line ${String(prior)})`);
      } else {
        seenPhones.set(phone.phone, line);
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ line, message: rowErrors.join("; ") });
      continue;
    }
    rows.push({
      line,
      name: rawName,
      phone: phone.ok ? phone.phone : rawPhone,
      role: rawRole as RegistrationRole,
      basePriceBand: band === "" ? null : band,
      dateOfBirth: dateOfBirth === "" ? null : dateOfBirth,
      // Canonical from here on, so the commit has nothing left to reject.
      battingStyle: parsedBatting,
      bowlingStyle: parsedBowling,
    });
  }

  return { rows, errors };
}
