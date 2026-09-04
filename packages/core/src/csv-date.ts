/**
 * READING A DATE THE WAY A FORM WROTE IT.
 *
 * Pure — no IO, no ambient time. The store is ISO `yyyy-mm-dd` text and
 * `deriveAge` refuses anything else, but a registration sheet carries whatever
 * the person filling it in typed and whatever the form builder chose to export:
 * `15/03/1998`, `15-03-1998`, `15 Mar 1998`, and — because a Google Form stamps
 * every response — `15/03/1998 14:32:11`.
 *
 * This was the third column nobody checked. Batting and bowling styles were
 * fixed to REPORT what they could not place; date of birth was still passed
 * through raw, so a `dd/mm/yyyy` birthday stored cleanly, reported no error, and
 * then read as a blank age on every screen for the rest of the season.
 *
 * TWO RULES GOVERN EVERYTHING BELOW.
 *
 * 1. AMBIGUITY IS NEVER GUESSED. `03/04/1998` is two different birthdays and no
 *    amount of cleverness can tell them apart. The caller states the order it
 *    means; `isAmbiguousDate()` exists so a UI can ask before it has to.
 *
 * 2. A TWO-DIGIT YEAR IS REFUSED, NOT PIVOTED. Deciding whether `98` means 1998
 *    or 2098 is exactly the guess that rule 1 forbids, and for a date of birth a
 *    century error is a hundred-year-old player nobody notices until the age
 *    filter is used in anger. Refusing sends it back as a row error, which is
 *    the outcome that gets it fixed.
 */

/** Which number comes first when a numeric date could be read either way. */
export type DateOrder = "dmy" | "mdy";

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Drop a trailing clock time and any surrounding noise. A Google Form response
 * export writes the submission instant into the same cell shape as a date, and
 * the time is never part of a birthday.
 */
function stripTime(value: string): string {
  return value
    .trim()
    .replace(/[\s,]+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]\.?m\.?)?$/i, "")
    .replace(/\s+(ist|utc|gmt|z)$/i, "")
    .trim();
}

/** Real calendar date → ISO, else null. Rejects 2020-02-30 and friends. */
function toIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  // A four-digit year is required; see rule 2 above. The upper bound only keeps
  // typos like `19988` out — plausibility for a BIRTH date is the caller's call.
  if (year < 1900 || year > 2999) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

/** The three numbers in a numeric date, in written order, else null. */
function numericParts(value: string): [number, number, number] | null {
  const match = /^(\d{1,4})[/\-. ](\d{1,2})[/\-. ](\d{1,4})$/.exec(value);
  if (match === null) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * True when a numeric date could be read as either order and the two readings
 * disagree — `03/04/1998`, but not `15/03/1998` (no 15th month) and not
 * `03/03/1998` (both readings are the same day).
 *
 * A UI uses this to ask ONCE, for the file, instead of guessing per row.
 */
export function isAmbiguousDate(value: string): boolean {
  const parts = numericParts(stripTime(value));
  if (parts === null) {
    return false;
  }
  const [first, second, third] = parts;
  // An ISO-looking value states its own order and is never ambiguous.
  if (String(first).length === 4) {
    return false;
  }
  if (String(third).length !== 4) {
    return false;
  }
  return first !== second && first <= 12 && second <= 12;
}

/**
 * Parse a date cell to ISO `yyyy-mm-dd`, else null.
 *
 * `order` decides only genuinely ambiguous numeric dates; `yyyy-mm-dd` and any
 * value naming its month are read as written whatever it says.
 */
export function parseCsvDate(value: string, order: DateOrder = "dmy"): string | null {
  const text = stripTime(value);
  if (text === "") {
    return null;
  }

  // "15 Mar 1998" / "15 March 1998" — day first, month named.
  const dayFirst = /^(\d{1,2})[\s\-.]+([a-z]+)[\s\-.,]+(\d{4})$/i.exec(text);
  if (dayFirst !== null) {
    const month = MONTH_NAMES[(dayFirst[2] ?? "").toLowerCase()];
    return month === undefined ? null : toIso(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }

  // "Mar 15, 1998" / "March 15 1998" — month named first.
  const monthFirst = /^([a-z]+)[\s\-.]+(\d{1,2})[\s\-.,]+(\d{4})$/i.exec(text);
  if (monthFirst !== null) {
    const month = MONTH_NAMES[(monthFirst[1] ?? "").toLowerCase()];
    return month === undefined ? null : toIso(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }

  const parts = numericParts(text);
  if (parts === null) {
    return null;
  }
  const [first, second, third] = parts;

  // ISO, or any year-first value: it states its own order.
  if (String(first).length === 4) {
    return toIso(first, second, third);
  }
  // Everything else must end in a four-digit year — rule 2.
  if (String(third).length !== 4) {
    return null;
  }
  // A value that can only be read one way is read that way, whatever `order`
  // says: "15/03/1998" is not a typist's opinion, there is no 15th month.
  if (first > 12) {
    return toIso(third, second, first);
  }
  if (second > 12) {
    return toIso(third, first, second);
  }
  return order === "mdy" ? toIso(third, first, second) : toIso(third, second, first);
}
