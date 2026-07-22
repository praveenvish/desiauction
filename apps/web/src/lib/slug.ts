/**
 * DOM-safe id fragment from arbitrary display text. Presentation-layer only —
 * `aria-labelledby` is a space-separated ID list, so an id built from a raw
 * multi-word label ("Pro Pass", "The live auction") would be read as several
 * non-existent ids and leave the labelled region with no accessible name. Route
 * slugs are a separate, server-side concern (see server/orgs, server/competition).
 */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
