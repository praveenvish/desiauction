/**
 * THE EXPORT'S COLUMNS, NAMED ONCE.
 *
 * The export wrote the same sixteen columns for every purpose, so an organizer
 * sending a jersey order to a vendor also sent every phone number and fee, and
 * one printing an auction sheet got kit sizes they had to delete by hand. The
 * dialog now lets them choose; this list is what it chooses from, and the
 * server renders from the same keys — one registry, two readers.
 *
 * Keys are the IMPORT's canonical headers wherever one exists, so any subset
 * still round-trips: export the jersey columns, fix a number in Excel, import it
 * back, no mapping step. `age` is the one derived column, and the import simply
 * ignores it.
 *
 * `father_name` is deliberately absent. It is an identity check on an entry
 * form, and this file is handed to suppliers; see `exportRegistrationsCsv`.
 *
 * Client-safe: plain data, no database.
 */

export type ExportGroup = "player" | "playing" | "squad" | "fee" | "kit" | "desk";

export interface ExportColumn {
  key: string;
  label: string;
  group: ExportGroup;
}

export const EXPORT_GROUP_LABEL: Record<ExportGroup, string> = {
  player: "Player",
  playing: "Playing details",
  squad: "Status & squad",
  fee: "Entry fee",
  kit: "Kit",
  desk: "Desk",
};

/**
 * Registry order IS output order, whatever order columns were ticked in, so
 * two exports of the same choice are the same file. Sport attributes (cricket's
 * batting and bowling style, football's preferred foot) are inserted by the
 * season at `SPORT_ATTRIBUTES_AFTER`, because only the season knows them.
 */
export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "registration_number", label: "Registration number", group: "player" },
  { key: "name", label: "Name", group: "player" },
  { key: "phone", label: "Phone", group: "player" },
  { key: "role", label: "Playing role", group: "playing" },
  { key: "base_price_band", label: "Base price band", group: "playing" },
  { key: "age", label: "Age", group: "playing" },
  { key: "date_of_birth", label: "Date of birth", group: "playing" },
  { key: "status", label: "Registration status", group: "squad" },
  { key: "team", label: "Team", group: "squad" },
  { key: "is_icon", label: "Icon", group: "squad" },
  { key: "is_captain", label: "Captain", group: "squad" },
  { key: "is_retained", label: "Retained", group: "squad" },
  { key: "fee_status", label: "Fee status", group: "fee" },
  { key: "fee_amount", label: "Fee amount (₹)", group: "fee" },
  { key: "fee_reference", label: "Fee reference", group: "fee" },
  { key: "jersey_name", label: "Name on jersey", group: "kit" },
  { key: "jersey_number", label: "Jersey number", group: "kit" },
  { key: "tshirt_size", label: "T-shirt size", group: "kit" },
  { key: "trouser_size", label: "Trouser size", group: "kit" },
  { key: "note", label: "Organizer note", group: "desk" },
];

export const SPORT_ATTRIBUTES_AFTER = "date_of_birth";

/**
 * What an export with no choice writes — the file this button always produced.
 * A regression test holds the header byte for byte, because clubs have
 * spreadsheets and import mappings built on exactly this shape.
 */
export const DEFAULT_EXPORT_COLUMNS: readonly string[] = [
  "registration_number",
  "name",
  "phone",
  "role",
  "status",
  "team",
  "is_icon",
  "is_captain",
  "is_retained",
  "fee_status",
  "fee_amount",
  "fee_reference",
  "jersey_name",
  "jersey_number",
  "tshirt_size",
  "trouser_size",
];

export interface ExportPreset {
  id: string;
  label: string;
  /** One line on what the file is for — the reason to pick it. */
  purpose: string;
  columns: readonly string[];
  /** Which rows it usually wants; the dialog pre-selects this. */
  rows: ExportRows;
  /** Add the season's sport attributes (batting style …) to this preset. */
  withSportAttributes?: boolean;
}

export type ExportRows = "all" | "approved" | "pool" | "view";

export const EXPORT_ROWS_LABEL: Record<ExportRows, string> = {
  all: "Everyone registered",
  approved: "Approved players",
  pool: "Auction pool only",
  view: "What's on screen now",
};

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  {
    id: "auction",
    label: "Auction sheet",
    purpose: "Who goes under the hammer — for the auctioneer's table.",
    columns: ["registration_number", "name", "role", "base_price_band", "age", "team"],
    rows: "pool",
    withSportAttributes: true,
  },
  {
    id: "contacts",
    label: "Contact list",
    purpose: "Names and numbers — for a WhatsApp group or a call round.",
    columns: ["registration_number", "name", "phone", "status", "team"],
    rows: "approved",
  },
  {
    id: "kit",
    label: "Jersey order",
    purpose: "Names, numbers and sizes — safe to send to a vendor.",
    columns: ["name", "team", "jersey_name", "jersey_number", "tshirt_size", "trouser_size"],
    rows: "approved",
  },
  {
    id: "fees",
    label: "Fee desk",
    purpose: "Who has paid, how much, and the reference.",
    columns: [
      "registration_number",
      "name",
      "phone",
      "status",
      "fee_status",
      "fee_amount",
      "fee_reference",
    ],
    rows: "all",
  },
  {
    id: "everything",
    label: "Full roster",
    purpose: "Every column — re-imports cleanly after an edit in Excel.",
    columns: DEFAULT_EXPORT_COLUMNS,
    rows: "all",
  },
];

/** The registry with this season's sport attributes spliced in at their place. */
export function exportColumnsFor(
  sportAttributes: readonly { key: string; label: string }[],
): ExportColumn[] {
  const out: ExportColumn[] = [];
  for (const column of EXPORT_COLUMNS) {
    out.push(column);
    if (column.key === SPORT_ATTRIBUTES_AFTER) {
      for (const attribute of sportAttributes) {
        out.push({ key: attribute.key, label: attribute.label, group: "playing" });
      }
    }
  }
  return out;
}

/**
 * A requested column list, reduced to legal keys in registry order. Unknown
 * keys are dropped rather than refused — a stale choice remembered in a browser
 * must still produce a file — and an empty result falls back to the default.
 */
export function resolveExportColumns(
  requested: readonly string[] | undefined,
  sportAttributes: readonly { key: string; label: string }[],
): ExportColumn[] {
  const all = exportColumnsFor(sportAttributes);
  const wanted = new Set(requested ?? DEFAULT_EXPORT_COLUMNS);
  const chosen = all.filter((column) => wanted.has(column.key));
  if (chosen.length > 0) {
    return chosen;
  }
  const fallback = new Set(DEFAULT_EXPORT_COLUMNS);
  return all.filter((column) => fallback.has(column.key));
}
