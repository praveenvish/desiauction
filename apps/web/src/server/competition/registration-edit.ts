import {
  NAME_MAX_LENGTH,
  deriveAge,
  isAttributeValueIn,
  isFeeStatus,
  isRoleIn,
  parseRupeesToPaise,
  type FeeStatus,
  type SportPack,
} from "@desiauction/core";

/**
 * EDITING A PLAYER IN PLACE — the rules, with no database in sight.
 *
 * Until the player sheet, the only way to correct a registration was to export
 * it, fix a cell in Excel and import the file back. Every field below was
 * already importable, so every rule below already existed — in the CSV parser.
 * This is the same contract applied to one field at a time: the same caps
 * (`registration-csv.ts`), the same vocabulary (the season's pack), the same
 * rupee reader. A value the import would refuse, the sheet refuses too.
 *
 * Pure, so it is tested without a database, and so the action that calls it is
 * a thin tenant boundary around a decision made here.
 */

/** What the sheet may send. Every field optional; "" means "clear it". */
export interface RegistrationEditInput {
  /** The name this season shows (0075) — never the player's account name. */
  name?: string;
  role?: string;
  basePriceBand?: string;
  /** ISO `yyyy-mm-dd`, the only shape `deriveAge` reads. */
  dateOfBirth?: string;
  /** The pack's attribute key → one of its option keys, or "". */
  attributes?: Record<string, string>;
  fatherName?: string;
  jerseyName?: string;
  jerseyNumber?: string;
  tshirtSize?: string;
  trouserSize?: string;
  note?: string;
  feeStatus?: string;
  /** Rupees, the way a desk writes them: "500", "₹1,200", "750.50". */
  feeAmount?: string;
  feeReference?: string;
}

export type EditableField = keyof RegistrationEditInput;

/** Column values ready for `db.update(registrations).set(...)`. */
export interface RegistrationEditSet {
  enteredName?: string;
  /** Carried from the account when a row first gains a typed name. */
  enteredPhotoKey?: string | null;
  enteredPhotoConsentAt?: Date | null;
  enteredPhotoConsentVia?: string | null;
  role?: string | null;
  basePriceBand?: string | null;
  dateOfBirth?: string | null;
  battingStyle?: string | null;
  bowlingStyle?: string | null;
  /** The WHOLE json object after the edit — merged with what was stored. */
  attributes?: Record<string, string>;
  fatherName?: string | null;
  jerseyName?: string | null;
  jerseyNumber?: string | null;
  tshirtSize?: string | null;
  trouserSize?: string | null;
  note?: string | null;
  feeStatus?: FeeStatus;
  feeAmountPaise?: number | null;
  feeReference?: string | null;
}

export interface RegistrationEditContext {
  pack: SportPack;
  /** The season's price bands — `bandsFor`. */
  bands: readonly string[];
  /**
   * The auction has left `scheduled`. Role and band decide how a lot is priced
   * and whether a bid breaks a role quota, so they freeze with the roster — the
   * same instant marks do. Everything else here is the club's own paperwork.
   */
  rosterLocked: boolean;
  /** `registrations.attributes` as stored, so a json edit merges, not replaces. */
  storedAttributes: Record<string, unknown>;
  now: Date;
}

export type RegistrationEditPlan =
  | { ok: true; set: RegistrationEditSet; changed: EditableField[] }
  | { ok: false; fieldErrors: Partial<Record<EditableField, string>> };

