/**
 * COLUMN MAPPING — reading a file whose headers are somebody else's words.
 *
 * Pure: no IO, no storage, no ambient time.
 *
 * The import parser reads a canonical header row (`name`, `phone`, `role`, …).
 * Almost nobody hands us one. A club runs registration on a Google Form, and a
 * Form export's headers are the QUESTIONS: "Timestamp", "Email Address",
 * "Player Name", "Mobile Number", "Which role do you play?". Against that file
 * the parser refused at line 1 with "Missing required column(s)" and the
 * organizer's only recourse was to open the sheet and rename columns by hand —
 * the most repeated task in the product, performed outside the product, once
 * per tournament.
 *
 * THREE LAYERS, and the order matters:
 *
 *   1. DETECT. `detectMapping` guesses from a synonym table. It does the common
 *      case and asks for nothing.
 *   2. CONFIRM. The caller shows what was guessed, with a sample value beside
 *      each column, and the organizer corrects it. Never skipped — a mapping
 *      applied silently is a mapping nobody can check.
 *   3. REMEMBER. `signatureOf` fingerprints the header row so the same Form next
 *      season arrives already mapped.
 *
 * NOTHING HERE GUESSES TWICE. Two headers claiming one field is reported as a
 * conflict rather than resolved by picking one; a header matching nothing is
 * reported as unmapped rather than dropped on the floor. The rule is the one
 * the rest of this import already follows: place it, or say you could not.
 */

/** The columns `parseRegistrationRecords` understands. */
export const IMPORT_FIELDS = [
  "name",
  "phone",
  "role",
  "base_price_band",
  "date_of_birth",
  "batting_style",
  "bowling_style",
  // --- Desk + kit (0034). Optional everywhere; a club that collects none of
  // this maps none of it and nothing changes.
  "fee_status",
  "fee_amount",
  "fee_reference",
  "note",
  "father_name",
  "jersey_name",
  "jersey_number",
  "tshirt_size",
  "trouser_size",
  // --- The squad a file already knows. A club's roster sheet says which team
  // each player belongs to and which of them were kept from last season; until
  // these existed, every one of those facts was re-entered by hand.
  "team",
  "is_icon",
  "is_captain",
  "is_retained",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** The three without which a registration cannot exist. */
export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ["name", "phone", "role"];

/** What each column is called on screen. */
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: "Player name",
  phone: "Mobile number",
  role: "Playing role",
  base_price_band: "Base price band",
  date_of_birth: "Date of birth",
  batting_style: "Batting style",
  bowling_style: "Bowling style",
  fee_status: "Fee paid?",
  fee_amount: "Fee amount (₹)",
  fee_reference: "Payment reference",
  note: "Organizer note",
  father_name: "Father's name",
  jersey_name: "Jersey name",
  jersey_number: "Jersey number",
  tshirt_size: "T-shirt size",
  trouser_size: "Trouser size",
  team: "Team",
  is_icon: "Icon?",
  is_captain: "Captain?",
  is_retained: "Retained?",
};

/**
 * Comparable form of a header cell.
 *
 * Case, punctuation and spacing are noise: a form builder writes "Which role do
 * you play?", a spreadsheet writes "Role (required)", and both mean `role`.
 * Trailing qualifiers in brackets are dropped for the same reason — they
 * describe the QUESTION, not the field.
 */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // "(required)", "(optional)", "(as per ID)"
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The vocabulary of a club registration form.
 *
 * Deliberately a fixed table rather than fuzzy matching: a wrong guess here
 * writes one player's phone number into another player's row, and a mapping
 * screen that is usually right and occasionally silently wrong is worse than
 * one that asks. Anything not listed comes back unmapped for a human to place.
 */
