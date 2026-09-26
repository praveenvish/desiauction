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

export type ScheduleView = "list" | "calendar" | "match-day" | "lineups" | "table";

/**
 * List | Calendar | Match day | Lineups | Table — the faces of the Schedule tab.
 *
 * ROUND 2 (2026-09-26): Lineups moved here from Players. A lineup is recorded
 * PER MATCH, it is gated on `fixture.manage`, and it is empty until fixtures
 * exist — it answers "who played this match", which is a Schedule question.
 * Under Players it needed a second switcher that sat inside the table card on
 * one page and outside it on the other; here it is one more face of the one
 * switcher every Schedule page already leads with.
 */
export function ScheduleViews({ slug, active }: { slug: string; active: ScheduleView }) {
  const base = `/seasons/${slug}`;
  return (
    <SegmentedTabs
      label="Schedule views"
      testId="season-views"
      items={[
        {
          key: "list",
          label: "List",
          href: `${base}/fixtures`,
          active: active === "list",
          testId: "open-fixture-list",
        },
        {
          key: "calendar",
          label: "Calendar",
          href: `${base}/fixtures/calendar`,
          active: active === "calendar",
          testId: "open-calendar",
        },
        {
          key: "match-day",
          label: "Match day",
          href: `${base}/fixtures/match-day`,
          active: active === "match-day",
          testId: "open-match-day",
        },
        {
          key: "lineups",
          label: "Lineups",
          href: `${base}/lineups`,
          active: active === "lineups",
          testId: "open-lineups",
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
