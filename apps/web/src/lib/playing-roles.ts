/**
 * One prose name per playing role, shared by every surface that shows them.
 *
 * The map lived twice (season overview, auction overview) while the
 * registration desk lowercased the raw enum — "all rounder" in a column
 * between Title Case badges. Third consumer, so it moves to a module
 * (the same rule tournaments' status maps follow).
 */
const ROLE_LABEL: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  all_rounder: "All rounder",
  wicket_keeper: "Wicket-keeper",
};

/** The label for a role the map does not know, so an unseen enum still reads. */
export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.replace(/_/g, " ");
}
