/**
 * PRE-SIGNED: a player who joins their team directly instead of being bid for.
 *
 * Three marks mean it — Icon (the marquee name), Captain (picked before the
 * night) and Retained (kept from a prior season) — and every surface that asks
 * "is this player in the auction?" must ask about all three. Before this module
 * each reader carried its own copy of the predicate and they drifted: the pool
 * read two marks, the engine's squad cap read one, and captains were read by
 * none, so a captain the organizer had picked still went under the hammer.
 *
 * Client-safe on purpose: the dashboard's optimistic counts use the same rule
 * the server's pool filter does.
 */
export interface PreSignMarks {
  isIcon: boolean;
  isCaptain: boolean;
  isRetained: boolean;
}

export type PreSignedKind = "icon" | "captain" | "retained";

export function isPreSigned(marks: PreSignMarks): boolean {
  return marks.isIcon || marks.isCaptain || marks.isRetained;
}

/**
 * The ONE word a surface prints when it has room for one. Icon first — it is
 * the reason the poster exists — then Captain, then Retained, which says where
 * a player came from rather than what they are.
 */
export function preSignedKind(marks: PreSignMarks): PreSignedKind | null {
  if (marks.isIcon) {
    return "icon";
  }
  if (marks.isCaptain) {
    return "captain";
  }
  return marks.isRetained ? "retained" : null;
}

export const PRE_SIGNED_LABEL: Record<PreSignedKind, string> = {
  icon: "Icon",
  captain: "Captain",
  retained: "Retained",
};

/** The public page's phrasing: who this player is to their team. */
export function preSignedWord(kind: PreSignedKind | null): string {
  if (kind === "captain") {
    return "Captain";
  }
  if (kind === "retained") {
    return "Retained player";
  }
  return "Icon player";
}