/** The CSV parser's caps (`registration-csv.ts`), so both doors agree. */
const CAPS = {
  fatherName: 120,
  jerseyName: 60,
  jerseyNumber: 10,
  tshirtSize: 20,
  trouserSize: 20,
  note: 2000,
  feeReference: 200,
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function planRegistrationEdit(
  input: RegistrationEditInput,
  context: RegistrationEditContext,
): RegistrationEditPlan {
  const set: RegistrationEditSet = {};
  const changed: EditableField[] = [];
  const errors: Partial<Record<EditableField, string>> = {};

  if (input.name !== undefined) {
    const name = input.name.trim().replace(/\s+/g, " ");
    // Always the SEASON's name (`entered_name`, 0075), never the account's:
    // an organizer corrects what their season shows, and the player's own
    // profile is untouched. The action carries the photo across when a row
    // first gains a typed name — see `updateRegistrationDetailsAction`.
    if (name === "") {
      errors.name = "A player needs a name.";
    } else if (name.length > NAME_MAX_LENGTH) {
      errors.name = `Keep it under ${String(NAME_MAX_LENGTH)} characters.`;
    } else {
      set.enteredName = name;
      changed.push("name");
    }
  }

  if (input.role !== undefined || input.basePriceBand !== undefined) {
    if (context.rosterLocked) {
      const message = "The auction has started — role and band are locked with the roster.";
      if (input.role !== undefined) {
        errors.role = message;
      }
      if (input.basePriceBand !== undefined) {
        errors.basePriceBand = message;
      }
    }
  }
  if (input.role !== undefined && !context.rosterLocked) {
    if (input.role === "") {
      if (context.pack.roles.required) {
        errors.role = "This sport needs a playing role.";
      } else {
        set.role = null;
        changed.push("role");
      }
    } else if (!isRoleIn(context.pack, input.role)) {
      errors.role = "That role is not one this season's sport has.";
    } else {
      set.role = input.role;
      changed.push("role");
    }
  }
  if (input.basePriceBand !== undefined && !context.rosterLocked) {
    if (input.basePriceBand === "") {
      set.basePriceBand = null;
      changed.push("basePriceBand");
    } else if (!context.bands.includes(input.basePriceBand)) {
      errors.basePriceBand = "That band is not one this season's auction uses.";
    } else {
      set.basePriceBand = input.basePriceBand;
      changed.push("basePriceBand");
    }
  }

  if (input.dateOfBirth !== undefined) {
    if (input.dateOfBirth === "") {
      set.dateOfBirth = null;
      changed.push("dateOfBirth");
    } else if (
      !ISO_DATE.test(input.dateOfBirth) ||
      deriveAge(input.dateOfBirth, context.now) === null ||
      new Date(input.dateOfBirth) > context.now
    ) {
      errors.dateOfBirth = "Enter a real date of birth.";
    } else {
      set.dateOfBirth = input.dateOfBirth;
      changed.push("dateOfBirth");
    }
  }

  if (input.attributes !== undefined) {
    const json = new Map<string, string>();
    for (const [key, value] of Object.entries(context.storedAttributes)) {
      if (typeof value === "string") {
        json.set(key, value);
      }
    }
    let jsonTouched = false;
    let attributeError: string | null = null;
    for (const [key, value] of Object.entries(input.attributes)) {
      const spec = context.pack.attributes.find((attribute) => attribute.key === key);
      if (spec === undefined) {
        attributeError = "That detail is not one this season's sport asks about.";
        continue;
      }
      if (value !== "" && !isAttributeValueIn(context.pack, key, value)) {
        attributeError = `That is not a ${spec.label.toLowerCase()} this sport knows.`;
        continue;
      }
      const stored = value === "" ? null : value;
      if (spec.storage.kind === "column") {
        // Cricket's two real columns; no other pack declares a column.
        if (spec.storage.column === "batting_style") {
          set.battingStyle = stored;
        } else if (spec.storage.column === "bowling_style") {
          set.bowlingStyle = stored;
        } else {
          attributeError = "That detail cannot be edited here.";
          continue;
        }
      } else {
        jsonTouched = true;
        if (stored === null) {
          json.delete(key);
        } else {
          json.set(key, stored);
        }
      }
    }
    if (attributeError !== null) {
      errors.attributes = attributeError;
    } else {
      if (jsonTouched) {
        set.attributes = Object.fromEntries(json);
      }
      changed.push("attributes");
    }
  }

  for (const field of [
    "fatherName",
    "jerseyName",
    "jerseyNumber",
    "tshirtSize",
    "trouserSize",
    "note",
    "feeReference",
  ] as const) {
    const raw = input[field];
    if (raw === undefined) {
      continue;
    }
    const value = raw.trim();
    if (value.length > CAPS[field]) {
      errors[field] = `Keep it under ${String(CAPS[field])} characters.`;
      continue;
    }
    set[field] = value === "" ? null : value;
    changed.push(field);
  }

  if (input.feeStatus !== undefined) {
    if (!isFeeStatus(input.feeStatus)) {
      errors.feeStatus = "Choose paid, not paid, waived or refunded.";
    } else {
      set.feeStatus = input.feeStatus;
      changed.push("feeStatus");
    }
  }
  if (input.feeAmount !== undefined) {
    if (input.feeAmount.trim() === "") {
      // Blank is "no amount recorded", which is not zero — see the export.
      set.feeAmountPaise = null;
      changed.push("feeAmount");
    } else {
      const parsed = parseRupeesToPaise(input.feeAmount);
      if (!parsed.ok) {
        errors.feeAmount = "Write the amount in rupees, like 500 or 750.50.";
      } else {
        set.feeAmountPaise = parsed.value;
        changed.push("feeAmount");
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }
  return { ok: true, set, changed };
}
