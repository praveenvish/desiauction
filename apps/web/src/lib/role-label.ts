/**
 * NAMING A PLAYING ROLE, IN THE SEASON'S OWN SPORT.
 *
 * `roleLabel` from core is `roleLabelIn(CRICKET, …)`, and its fallback for a
 * role cricket has never heard of is `role.replace(/_/g, " ")` — the key,
 * lower-cased. Every non-cricket surface therefore printed "midfielder" in a
 * line of Title Case, and a pack whose label is not merely its key prettified
 * would have printed something plainly wrong.
 *
 * The fix is to ask the season's pack, which means the season's roles have to
 * reach the component. They arrive as plain {key,label} pairs because a pack
 * carries FUNCTIONS — a tiebreaker's `compute` — and can never cross into a
 * client component.
 *
 * One implementation so five surfaces cannot drift, and so the unknown-role
 * fallback is decided once. It stays lower-cased on purpose: reaching this
 * branch means the row holds a role the season does not have, and dressing
 * that up as a proper label would hide it.
 */
export function roleLabeller(
  roles: readonly { key: string; label: string }[],
): (role: string | null) => string {
  const byKey = new Map(roles.map((role) => [role.key, role.label]));
  return (role) => (role === null ? "" : (byKey.get(role) ?? role.replace(/_/g, " ")));
}
