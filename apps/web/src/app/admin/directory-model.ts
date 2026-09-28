import type { KitTone } from "@desiauction/ui";

import { countNoun } from "../../server/admin/format";
import type { OrgDirectoryRow, UserDirectoryRow } from "../../server/admin/views";

/**
 * THE DIRECTORY ROWS, IN WORDS — pure, so what each row says is a unit test.
 *
 * Organizations drew five numeric columns and, on almost every row, four of
 * them read "—": a grid of dashes in which the one club with an open case hid.
 * A row now says what the club or person IS on the platform in one phrase with
 * the zeros left out, and carries only the flags an operator acts on.
 */

export interface Flag {
  readonly label: string;
  readonly tone: KitTone;
}

/** "2 seasons · 3 members · 2 auctions" — or what is true when all are zero. */
export function orgFacts(
  row: Pick<OrgDirectoryRow, "competitions" | "members" | "auctions">,
): string {
  const parts = [
    row.competitions > 0 ? countNoun(row.competitions, "season") : null,
    row.members > 0 ? countNoun(row.members, "member") : null,
    row.auctions > 0 ? countNoun(row.auctions, "auction") : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "Nothing yet" : parts.join(" · ");
}

/** The flags that ask for an operator, most urgent first. */
export function orgFlags(
  row: Pick<OrgDirectoryRow, "openCases" | "settledCases" | "financeDeclared" | "competitions">,
): Flag[] {
  const flags: Flag[] = [];
  if (row.openCases > 0) {
    flags.push({
      label: `${String(row.openCases)} case${row.openCases === 1 ? "" : "s"} open`,
      tone: "amber",
    });
  }
  if (row.settledCases > 0) {
    flags.push({ label: "Settled, not closed", tone: "blue" });
  }
  if (row.financeDeclared) {
    flags.push({ label: "Finance", tone: "green" });
  }
  if (row.competitions === 0) {
    flags.push({ label: "No seasons", tone: "neutral" });
  }
  return flags;
}

/** "Player · 2 seasons · 1 club", or the one true thing about a new account. */
export function userFacts(row: Pick<UserDirectoryRow, "name" | "orgs" | "seasons">): string {
  const parts = [
    row.seasons > 0 ? `Player · ${countNoun(row.seasons, "season")}` : null,
    row.orgs > 0 ? countNoun(row.orgs, "club") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length > 0) return parts.join(" · ");
  return row.name === null || row.name.trim() === ""
    ? "Signed in, never finished onboarding"
    : "No club or season yet";
}

/** A person's grants as one flag, or none. */
export function userFlags(row: Pick<UserDirectoryRow, "activeGrants">): Flag[] {
  return row.activeGrants > 0
    ? [
        {
          label: `${String(row.activeGrants)} grant${row.activeGrants === 1 ? "" : "s"}`,
          tone: "blue",
        },
      ]
    : [];
}
