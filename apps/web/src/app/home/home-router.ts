/**
 * WHICH SECTIONS THIS PERSON'S HOME IS MADE OF.
 *
 * Pure, and separate from `page.tsx`, for the same reason `navigationFor` is
 * separate from the shell: which home a role gets is a product decision, and a
 * product decision belongs where a test can pin it. /home was 1670 lines with
 * `manages ?` woven through its render, and the rules had already drifted in
 * there unnoticed — a team owner was shown the host club's whole calendar
 * because "not an organizer" had quietly come to mean "a member".
 */

export type HomeSection = "newcomer" | "owner" | "auctioneer" | "organizer" | "player" | "member";

export interface HomeFacts {
  /** Holds `org:owner` or `org:staff` anywhere. */
  manages: boolean;
  /** Owns at least one team. */
  owns: boolean;
  /** Appointed to conduct at least one season's auction. */
  conducts: boolean;
  /** A registration anywhere, or a player profile. */
  plays: boolean;
  /** Belongs to a club without managing it. NOT a role — see below. */
  belongsToClub: boolean;
}

/**
 * Ordered by the same precedence as the rail (nav.ts §3.1) — urgency, then how
 * much of this product the person has invested in — so somebody reading both
 * never has to reconcile two answers about what matters most right now.
 *
 * MEMBERSHIP IS NOT A ROLE. It renders only when it is the only thing a person
 * has, which is the one honest use for it: they belong to a club, and that is
 * all. Every other case has something better to lead with.
 */
export function homeSections(facts: HomeFacts): HomeSection[] {
  const sections: HomeSection[] = [];
  if (facts.owns) sections.push("owner");
  if (facts.conducts) sections.push("auctioneer");
  if (facts.manages) sections.push("organizer");
  if (facts.plays) sections.push("player");
  if (sections.length === 0 && facts.belongsToClub) sections.push("member");
  // Nothing at all: ask which they are, rather than rendering an empty
  // dashboard's skeleton at them.
  return sections.length === 0 ? ["newcomer"] : sections;
}
