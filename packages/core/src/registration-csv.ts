/**
 * Deterministic registration CSV import parsing + validation (M-IP3-2). Pure —
 * no storage, no IO. The import path VALIDATES the whole file before any write
 * and REJECTS on any error (no partial corruption): a caller commits only when
 * `errors` is empty. RFC-4180-ish: quoted fields, doubled quotes, CRLF/LF, and
 * embedded newlines inside quotes are all handled.
 */

import { type RegistrationRole } from "./competition";
import { parseCsvDate, type DateOrder } from "./csv-date";
import { normalizePhone } from "./phone";
import { parseFeeStatus, parseRupeesToPaise, type FeeStatus } from "./money";
import { deriveAge, parseBattingStyle, parseBowlingStyle, parseRole } from "./player-profile";

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
  /**
   * Registration-desk fields (0034). All optional: a club collecting none of
   * this maps none of it and every one of these stays null.
   */
  feeStatus: FeeStatus | null;
  /** Integer paise (C-7). Null = no amount recorded, which is not zero. */
  feeAmountPaise: number | null;
  feeReference: string | null;
  note: string | null;
  fatherName: string | null;
  jerseyName: string | null;
  jerseyNumber: string | null;
  tshirtSize: string | null;
  trouserSize: string | null;
  /**
   * THE SQUAD A FILE ALREADY KNOWS.
   *
   * A club's roster spreadsheet says which team a player belongs to and which
   * of them were kept from last season — and none of it could be imported, so
   * an organizer re-entered every affiliation by hand on the dashboard, one
   * player at a time, restating facts the file in front of them contained.
   *
   * The NAME, not an id: a spreadsheet has never heard of a ULID. The commit
   * resolves it against the season's teams, and the parser refuses a name that
   * matches none of them when it is told what they are.
   */
  teamName: string | null;
  /**
   * The pre-signed and armband marks. NULL MEANS THE FILE DID NOT SAY, which is
   * different from false: a club whose sheet has no icon column must not have
   * every player's existing Icon mark cleared by importing a corrected roster.
   */
  isIcon: boolean | null;
  isCaptain: boolean | null;
  isRetained: boolean | null;
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
  const rawRole = input.role.trim();
  const band = (input.basePriceBand ?? "").trim();

  const errors: PlayerFieldError[] = [];
  if (name.length < 3) {
    errors.push({ field: "name", message: "name must be at least 3 characters" });
  }
  const phone = normalizePhone(rawPhone);
  if (!phone.ok) {
    errors.push({ field: "phone", message: `invalid phone "${rawPhone}"` });
  }
  // Read the way a registration form is filled in ("All Rounder", "Batsman"),
  // not as a bare enum match — the same contract the styles got, and for the
  // same reason: this is the ONE validation truth, so the dialog and the file
  // now accept and refuse exactly the same vocabulary. See `parseRole`.
  const role = parseRole(rawRole);
  if (role === null) {
    errors.push({ field: "role", message: `invalid role "${rawRole}"` });
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
      // Canonical from here on: the caller stores what the machine understands,
      // never the spelling the file happened to use.
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
 * How to read the file's own conventions.
 *
 * `now` is injected rather than read from the clock (house rule 2.1) AND is
 * required for the future-date check to happen at all — a birthday in 2030
 * parses as a perfectly real calendar date, and only a clock can say it is not
 * a birthday. Callers on the web path pass `new Date()`; the tests pass a fixed
 * instant so the suite does not change its mind next year.
 */
const TRUE_WORDS = new Set(["yes", "y", "true", "t", "1", "\u2713", "\u2714", "x"]);
const FALSE_WORDS = new Set(["no", "n", "false", "f", "0", "-", "\u2014"]);

/**
 * How a spreadsheet writes a yes.
 *
 * "Yes", "Y", "TRUE", "1", and a tick — a club marking a column of retentions
 * ticks the cells, and a tick is what survives the export. `x` is a yes here
 * for the same reason: a sheet where the icons are the marked rows marks them
 * with an x, and nobody who typed it meant "no".
 *
 * Null for a value that is neither, so the row can be REFUSED by name rather
 * than quietly treated as false — the same contract the batting style and the
 * fee amount were given. A misread "maybe" in this column silently drops a
 * player out of the auction, which is the most expensive kind of quiet.
 */
export function parseCsvFlag(value: string): boolean | null {
  const key = value.trim().toLowerCase();
  if (TRUE_WORDS.has(key)) {
    return true;
  }
  return FALSE_WORDS.has(key) ? false : null;
}

/** Comparable form of a team name: case, spacing and punctuation are noise. */
export function normalizeTeamName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface CsvParseOptions {
  /** Which number leads an ambiguous numeric date. Default day-first (India). */
  dateOrder?: DateOrder;
  /** Reference instant for the future-date check. Omit to skip that check. */
  now?: Date;
  /**
   * The season's team names. Omit to skip the check — the same shape
   * `knownBands` has, and for the same reason: a caller that does not know the
   * teams (a preview of a file before a season exists) must still be able to
   * parse. A caller that DOES know them gets a typo refused by line instead of
   * a player silently landing on no team.
   */
  knownTeams?: readonly string[];
}

/**
 * DA-14: an unknown band used to pass validation and fall back to the default
 * price, so a typo silently repriced a marquee player. Bands are declared by
 * the auction config; callers that know them pass them in, and every other
 * column already errors per line — this one now does too.
 */
export function parseRegistrationCsv(
  text: string,
  knownBands?: readonly string[],
  options?: CsvParseOptions,
): CsvParseResult {
  return parseRegistrationRecords(tokenizeCsv(text), knownBands, options);
}

/**
 * The parser, entered from already-tokenized records.
 *
 * Exists so COLUMN MAPPING has somewhere to hand its work. `import-mapping.ts`
 * rewrites a foreign header row (a Google Form's "Which role do you play?")
 * into this module's canonical one and returns records — not text — and those
 * records land here, in the same validation the hand-written file goes through.
 * One parser, one set of rules, whether the columns were named by us or
 * translated on the way in.
 */
export function parseRegistrationRecords(
  input: readonly (readonly string[])[],
  knownBands?: readonly string[],
  options?: CsvParseOptions,
): CsvParseResult {
  const dateOrder = options?.dateOrder ?? "dmy";
  const now = options?.now;
  const records = input.filter((fields) => !(fields.length === 1 && fields[0]?.trim() === ""));
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
  /** Which line already claimed the armband for a team, by normalized name. */
  const captainByTeam = new Map<string, number>();
  const knownTeams =
    options?.knownTeams === undefined
      ? undefined
      : new Set(options.knownTeams.map(normalizeTeamName));

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
    /*
     * AND THE THIRD ONE.
     *
     * The two columns above were fixed to refuse what they could not place;
     * date of birth was left exactly as it had been — read raw, stored raw. The
     * store is ISO text and `deriveAge` refuses anything else, so a `dd/mm/yyyy`
     * birthday (which is what a form in this market produces) was written
     * without complaint and then read as a blank age forever after. It now
     * parses like a date and errors like a column.
     */
    const parsedDob = dateOfBirth === "" ? null : parseCsvDate(dateOfBirth, dateOrder);

    /*
     * The desk columns, held to the same contract as everything above: parsed
     * the way a person writes them, and REFUSED by name when they cannot be
     * placed. A fee that silently failed to parse would leave a player looking
     * unpaid to a desk that had already taken their money.
     */
    const feeStatusRaw = optional("fee_status");
    const parsedFeeStatus = feeStatusRaw === "" ? null : parseFeeStatus(feeStatusRaw);
    const feeAmountRaw = optional("fee_amount");
    const parsedFee = feeAmountRaw === "" ? null : parseRupeesToPaise(feeAmountRaw);

    /*
     * The squad columns. Each is read only when the file HAS the column, and a
     * blank cell in a column that exists still means "did not say" — a sheet
     * that lists four retentions leaves the other fifty-six cells empty, and
     * reading those as `false` would clear marks the organizer set by hand.
     */
    const teamRaw = optional("team");
    const flag = (column: string): { raw: string; value: boolean | null } => {
      const raw = optional(column);
      return { raw, value: raw === "" ? null : parseCsvFlag(raw) };
    };
    const iconFlag = flag("is_icon");
    const captainFlag = flag("is_captain");
    const retainedFlag = flag("is_retained");
    const capped = (column: string, limit: number): string | null => {
      const value = optional(column).slice(0, limit);
      return value === "" ? null : value;
    };

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
    if (dateOfBirth !== "" && parsedDob === null) {
      rowErrors.push(`unreadable date of birth "${dateOfBirth}" (use dd/mm/yyyy or yyyy-mm-dd)`);
    }
    if (parsedDob !== null && now !== undefined && deriveAge(parsedDob, now) === null) {
      rowErrors.push(`date of birth "${dateOfBirth}" is in the future`);
    }
    if (feeStatusRaw !== "" && parsedFeeStatus === null) {
      rowErrors.push(`unknown fee status "${feeStatusRaw}" (paid, pending, waived or refunded)`);
    }
    if (parsedFee !== null && !parsedFee.ok) {
      rowErrors.push(`unreadable fee amount "${feeAmountRaw}"`);
    }
    for (const [column, read] of [
      ["is_icon", iconFlag],
      ["is_captain", captainFlag],
      ["is_retained", retainedFlag],
    ] as const) {
      if (read.raw !== "" && read.value === null) {
        rowErrors.push(`unreadable ${column} "${read.raw}" (yes or no)`);
      }
    }
    /*
     * The invariant the dashboard refuses one row at a time, refused here in
     * bulk. An Icon is pre-signed and never goes under the hammer; a Captain
     * leads a squad that plays. A file asserting both about one person has not
     * expressed a preference the import could honour — it has a mistake in it.
     */
    if (iconFlag.value === true && captainFlag.value === true) {
      rowErrors.push("a player cannot be both an Icon and a Captain");
    }
    if (teamRaw !== "" && knownTeams !== undefined && !knownTeams.has(normalizeTeamName(teamRaw))) {
      rowErrors.push(`unknown team "${teamRaw}"`);
    }
    /*
     * TWO CAPTAINS, ONE TEAM — caught in the file rather than by the database.
     *
     * `registrations_team_captain_uq` makes two unrepresentable, and the
     * single-row writer resolves a collision by DEMOTING the incumbent, because
     * an organizer naming a new captain means "this player instead". A file
     * naming two captains for one team means no such thing: there is no "instead"
     * when both arrive at once, and letting row order decide would hand the
     * armband to whoever the spreadsheet happened to sort first.
     */
    if (captainFlag.value === true && teamRaw !== "") {
      const key = normalizeTeamName(teamRaw);
      const prior = captainByTeam.get(key);
      if (prior !== undefined) {
        rowErrors.push(`a second captain for "${teamRaw}" (also line ${String(prior)})`);
      } else {
        captainByTeam.set(key, line);
      }
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
      // Canonical, not as written: `check.ok` means the row passed, so its
      // parsed role is the one that reaches the database.
      role: check.ok ? check.value.role : (rawRole as RegistrationRole),
      basePriceBand: band === "" ? null : band,
      dateOfBirth: parsedDob,
      // Canonical from here on, so the commit has nothing left to reject.
      battingStyle: parsedBatting,
      bowlingStyle: parsedBowling,
      feeStatus: parsedFeeStatus,
      feeAmountPaise: parsedFee !== null && parsedFee.ok ? parsedFee.value : null,
      feeReference: capped("fee_reference", 200),
      note: capped("note", 2000),
      fatherName: capped("father_name", 120),
      jerseyName: capped("jersey_name", 60),
      jerseyNumber: capped("jersey_number", 10),
      tshirtSize: capped("tshirt_size", 20),
      trouserSize: capped("trouser_size", 20),
      teamName: teamRaw === "" ? null : teamRaw,
      isIcon: iconFlag.value,
      isCaptain: captainFlag.value,
      isRetained: retainedFlag.value,
    });
  }

  return { rows, errors };
}