const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  name: [
    "name",
    "player name",
    "full name",
    "players name",
    "player full name",
    "name of player",
    "name of the player",
    "candidate name",
    "participant name",
    "your name",
    "player",
  ],
  phone: [
    "phone",
    "mobile",
    "mobile number",
    "mobile no",
    "phone number",
    "phone no",
    "contact",
    "contact number",
    "contact no",
    "whatsapp",
    "whatsapp number",
    "cell",
    "cell number",
  ],
  role: [
    "role",
    "playing role",
    "player role",
    "which role do you play",
    "what is your playing role",
    "your role",
    "player type",
    "type",
    "speciality",
    "specialty",
  ],
  base_price_band: [
    "base price band",
    "base price",
    "price band",
    "band",
    "category",
    "player category",
    "grade",
    "tier",
  ],
  date_of_birth: [
    "date of birth",
    "dob",
    "birth date",
    "birthdate",
    "date of birth dd mm yyyy",
    "d o b",
  ],
  batting_style: ["batting style", "batting", "bats", "batting hand", "which hand do you bat with"],
  bowling_style: [
    "bowling style",
    "bowling",
    "bowls",
    "bowling type",
    "bowling arm",
    "what type of bowling do you bowl",
  ],
  fee_status: [
    "fee status",
    "fee paid",
    "paid",
    "payment status",
    "payment done",
    "have you paid the entry fee",
    "fees paid",
    "payment",
  ],
  fee_amount: [
    "fee amount",
    "amount",
    "amount paid",
    "entry fee",
    "fee",
    "fees",
    "registration fee",
  ],
  fee_reference: [
    "payment reference",
    "reference",
    "utr",
    "utr number",
    "transaction id",
    "transaction no",
    "txn id",
    "payment id",
    "reference no",
  ],
  note: ["note", "notes", "remark", "remarks", "comment", "comments", "organizer note"],
  father_name: ["father name", "fathers name", "father s name", "guardian name", "parent name"],
  jersey_name: ["jersey name", "name on jersey", "name on shirt", "tshirt name", "t shirt name"],
  jersey_number: ["jersey number", "jersey no", "shirt number", "shirt no", "preferred number"],
  tshirt_size: ["tshirt size", "t shirt size", "shirt size", "jersey size", "size"],
  trouser_size: ["trouser size", "trousers size", "pant size", "pants size", "lower size"],
  team: ["team", "team name", "squad", "franchise", "club", "team allotted", "allotted team"],
  /*
   * "marquee" is an alias for icon because that is the word the tournament
   * itself uses on the poster; "pre signed" and "direct entry" are what a
   * roster sheet calls the same thing.
   */
  is_icon: [
    "is icon",
    "icon",
    "icon player",
    "marquee",
    "marquee player",
    "pre signed",
    "presigned",
    "direct entry",
  ],
  // No single-letter alias. A column headed "C" could be anything, and a wrong
  // guess here hands one team's armband to another team's player.
  is_captain: ["is captain", "captain", "skipper", "team captain"],
  /*
   * A retention sheet's column is usually just "retained" or "kept" — the
   * question it answers is whether this player stays from last season.
   */
  is_retained: [
    "is retained",
    "retained",
    "retention",
    "retained player",
    "kept",
    "keep",
    "carry forward",
    "last season",
  ],
};

/**
 * Columns a Google Form adds that are never player data.
 *
 * Ignored by default and REPORTED as ignored — the confirmation screen lists
 * them, because "we skipped a column" is exactly the kind of decision that
 * should be visible rather than assumed.
 */
const KNOWN_NOISE: readonly string[] = [
  "timestamp",
  "submitted at",
  "submission time",
  "email address",
  "email",
  "score",
  "id",
  "sr no",
  "s no",
  "serial no",
  "row",
];

/**
 * Every alias, and which field claims it — exported so a test can prove that
 * no two fields claim the same one.
 *
 * The map below is built with `flatMap`, so a duplicate alias is not an error:
 * the LAST field to list it silently wins, and a header the organizer never
 * looked at lands in the wrong column. With 140-odd aliases across 22 fields
 * that is not something anyone can check by reading.
 */
export const IMPORT_ALIAS_CLAIMS: readonly (readonly [string, ImportField])[] =
  IMPORT_FIELDS.flatMap((field) => [
    [normalizeHeader(field), field] as const,
    ...HEADER_ALIASES[field].map((alias) => [normalizeHeader(alias), field] as const),
  ]);

const FIELD_BY_ALIAS: ReadonlyMap<string, ImportField> = new Map(
  IMPORT_FIELDS.flatMap((field) => [
    [normalizeHeader(field), field] as const,
    ...HEADER_ALIASES[field].map((alias) => [normalizeHeader(alias), field] as const),
  ]),
);

/** A source column and where (if anywhere) it goes. */
export interface MappedColumn {
  /** Zero-based position in the source header row. */
  index: number;
  /** The header exactly as the file wrote it — shown back to the organizer. */
  header: string;
  /** Null = ignored: either known noise or nothing we could place. */
  field: ImportField | null;
  /** True when the column was recognised as a form's own bookkeeping. */
  noise: boolean;
}

