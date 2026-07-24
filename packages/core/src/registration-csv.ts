/**
 * Deterministic registration CSV import parsing + validation (M-IP3-2). Pure —
 * no storage, no IO. The import path VALIDATES the whole file before any write
 * and REJECTS on any error (no partial corruption): a caller commits only when
 * `errors` is empty. RFC-4180-ish: quoted fields, doubled quotes, CRLF/LF, and
 * embedded newlines inside quotes are all handled.
 */

import { isRegistrationRole, type RegistrationRole } from "./competition";
import { normalizePhone } from "./phone";

export interface CsvRegistrationRow {
  line: number; // 1-based source line (header = line 1)
  name: string;
  phone: string; // normalized E.164
  role: RegistrationRole;
  basePriceBand: string | null;
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

    const rowErrors: string[] = [];
    if (rawName.length < 3) {
      rowErrors.push("name must be at least 3 characters");
    }
    const phone = normalizePhone(rawPhone);
    if (!phone.ok) {
      rowErrors.push(`invalid phone "${rawPhone}"`);
    }
    if (!isRegistrationRole(rawRole)) {
      rowErrors.push(`invalid role "${rawRole}"`);
    }
    if (
      band !== "" &&
      knownBands !== undefined &&
      !knownBands.some((known) => known.toUpperCase() === band.toUpperCase())
    ) {
      rowErrors.push(`unknown base price band "${band}" (expected ${knownBands.join(", ")})`);
    }
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
    });
  }

  return { rows, errors };
}
