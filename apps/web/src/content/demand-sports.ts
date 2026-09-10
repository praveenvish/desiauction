/**
 * WHAT SOMEBODY CAME HERE WANTING — declared once.
 *
 * This is the SP-1 gate's only instrument (migration 0045): `/schedule-demo`
 * asks which sport, the answer lands in `demo_requests.sport`, and counting
 * those answers is what decides which pack gets written next.
 *
 * NOT THE SPORT REGISTRY, AND IT MUST NEVER BE WIRED TO ONE. `core`'s `SPORTS`
 * names the sports the platform can RUN; this names the sports people ASK for,
 * which has to include ones we cannot run yet or the question measures nothing.
 * The two lists overlap and are not the same list, and the day they are merged
 * the gate stops working. A test holds every RUNNABLE sport to appearing here —
 * that direction only.
 *
 * WHY ONE FILE. The list used to exist in five places: this array, the form's
 * `<option>` values, the admin queue's badge words, the drizzle enum, and the
 * database CHECK. It drifted twice in two days, and both times silently:
 *
 *   · `table-tennis` was renamed `table_tennis` in 0057 when the pack shipped —
 *     in the list, the enum and the CHECK, but NOT in the form. The server
 *     refuses an unrecognised sport rather than folding it to "other"
 *     (deliberately: this is the answer that gets counted), so choosing Table
 *     tennis had been REFUSED ever since, with a message about the form.
 *   · `box_cricket` was a valid answer nobody could give, and `battle_royale`
 *     was a sport nobody could ask for.
 *
 * Neither was visible to the type system — JSX option values are strings, and
 * every unit test passed a value it made up. The three TypeScript copies are
 * now derived from this one; the two SQL copies cannot be, so a guardrail reads
 * them (`demo-requests.test.ts`).
 *
 * ORDERED BY EXPECTED VOLUME, not alphabetically: the top of a select is where
 * an honest answer is cheapest to give. `other` is last and deliberately vague
 * — a tail-catcher, with the form's note field as the place an unlisted sport
 * gets named.
 */
export interface DemandSport {
  readonly key: string;
  /** The chooser's word, Title Case — how it reads in the form's select. */
  readonly label: string;
  /**
   * The operator's word, for the admin queue's badge, where the sport reads as
   * part of a sentence rather than as a menu item. Defaults to the label
   * lower-cased, which is right for almost all of them; given explicitly only
   * where lower-casing the label would mangle it or where the operator needs
   * telling what to do next.
   */
  readonly badge?: string;
}

export const DEMAND_SPORTS = [
  { key: "cricket", label: "Cricket" },
  { key: "box_cricket", label: "Box cricket" },
  { key: "football", label: "Football" },
  { key: "kabaddi", label: "Kabaddi" },
  { key: "volleyball", label: "Volleyball" },
  { key: "badminton", label: "Badminton" },
  { key: "basketball", label: "Basketball" },
  { key: "hockey", label: "Hockey" },
  { key: "table_tennis", label: "Table tennis" },
  { key: "pickleball", label: "Pickleball" },
  { key: "esports", label: "Esports" },
  // The label names the two titles because "battle royale" is a format rather
  // than a game, and an organizer looking for BGMI will not recognise it.
  { key: "battle_royale", label: "Battle royale (BGMI, Free Fire)", badge: "battle royale" },
  // The badge tells the operator where the real answer is. Dropping the row
  // entirely would make "another sport" and "asked before we asked" identical.
  { key: "other", label: "Another sport", badge: "another sport — see the note" },
] as const satisfies readonly DemandSport[];

/**
 * The keys as a LITERAL UNION, not `string`.
 *
 * `as const satisfies` above is what keeps it one: the drizzle column for
 * `demo_requests.sport` is typed by its enum, so a widened `string` here fails
 * the insert at compile time — which is the check working, and the reason this
 * is written the awkward way round rather than as a plain annotated array.
 */
export type DemandSportKey = (typeof DEMAND_SPORTS)[number]["key"];

/** The operator's word for one answer — see `DemandSport.badge`. */
export function demandSportBadge(sport: DemandSport): string {
  return sport.badge ?? sport.label.toLowerCase();
}