export interface MappingConflict {
  field: ImportField;
  /** Every source header that claimed this field, in file order. */
  headers: string[];
}

export interface DetectedMapping {
  columns: MappedColumn[];
  /** Required fields no column claimed — the screen cannot continue with these. */
  missing: ImportField[];
  /** Fields claimed twice. NOT auto-resolved; the organizer picks. */
  conflicts: MappingConflict[];
}

/**
 * Guess a mapping from a header row.
 *
 * A field is assigned to the FIRST header that claims it, and every later
 * claimant is left unmapped and named in `conflicts` — so the screen shows one
 * working choice and states plainly that a decision is outstanding, rather than
 * silently preferring a column the organizer never looked at.
 */
export function detectMapping(headers: readonly string[]): DetectedMapping {
  const claimed = new Map<ImportField, string[]>();
  const columns: MappedColumn[] = headers.map((header, index) => {
    const key = normalizeHeader(header);
    const field = FIELD_BY_ALIAS.get(key);
    if (field === undefined) {
      return { index, header, field: null, noise: KNOWN_NOISE.includes(key) };
    }
    const already = claimed.get(field);
    if (already === undefined) {
      claimed.set(field, [header]);
      return { index, header, field, noise: false };
    }
    already.push(header);
    return { index, header, field: null, noise: false };
  });
  const conflicts: MappingConflict[] = [...claimed.entries()]
    .filter(([, hs]) => hs.length > 1)
    .map(([field, hs]) => ({ field, headers: hs }));
  const missing = REQUIRED_IMPORT_FIELDS.filter((field) => !claimed.has(field));
  return { columns, missing, conflicts };
}

/** field → source column index. The confirmed answer the organizer approved. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

/** field → { value as written: value we understand }. */
export type ValueMaps = Partial<Record<ImportField, Record<string, string>>>;

/** The mapping a detection implies, before anybody edits it. */
export function mappingOf(detected: DetectedMapping): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const column of detected.columns) {
    if (column.field !== null) {
      mapping[column.field] = column.index;
    }
  }
  return mapping;
}

/**
 * Rewrite records into the canonical shape `parseRegistrationRecords` reads.
 *
 * The output is a header row of canonical names followed by the data rows,
 * carrying ONLY mapped columns. Row length is normalized to the mapping, so a
 * short row (a trailing empty cell a spreadsheet dropped) reads as empty rather
 * than shifting every later column left by one.
 *
 * `valueMaps` is applied per cell before the parser sees it — that is where
 * "Star Player" becomes the band "A". Comparison is on the same normalized form
 * the mapping screen offered, so the organizer's answer matches whatever
 * spacing and case the file actually used.
 */
export function applyMapping(
  records: readonly (readonly string[])[],
  mapping: ColumnMapping,
  valueMaps?: ValueMaps,
): string[][] {
  const fields = IMPORT_FIELDS.filter((field) => mapping[field] !== undefined);
  const header = [...fields] as string[];
  const body = records.slice(1).map((record) =>
    fields.map((field) => {
      const index = mapping[field];
      const raw = (index === undefined ? "" : (record[index] ?? "")).trim();
      const remap = valueMaps?.[field];
      if (remap === undefined || raw === "") {
        return raw;
      }
      const hit = remap[normalizeHeader(raw)] ?? remap[raw];
      return hit ?? raw;
    }),
  );
  return [header, ...body];
}

/**
 * A fingerprint of the file's SHAPE, for recognising the same form again.
 *
 * Normalized and sorted, so the same Form exported twice matches even if a
 * question was reworded in case or the columns were reordered. It is not a
 * secret and not a checksum of the data — it identifies a layout, nothing else.
 */
export function signatureOf(headers: readonly string[]): string {
  return [...headers]
    .map(normalizeHeader)
    .filter((header) => header !== "")
    .sort()
    .join("|");
}

/**
 * The first data value under each column — what the confirmation screen shows
 * beside the dropdown. Seeing "9876543210" under "Mobile Number" is what makes
 * a mapping checkable at a glance instead of an act of faith.
 */
export function sampleRow(records: readonly (readonly string[])[]): string[] {
  const header = records[0] ?? [];
  for (const record of records.slice(1)) {
    if (record.some((cell) => cell.trim() !== "")) {
      return header.map((_, index) => (record[index] ?? "").trim());
    }
  }
  return header.map(() => "");
}
