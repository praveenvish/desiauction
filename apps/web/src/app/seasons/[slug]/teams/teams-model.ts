import type { TeamRosterRow } from "../../../../server/competition/team-workspace";

/**
 * THE TEAMS TAB, put into facts — pure, so what a team card says about its
 * squad (the role mix, the captain, what is still to set) is a unit test.
 */

export interface RoleShare {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** 0-based slot in the season's role order — picks the bar's colour. */
  readonly slot: number;
}

/** How the squad splits by playing role, in the season pack's order; unknown roles last. */
export function roleMix(
  roster: readonly Pick<TeamRosterRow, "role">[],
  roles: readonly { key: string; label: string }[],
): RoleShare[] {
  const counts = new Map<string, number>();
  for (const row of roster) {
    if (row.role !== null) counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
  }
  const known = roles
    .map((role, slot) => ({
      key: role.key,
      label: role.label,
      count: counts.get(role.key) ?? 0,
      slot,
    }))
    .filter((share) => share.count > 0);
  const unknown = [...counts]
    .filter(([key]) => !roles.some((role) => role.key === key))
    .map(([key, count], index) => ({
      key,
      label: key.replace(/_/g, " "),
      count,
      slot: roles.length + index,
    }));
  return [...known, ...unknown];
}

/** The squad's captain, if one is named. */
export function captainOf<T extends Pick<TeamRosterRow, "isCaptain">>(
  roster: readonly T[],
): T | null {
  return roster.find((row) => row.isCaptain) ?? null;
}

/** The squad's Icon players, in roster order — a team may have none, one or two. */
export function iconsOf<T extends Pick<TeamRosterRow, "isIcon">>(roster: readonly T[]): T[] {
  return roster.filter((row) => row.isIcon);
}

/** Everyone who joined without being bid for — captain first, then icons, then retained. */
export function preSigned<T extends Pick<TeamRosterRow, "isCaptain" | "isIcon" | "isRetained">>(
  roster: readonly T[],
): T[] {
  const rank = (row: T): number => (row.isCaptain ? 0 : row.isIcon ? 1 : 2);
  return roster
    .filter((row) => row.isCaptain || row.isIcon || row.isRetained)
    .sort((a, b) => rank(a) - rank(b));
}

export interface SetupStep {
  readonly key: "owner" | "captain" | "icon" | "coach";
  readonly done: boolean;
  /** The fact when done ("Owner · Aarav Shah"), the ask when not. */
  readonly label: string;
  /** Where to go to do it; null when it cannot be done yet or is optional. */
  readonly action: { readonly label: string; readonly hash: "" | "#settings" } | null;
}

/**
 * What a team still needs before auction night. The owner can only be
 * invited once the auction exists (the invite is to its paddle), so until
 * then that line says when, not "Invite".
 *
 * The Icon line names the team's marquee player(s) the way the captain line
 * names the captain. It is optional — a club without icons is not a team with
 * something missing — so, like the coach, it never counts as "to set".
 */
export function setupSteps(
  team: { ownerName: string | null; coachName: string | null },
  captain: { name: string | null } | null,
  icons: readonly { name: string | null }[],
  auctionExists: boolean,
  canManage: boolean,
): SetupStep[] {
  return [
    team.ownerName !== null
      ? { key: "owner", done: true, label: `Owner · ${team.ownerName}`, action: null }
      : {
          key: "owner",
          done: false,
          label: auctionExists ? "Owner" : "Owner — invited once the auction exists",
          action: auctionExists && canManage ? { label: "Invite", hash: "#settings" } : null,
        },
    captain !== null
      ? {
          key: "captain",
          done: true,
          label: `Captain · ${captain.name ?? "Unnamed"}`,
          action: null,
        }
      : {
          key: "captain",
          done: false,
          label: "Captain",
          action: canManage ? { label: "Pick", hash: "" } : null,
        },
    icons.length > 0
      ? {
          key: "icon",
          done: true,
          label: `Icon · ${icons.map((icon) => icon.name ?? "Unnamed").join(", ")}`,
          action: null,
        }
      : {
          key: "icon",
          done: false,
          label: "Icon (optional)",
          action: canManage ? { label: "Pick", hash: "" } : null,
        },
    team.coachName !== null
      ? { key: "coach", done: true, label: `Coach · ${team.coachName}`, action: null }
      : {
          key: "coach",
          done: false,
          label: "Coach (optional)",
          action: canManage ? { label: "Add", hash: "#settings" } : null,
        },
  ];
}
