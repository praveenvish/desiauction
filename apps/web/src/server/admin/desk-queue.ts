import {
  demoRequests,
  erasureRequests,
  passUpgradeRequests,
  problemReports,
  reviewReports,
  reviews,
  type Db,
} from "@desiauction/db";
import { eq, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import type { PlatformCapability } from "./capabilities";

/**
 * WAITING ON YOUR DESKS — the Overview's one card an operator can act on.
 *
 * The attention queue lists things administration cannot fix; every desk here
 * is work somebody holding its grant CAN pick up — a pass to answer, a demo to
 * call back, an erasure to decide, a report to read. Each desk sat on its own
 * tab with no count anywhere, so a request could wait a week unseen.
 *
 * Only the desks the viewer holds are listed. Which desks exist is not a
 * secret (every tab is shown to every administrator), but a count of somebody
 * else's queue is not a thing this operator can do anything about.
 *
 * Every "open" here is the desk's own definition, read from its own columns,
 * so the card cannot claim work the desk itself would not show.
 */

export interface DeskItem {
  readonly key: "passes" | "demos" | "erasure" | "reports" | "reviews" | "review-reports";
  /** Singular and plural, so "1 review awaiting moderation" / "3 reviews …". */
  readonly label: readonly [one: string, many: string];
  readonly count: number;
  readonly oldestAt: Date | null;
  readonly href: string;
}

interface DeskSpec {
  readonly key: DeskItem["key"];
  readonly capability: PlatformCapability;
  readonly label: readonly [one: string, many: string];
  readonly href: string;
  readonly table: PgTable;
  readonly at: PgColumn;
  readonly open: SQL;
}

const DESKS: readonly DeskSpec[] = [
  {
    key: "passes",
    capability: "platform.pass",
    label: ["pass request", "pass requests"],
    href: "/admin/passes",
    table: passUpgradeRequests,
    at: passUpgradeRequests.createdAt,
    open: isNull(passUpgradeRequests.resolvedAt),
  },
  {
    key: "demos",
    capability: "platform.demo",
    label: ["demo request", "demo requests"],
    href: "/admin/demos",
    table: demoRequests,
    at: demoRequests.createdAt,
    open: isNull(demoRequests.contactedAt),
  },
  {
    key: "erasure",
    capability: "platform.privacy",
    label: ["erasure request", "erasure requests"],
    href: "/admin/erasure",
    table: erasureRequests,
    at: erasureRequests.requestedAt,
    open: eq(erasureRequests.status, "requested"),
  },
  {
    key: "reports",
    capability: "platform.support",
    label: ["new problem report", "new problem reports"],
    href: "/admin/reports",
    table: problemReports,
    at: problemReports.createdAt,
    open: eq(problemReports.status, "new"),
  },
  {
    key: "reviews",
    capability: "platform.support",
    label: ["review awaiting moderation", "reviews awaiting moderation"],
    href: "/admin/reviews",
    table: reviews,
    at: reviews.createdAt,
    open: eq(reviews.status, "pending"),
  },
  {
    key: "review-reports",
    capability: "platform.support",
    label: ["reported review", "reported reviews"],
    href: "/admin/reviews",
    table: reviewReports,
    at: reviewReports.createdAt,
    open: isNull(reviewReports.resolvedAt),
  },
];

export async function deskQueue(
  db: Db,
  held: ReadonlySet<PlatformCapability>,
): Promise<DeskItem[]> {
  const mine = DESKS.filter((desk) => held.has(desk.capability));
  const counted = await Promise.all(
    mine.map(async (desk) => {
      const [row] = await db
        .select({
          n: sql<number>`count(*)::int`,
          oldest: sql<string | null>`min(${desk.at})`,
        })
        .from(desk.table)
        .where(desk.open);
      return {
        key: desk.key,
        label: desk.label,
        href: desk.href,
        count: row?.n ?? 0,
        oldestAt: row?.oldest === null || row?.oldest === undefined ? null : new Date(row.oldest),
      };
    }),
  );
  // Longest-waiting first: the oldest request is the one most likely forgotten.
  return counted
    .filter((item) => item.count > 0)
    .sort((a, b) => (a.oldestAt?.getTime() ?? 0) - (b.oldestAt?.getTime() ?? 0));
}

/** How many desks the viewer holds at all — so an empty card can say "clear". */
export function desksHeld(held: ReadonlySet<PlatformCapability>): number {
  return DESKS.filter((desk) => held.has(desk.capability)).length;
}
