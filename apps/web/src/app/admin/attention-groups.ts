import { countNoun, waitedFor } from "../../server/admin/format";
import type { AttentionRow } from "../../server/admin/views";
import type { StuckSummary } from "./room-state";

/**
 * THE ATTENTION QUEUE, ONE LINE PER PROBLEM — NOT ONE PER CLUB.
 *
 * The projection raises a row per org (stuck auctions are grouped by org,
 * finance verdicts are carried per org), which is right for the data and wrong
 * for a first screen: the overview listed ~42 rows, "1 auction still live — the
 * oldest for 5 days" over and over, and the one line that mattered — a dead
 * runner — was somewhere in the middle. So the overview groups rows of a kind
 * and states the total, and the door goes to the board that lists them all.
 *
 * A kind with a single row keeps that row's own sentence and deep link.
 */
export interface AttentionGroup {
  readonly kind: string;
  readonly title: string;
  /** The kind and, for a single row, the org it concerns. */
  readonly sub: string;
  readonly href: string | null;
  readonly linkLabel: string;
}

/** How many groups the overview shows before it says "and N more". */
export const ATTENTION_CAP = 5;

function orgsIn(rows: readonly AttentionRow[]): number {
  return new Set(rows.map((row) => row.orgSlug ?? "")).size;
}

function clubs(rows: readonly AttentionRow[] | number): string {
  return countNoun(typeof rows === "number" ? rows : orgsIn(rows), "club");
}

function groupOf(
  kind: string,
  rows: readonly AttentionRow[],
  stuckLiveTotal: number | undefined,
  stuck: StuckSummary | undefined,
): AttentionGroup {
  const first = rows[0] as AttentionRow;
  if (kind === "auction:stuck-live" && stuck !== undefined) {
    // The live board's rule and count (see room-state.ts), so this line and
    // the board's "Silent over 12h" fold can never disagree.
    return {
      kind,
      title: `${countNoun(stuck.count, "auction")} silent for over 12 hours across ${clubs(stuck.clubs)}${
        stuck.longestSilentMs !== null ? ` · longest ${waitedFor(stuck.longestSilentMs)}` : ""
      }`,
      sub: kind,
      href: "/admin/live",
      linkLabel: "Live board",
    };
  }
  const listed = rows.reduce((sum, row) => sum + (row.count ?? 1), 0);
  // The projection lists at most 20 clubs' stuck auctions; the platform-wide
  // count (the same rule, uncapped) says whether that list was cut short.
  const cut =
    kind === "auction:stuck-live" && stuckLiveTotal !== undefined && stuckLiveTotal > listed;
  if (rows.length === 1 && !cut) {
    return {
      kind,
      title: first.subject,
      sub: first.orgName !== null ? `${kind} · ${first.orgName}` : kind,
      href: first.href,
      linkLabel: "Inspect",
    };
  }
  if (kind === "auction:stuck-live") {
    const total = cut ? stuckLiveTotal : listed;
    const oldest = Math.max(...rows.map((row) => row.waitedMs ?? 0));
    const where = cut ? `${String(orgsIn(rows))}+ clubs` : clubs(rows);
    return {
      kind,
      // Says the rule, so it can't be read against the Live board's "Silent
      // over 12h" (a different rule: no event for 12h, live OR paused).
      title: `${countNoun(total, "auction")} live for over 12 hours across ${where} · oldest ${waitedFor(oldest)}`,
      sub: kind,
      href: "/admin/live",
      linkLabel: "Live board",
    };
  }
  if (kind === "settlement:discrepant") {
    return {
      kind,
      title: `${countNoun(rows.length, "settlement case")} discrepant across ${clubs(rows)}`,
      sub: kind,
      href: "/admin/orgs",
      linkLabel: "Organizations",
    };
  }
  // Everything else is a finance-operations verdict (dispatch, export, health),
  // raised per club — and /admin/health is where each club's is laid out.
  const what =
    kind === "export:failed" || kind.startsWith("health:exports")
      ? "failed export artifacts"
      : kind === "dispatch:failed"
        ? "failed deliveries"
        : kind.startsWith("health:")
          ? `an unhealthy ${kind.split(":")[1] ?? "component"}`
          : kind;
  return {
    kind,
    title: `${clubs(rows)} with ${what}`,
    sub: `${kind} · ${countNoun(rows.length, "item")}`,
    href: "/admin/health",
    linkLabel: "Health",
  };
}

/**
 * `stuckLiveTotal` is the overview's platform-wide count of the same rule
 * (`live`, created over 12 hours ago). The per-club rows stop at 20 clubs, so
 * summing them printed "20 auctions" beside a chip that said 116.
 */
export function groupAttention(
  rows: readonly AttentionRow[],
  {
    stuckLiveTotal,
    stuck,
  }: {
    stuckLiveTotal?: number;
    /** The live board's silent rooms: when given, the stuck line is the board's. */
    stuck?: StuckSummary;
  } = {},
): {
  groups: AttentionGroup[];
  more: number;
} {
  const byKind = new Map<string, AttentionRow[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind);
    if (list === undefined) {
      byKind.set(row.kind, [row]);
    } else {
      list.push(row);
    }
  }
  // First-seen order: the projection already ranks platform-wide trouble
  // (the runner) ahead of per-club trouble.
  if (stuck !== undefined && stuck.count > 0 && !byKind.has("auction:stuck-live")) {
    byKind.set("auction:stuck-live", []);
  }
  // The board is the authority: no silent room there, no stuck line here.
  // (Filtered, not removed from the map: administration's source scan reads
  // any map removal call as a write.)
  const all = [...byKind.entries()]
    .filter(([kind]) => !(kind === "auction:stuck-live" && stuck?.count === 0))
    .map(([kind, list]) => groupOf(kind, list, stuckLiveTotal, stuck));
  return { groups: all.slice(0, ATTENTION_CAP), more: Math.max(0, all.length - ATTENTION_CAP) };
}
