/**
 * Deterministic registration CSV import parsing + validation (M-IP3-2). Pure —
 * no storage, no IO. The import path VALIDATES the whole file before any write
 * and REJECTS on any error (no partial corruption): a caller commits only when
 * `errors` is empty. RFC-4180-ish: quoted fields, doubled quotes, CRLF/LF, and
 * embedded newlines inside quotes are all handled.
 */

import { DEFAULT_SPORT, parseRoleIn, type SportPack } from "./sports";
import { parseCsvDate, type DateOrder } from "./csv-date";
import { normalizePhone } from "./phone";
import { parseFeeStatus, parseRupeesToPaise, type FeeStatus } from "./money";
import { deriveAge, parseBattingStyle, parseBowlingStyle } from "./player-profile";

export interface CsvRegistrationRow {
  line: number; // 1-based source line (header = line 1)
  name: string;
  phone: string; // normalized E.164
  /** The PACK's role key. Not `RegistrationRole` — that is cricket's four. */
  role: string;
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
   * The Google Drive file id behind a Form's photo upload, when the file had a
   * photo column. Not a photo — a pointer the photo step fetches by, so each
   * picture lands on the player whose row linked it.
   */
  photoDriveId: string | null;
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
  /**
   * The row's player name as written, when it has one. "Line 51" means nothing
   * to an organizer looking at a list of people; the name is how they find the
   * row in their own sheet, or fix it in place.
   */
  name?: string;
  /**
   * The canonical columns that failed (`phone`, `role`, `bowling_style`, …), so
   * the import screen can offer an edit box for exactly those cells rather
   * than asking the organizer to re-download the sheet.
   */
  fields?: string[];
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
      /**
       * `role` is the PACK's key, not cricket's enum. It used to be typed
       * `RegistrationRole` — an alias for `CricketRole` — which is why every
       * football roster this product accepted was rejected at the door: the
       * database column was opened to any sport in migration 0047 and the type
       * in front of it was not.
       */
      value: { name: string; phone: string; role: string; basePriceBand: string | null };
    }
  | { ok: false; errors: PlayerFieldError[] };

/**
 * The one validation truth for "a player joins this competition" — used per line
 * by the CSV parser AND by the organizer's manual add form, so a name/phone/role
 * that a file would reject cannot slip in through the dialog (or vice versa).
 * Field-keyed so a form can render each message under its own input; the CSV
 * path joins them into its one-line-per-row message.
 *
 * THE PACK DECIDES WHAT A ROLE IS. This called `parseRole`, which asks CRICKET
 * and nothing else — so "midfielder" was an invalid role in a football season,
 * on every route a player can arrive by. The default is the default sport
 * rather than a throw because most callers are cricket fixtures and a required
 * argument on 58 call sites buys nothing; the production paths pass the
 * season's own pack, and `sport-import.test.ts` holds them to it.
 */
export function validateNewPlayer(
  input: NewPlayerInput,
  knownBands?: readonly string[],
  pack: SportPack = DEFAULT_SPORT,
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
    // "9.87654E+09" is a number Excel reformatted on open-and-save; the digits
    // are gone, so the only useful answer is where to get an untouched file.
    const mangled = /^\d(\.\d+)?e\+?\d+$/i.test(rawPhone);
    errors.push({
      field: "phone",
      message: mangled
        ? `invalid phone "${rawPhone}" — a spreadsheet turned it into a number; download the CSV again from Google Sheets instead of re-saving it in Excel`
        : `invalid phone "${rawPhone}"`,
    });
  }
  // Read the way a registration form is filled in ("All Rounder", "Batsman"),
  // not as a bare enum match — the same contract the styles got, and for the
  // same reason: this is the ONE validation truth, so the dialog and the file
  // now accept and refuse exactly the same vocabulary. See `parseRole`.
  // Empty and wrong are different answers — see `evaluateRegistration`.
  const role = parseRoleIn(pack, rawRole);
  if (rawRole === "" ? pack.roles.required : role === null) {
    errors.push({
      field: "role",
      message: `invalid ${pack.label.toLowerCase()} role "${rawRole}"`,
    });
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
      // never the spelling the file happened to use. A sport whose pack does
      // not require roles keeps the empty string rather than inventing one.
      role: role ?? "",
      basePriceBand: band === "" ? null : band,
    },
  };
}

