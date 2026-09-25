import { ButtonLink, IconArrowRight, SegmentedTabs } from "@desiauction/ui";

/**
 * THE WAY TO A TAB'S SIBLING (RN-1 Phase 4).
 *
 * The organizer's strip went from nine tabs to seven by joining surfaces that
 * answer one question: Players is Registrations AND Lineups, Schedule is
 * Fixtures AND the Table. The merged-away routes still exist and still matter,
 * so each pair links to the other from the PAGE — not from a second tab strip
 * under the first, which would be the third list LAW 1 exists to prevent.
 *
 * WOW PASS (2026-09-25): the single "Lineups →" button took a 56–72px band of
 * its own at the top of four pages. The siblings are now ONE switcher at the
 * left of the page's toolbar row — `PlayersViews` / `ScheduleViews` — which
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

export type PlayersView = "registrations" | "lineups";

/** Registrations | Lineups — the two halves of the Players tab. */
export function PlayersViews({ slug, active }: { slug: string; active: PlayersView }) {
  return (
    <SegmentedTabs
      label="Players views"
      testId="season-views"
      items={[
        {
          key: "registrations",
          label: "Registrations",
          href: `/seasons/${slug}/registrations`,
          active: active === "registrations",
        },
        {
          key: "lineups",
          label: "Lineups",
          href: `/seasons/${slug}/lineups`,
          active: active === "lineups",
        },
      ]}
    />
  );
}

export type ScheduleView = "list" | "calendar" | "match-day" | "table";

/** List | Calendar | Match day | Table — the four faces of the Schedule tab. */
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
