/**
 * EVERY SPORT'S DISPLAY LABEL, AND NOTHING ELSE.
 *
 * A client component that only needs "Cricket" for a key must not import the
 * registry to get it: `sportPack` drags all twelve packs — vocabularies,
 * attribute specs, standings rules — into the browser bundle of whatever
 * imports it. The shell's menu did exactly that, which put ~47 KB of sport
 * definitions into the JavaScript of every page in the product.
 *
 * Imported through its own entry point (`@desiauction/core/sport-labels`) so the
 * barrel never comes along. `labels.test.ts` holds it equal to the registry, so
 * a new pack cannot ship without its label here.
 */
export const SPORT_LABELS: Readonly<Record<string, string>> = {
  cricket: "Cricket",
  football: "Football",
  kabaddi: "Kabaddi",
  volleyball: "Volleyball",
  hockey: "Hockey",
  basketball: "Basketball",
  box_cricket: "Box cricket",
  esports: "Esports",
  badminton: "Badminton",
  table_tennis: "Table tennis",
  pickleball: "Pickleball",
  battle_royale: "Battle royale",
};

/** The label for a sport key, or null for a key with no pack. */
export function sportLabel(key: string): string | null {
  return Object.hasOwn(SPORT_LABELS, key) ? (SPORT_LABELS[key] ?? null) : null;
}