/**
 * Records back to CSV text, for an IMPORT the organizer is editing — not an
 * export. Deliberately not `toCsv`: that one neutralizes formulas by prefixing
 * a quote, which is right for a file opened in Excel and wrong here, where
 * "+91 98765 43210" must come back as a phone rather than "'+91 98765 43210".
 */
export function recordsToCsv(records: readonly (readonly string[])[]): string {
  return records
    .map((record) =>
      record
        .map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(","),
    )
    .join("\n");
}

/**
 * Change cells of one row, addressed the way the parser reports it.
 *
 * `line` is the parser's line — 1-based, header is 1, counted AFTER blank
 * lines are dropped — so the same filter is applied here, or a sheet with a
 * blank row would have its fix land on the neighbour. `edits` maps a SOURCE
 * column index to its new value. Returns null when the line does not exist.
 */
export function editCsvRow(
  text: string,
  line: number,
  edits: ReadonlyMap<number, string>,
): string | null {
  const records = tokenizeCsv(text).filter(
    (fields) => !(fields.length === 1 && fields[0]?.trim() === ""),
  );
  const record = records[line - 1];
  if (line < 2 || record === undefined) {
    return null;
  }
  const next = [...record];
  for (const [column, value] of edits) {
    while (next.length <= column) {
      next.push("");
    }
    next[column] = value;
  }
  records[line - 1] = next;
  return recordsToCsv(records);
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

/*
 * A form's way of saying "this does not apply to me".
 *
 * A Google Form that asks every player for a bowling style offers "None" or
 * "I don't bowl" to the batters, and those came back as unknown styles — and
 * the value mapper can only offer real styles, so the organizer had no answer
 * that would let a pure batter's row in. Read as blank instead: "did not say",
 * which never erases a style already on file.
 */
const NOT_APPLICABLE = new Set([
  "none",
  "na",
  "n a",
  "nil",
  "not applicable",
  "no",
  "-",
  "dont bowl",
  "do not bowl",
  "i dont bowl",
  "i do not bowl",
  "not a bowler",
  "doesnt bowl",
  "does not bowl",
  "dont bat",
  "do not bat",
]);

/** True for a cell that answers a style question with "not me". */
export function isNotApplicable(value: string): boolean {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018`]/g, "")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .trim();
  return NOT_APPLICABLE.has(key);
}

/**
 * The Drive file id in a Google Form's upload link, or null.
 *
 * A Form writes "https://drive.google.com/open?id=ID" (sometimes with
 * "/u/0/" and a usp parameter), and several links comma-separated when the
 * question allowed more than one file — the first is the photo. A share link
 * ("/file/d/ID/view") is accepted too. Anything else is not an error: a photo
 * column is optional, and text in it is simply not a link we can fetch.
 */
export function driveFileIdOf(value: string): string | null {
  const first = value.split(",")[0]?.trim() ?? "";
  if (!/^https?:\/\/(drive|docs)\.google\.com\//i.test(first)) {
    return null;
  }
  const match = /[?&]id=([\w-]{10,})/.exec(first) ?? /\/d\/([\w-]{10,})/.exec(first);
  return match?.[1] ?? null;
}

/** Two spellings of one person's name: case and spacing are noise. */
function sameName(a: string, b: string): boolean {
  const key = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return key(a) === key(b);
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
  /**
   * The season's sport. Omit for the default sport — see `validateNewPlayer`.
   *
   * Without this the parser judged every role against CRICKET, so a football
   * club's roster imported ZERO rows: "invalid role" on midfielder, on
   * goalkeeper, on every line, while the football pack recognised all of them.
   */
  pack?: SportPack;
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
  const pack = options?.pack ?? DEFAULT_SPORT;
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
  const seenPhones = new Map<string, { line: number; name: string }>();
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
    const styleOf = (column: string): string => {
      const raw = optional(column);
      return isNotApplicable(raw) ? "" : raw;
    };
    const battingStyle = styleOf("batting_style");
    const bowlingStyle = styleOf("bowling_style");

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
      pack,
    );
    const rowErrors = check.ok ? [] : check.errors.map((error) => error.message);
    const failed = new Set<string>(
      check.ok
        ? []
        : check.errors.map((error) =>
            error.field === "basePriceBand" ? "base_price_band" : error.field,
          ),
    );
    if (battingStyle !== "" && parsedBatting === null) {
      rowErrors.push(`unknown batting style "${battingStyle}"`);
      failed.add("batting_style");
    }
    if (bowlingStyle !== "" && parsedBowling === null) {
      rowErrors.push(`unknown bowling style "${bowlingStyle}"`);
      failed.add("bowling_style");
    }
    if (dateOfBirth !== "" && parsedDob === null) {
      rowErrors.push(`unreadable date of birth "${dateOfBirth}" (use dd/mm/yyyy or yyyy-mm-dd)`);
      failed.add("date_of_birth");
    }
    if (parsedDob !== null && now !== undefined && deriveAge(parsedDob, now) === null) {
      rowErrors.push(`date of birth "${dateOfBirth}" is in the future`);
      failed.add("date_of_birth");
    }
    if (feeStatusRaw !== "" && parsedFeeStatus === null) {
      rowErrors.push(`unknown fee status "${feeStatusRaw}" (paid, pending, waived or refunded)`);
      failed.add("fee_status");
    }
    if (parsedFee !== null && !parsedFee.ok) {
      rowErrors.push(`unreadable fee amount "${feeAmountRaw}"`);
      failed.add("fee_amount");
    }
    for (const [column, read] of [
      ["is_icon", iconFlag],
      ["is_captain", captainFlag],
      ["is_retained", retainedFlag],
    ] as const) {
      if (read.raw !== "" && read.value === null) {
        rowErrors.push(`unreadable ${column} "${read.raw}" (yes or no)`);
        failed.add(column);
      }
    }
    // Icon AND Captain is a legal pair: both pre-sign the player to their team,
    // and the marquee name is very often the one wearing the armband. The file
    // says what the dashboard can say.
    if (teamRaw !== "" && knownTeams !== undefined && !knownTeams.has(normalizeTeamName(teamRaw))) {
      rowErrors.push(`unknown team "${teamRaw}"`);
      failed.add("team");
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
        failed.add("is_captain");
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
      if (prior !== undefined && prior.name !== "" && sameName(prior.name, rawName)) {
        /*
         * THE SAME PERSON, TWICE. A Form accepts a second submission as happily
         * as a first, and the first real export carried one: same number, the
         * name differing only by a capital letter, and a different transaction
         * ID each time. That is not a phone to correct — it is a copy to drop,
         * and possibly a double payment to refund — so it says so, and offers
         * no phone edit. Still refused rather than merged: which copy is right
         * is the organizer's call.
         */
        rowErrors.push(
          `submitted the form twice — same name and phone as row ${String(prior.line)}; skip this copy, and check they weren't charged twice`,
        );
      } else if (prior !== undefined) {
        // Named, not numbered: two players sharing one family phone is the
        // usual cause, and the organizer needs to know WHICH two.
        rowErrors.push(
          prior.name === ""
            ? `duplicate phone in file (also line ${String(prior.line)})`
            : `duplicate phone in file — same number as ${prior.name} (row ${String(prior.line)})`,
        );
        failed.add("phone");
      } else {
        seenPhones.set(phone.phone, { line, name: rawName });
      }
    }

    if (rowErrors.length > 0) {
      errors.push({
        line,
        message: rowErrors.join("; "),
        ...(rawName === "" ? {} : { name: rawName }),
        fields: [...failed],
      });
      continue;
    }
    rows.push({
      line,
      name: rawName,
      phone: phone.ok ? phone.phone : rawPhone,
      // Canonical, not as written: `check.ok` means the row passed, so its
      // parsed role is the one that reaches the database.
      role: check.ok ? check.value.role : rawRole,
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
      photoDriveId: driveFileIdOf(optional("photo_link")),
      teamName: teamRaw === "" ? null : teamRaw,
      isIcon: iconFlag.value,
      isCaptain: captainFlag.value,
      isRetained: retainedFlag.value,
    });
  }

  return { rows, errors };
}
