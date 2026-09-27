import { ButtonLink, IconArrowRight, SegmentedTabs } from "@desiauction/ui";

/**
 * THE WAY TO A TAB'S SIBLING (RN-1 Phase 4).
 *
 * The organizer's strip went from nine tabs to seven by joining surfaces that
 * answer one question: Schedule is Fixtures, Lineups AND the Table. The merged-away routes still exist and still matter,
 * so each pair links to the other from the PAGE — not from a second tab strip
 * under the first, which would be the third list LAW 1 exists to prevent.
 *
 * WOW PASS (2026-09-25): the single "Lineups →" button took a 56–72px band of
 * its own at the top of four pages. The siblings are now ONE switcher at the
 * left of the page's toolbar row — `ScheduleViews` — which
 * also says which of them you are on. The strip still lights the PARENT for
 * all of them (`claims` in nav.ts).
 */
export function SiblingLink({ href, label }: { href: string; label: string }) {
  return (
    <ButtonLink href={href} variant="secondary" data-testid="season-sibling">
      {label}
      <IconArrowRight size={16} className="icon-trail" />
    </ButtonLink>
  );
}

export type ScheduleView = "matches" | "table";

/**
 * Matches | Table — the two faces of the Schedule tab.
 *
 * 2026-09-27: List, Calendar, Match day and Lineups were four views of the same
 * matches and became one Matches screen (a week strip, the matches by day, and
 * one match's lineups and score in its panel). The table stays its own face:
 * it is what owners and players come for, and it is derived from the results.
 */
export function ScheduleViews({ slug, active }: { slug: string; active: ScheduleView }) {
  const base = `/seasons/${slug}`;
  return (
    <SegmentedTabs
      label="Schedule views"
      testId="season-views"
      items={[
        {
          key: "matches",
          label: "Matches",
          href: `${base}/fixtures`,
          active: active === "matches",
          testId: "open-fixture-list",
        },
        {
          key: "table",
          label: "Table",
          href: `${base}/standings`,
          active: active === "table",
          testId: "open-standings",
        },
      ]}
    />
  );
}
