import {
  IMPORT_FIELD_LABELS,
  normalizeHeader,
  type ImportField,
  type ValueMaps,
} from "./import-mapping";
import { FEE_STATUSES, parseFeeStatus } from "./money";
import { normalizeTeamName, parseCsvFlag } from "./registration-csv";
import { attributeSpec, parseAttributeIn, parseRoleIn, type SportPack } from "./sports";

/**
 * THE VALUES A FILE USES AND THIS SEASON DOES NOT.
 *
 * Column mapping translates the file's HEADERS into ours. It does nothing about
 * what is written UNDER them, and for a closed vocabulary that is the half that
 * actually stops an import: a club whose price bands are "Category 1/2/3"
 * against a season configured for A/B/C gets `unknown base price band` on every
 * row, and the only fix the product offered was to leave, edit the spreadsheet,
 * and come back. The same is true of a team called "Arrows" where the season
 * spells it "Andheri Arrows", and of a `Retained?` column reading
 * "Yes, keeping" instead of "yes".
 *
 * ALIASES ALREADY ABSORB WHAT IS PREDICTABLE. `parseRoleIn` knows "CB" and
 * "Wicket Keeper Batsman"; `parseFeeStatus` knows "paid"/"done". What no alias
 * table can ever know is a vocabulary invented per season — the bands this
 * organizer configured last week, the names they gave their four teams. Those
 * are exactly the fields below, and the reason this exists.
 *
 * Pure: it reports what it could not place and what the legal answers are. It
 * NEVER guesses a mapping — the module this belongs to already refuses to
 * "guess twice", because a wrong guess here writes one player's data into
 * another's row, silently, on a screen the organizer was told to trust.
 */

/** A legal answer for a field: what gets stored, and what a person reads. */
export interface ValueOption {
  value: string;
  label: string;
}

export interface UnplacedValue {
  field: ImportField;
  /** "Base price band" — the field's name on the mapping screen. */
  fieldLabel: string;
  /** The cell exactly as the file wrote it, which is what the organizer sees. */
  value: string;
  /** How many rows carry it, so the costliest is dealt with first. */
  rows: number;
  /** Every legal answer for this field, in the vocabulary's own order. */
  options: readonly ValueOption[];
}

/**
 * What this SEASON accepts. Bands and teams are per-season facts a pure module
 * cannot know, exactly as they are for the parser's own `knownBands` and
 * `knownTeams`.
 */
export interface ImportVocabulary {
  pack: SportPack;
  bands: readonly string[];
  teams: readonly string[];
}

const YES_NO: readonly ValueOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/**
 * The fields whose values are drawn from a closed set, and how to test one.
 *
 * A field NOT listed here is free text — a name, a phone, a jersey number, an
 * organizer's note — and there is nothing to map: any value is legal, so none
 * can be unplaceable. Listing them would offer the organizer a dropdown of
 * every note they had ever written.
 */
interface Closed {
  places: (value: string, vocab: ImportVocabulary) => boolean;
  options: (vocab: ImportVocabulary) => readonly ValueOption[];
}

const CLOSED: Partial<Record<ImportField, Closed>> = {
  role: {
    places: (value, { pack }) => parseRoleIn(pack, value) !== null,
    options: ({ pack }) =>
      pack.roles.values.map((role) => ({ value: role.key, label: role.label })),
  },
  batting_style: attribute("batting_style"),
  bowling_style: attribute("bowling_style"),
  fee_status: {
    places: (value) => parseFeeStatus(value) !== null,
    options: () => FEE_STATUSES.map((status) => ({ value: status, label: status })),
  },
  base_price_band: {
    // The parser compares bands case-insensitively and nothing else, so this
    // must agree with it exactly or the screen offers to fix a row that was
    // never broken.
    places: (value, { bands }) => bands.some((band) => band.toUpperCase() === value.toUpperCase()),
    options: ({ bands }) => bands.map((band) => ({ value: band, label: band })),
  },
  team: {
    places: (value, { teams }) =>
      teams.some((team) => normalizeTeamName(team) === normalizeTeamName(value)),
    options: ({ teams }) => teams.map((team) => ({ value: team, label: team })),
  },
  is_icon: flag(),
  is_captain: flag(),
  is_retained: flag(),
};

function attribute(key: string): Closed {
  return {
    // A pack that does not HAVE this attribute (football has no batting style)
    // cannot judge its values. Reporting every one of them as unplaceable would
    // bury the screen in rows no dropdown could fix.
    places: (value, { pack }) =>
      attributeSpec(pack, key) === null || parseAttributeIn(pack, key, value) !== null,
    options: ({ pack }) =>
      (attributeSpec(pack, key)?.options ?? []).map((option) => ({
        value: option.key,
        label: option.label,
      })),
  };
}

function flag(): Closed {
  return {
    places: (value) => parseCsvFlag(value) !== null,
    options: () => YES_NO,
  };
}

/**
 * Every value this file uses that the season cannot place, with its options.
 *
 * `records` are CANONICAL — the output of `applyMapping`, so the header row is
 * our field names. Values the organizer has ALREADY mapped are applied first
 * and therefore do not come back: the screen must shrink as it is filled in,
 * or it reads as though nothing the organizer did had any effect.
 *
 * Ordered by cost — most rows first, then alphabetically so two values of equal
 * weight do not swap places between two reads of the same file.
 */
export function unplacedValues(
  records: readonly (readonly string[])[],
  vocab: ImportVocabulary,
  valueMaps: ValueMaps = {},
): UnplacedValue[] {
  const header = (records[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const found: UnplacedValue[] = [];
  header.forEach((name, column) => {
    const field = name as ImportField;
    const closed = CLOSED[field];
    if (closed === undefined) {
      return;
    }
    const remap = valueMaps[field];
    const counts = new Map<string, number>();
    for (const record of records.slice(1)) {
      const raw = (record[column] ?? "").trim();
      if (raw === "") {
        continue;
      }
      // The same substitution `applyMapping` performs, so a value the organizer
      // has already placed is placed here too.
      const mapped = remap === undefined ? raw : (remap[normalizeHeader(raw)] ?? remap[raw] ?? raw);
      if (closed.places(mapped, vocab)) {
        continue;
      }
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
    for (const [value, rows] of counts) {
      found.push({
        field,
        fieldLabel: IMPORT_FIELD_LABELS[field],
        value,
        rows,
        options: closed.options(vocab),
      });
    }
  });
  return found.sort((a, b) => b.rows - a.rows || a.value.localeCompare(b.value));
}
