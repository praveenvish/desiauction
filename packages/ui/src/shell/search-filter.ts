/**
 * The one matching rule for product search. Both search surfaces — the inline
 * top-bar field and the CommandPalette overlay — filter through this, so a
 * query can never mean two different things depending on where it was typed.
 */

export interface PaletteItem {
  key: string;
  label: string;
  /** Secondary line: org name, section, … */
  hint?: string;
  href: string;
  /** Extra match terms beyond the label. */
  keywords?: string;
}

export interface PaletteGroup {
  label: string;
  items: PaletteItem[];
}

/** Groups whose items match `query`; empty groups are dropped. */
export function filterGroups(groups: PaletteGroup[], query: string): PaletteGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return groups.filter((group) => group.items.length > 0);
  }
  const matches = (item: PaletteItem) =>
    item.label.toLowerCase().includes(needle) ||
    (item.hint ?? "").toLowerCase().includes(needle) ||
    (item.keywords ?? "").toLowerCase().includes(needle);
  return groups
    .map((group) => ({ ...group, items: group.items.filter(matches) }))
    .filter((group) => group.items.length > 0);
}
