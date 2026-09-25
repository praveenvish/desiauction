import {
  HeroBanner,
  IconArrowRight,
  IconCalendar,
  IconChevronDown,
  IconGavel,
  IconPin,
  IconUser,
  IconUsers,
  PopoverMenu,
} from "@desiauction/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { HeroFigures, HeroStatus, SeasonCrest } from "../../components/season-hero/season-hero";
import type { SeasonOverviewView } from "../../server/competition/actions";
import { coverOf } from "../tournaments/featured-season";
import { dateRange, seasonStatusBadge } from "../tournaments/season-card";

/**
 * The club hero at the top of an organizer's /home (founder mockup 2): the
 * season this person is working on, its crest and its three figures, and a
 * switcher when they run more than one season.
 *
 * No quote. The mockup carries a club motto; no such field exists, and a line
 * the organizer never wrote is not something this page may put in their mouth.
 */

const AUCTION_WORD: Record<string, string> = {
  scheduled: "Scheduled",
  live: "Live",
  paused: "Paused",
  completed: "Done",
  reconciled: "Done",
};

export interface SwitchableSeason {
  slug: string;
  name: string;
}

export function ClubHero({
  overview,
  seasonsInClub,
  switchable,
  footer,
}: {
  overview: SeasonOverviewView;
  /** How many seasons this season's club runs — the line under the name. */
  seasonsInClub: number;
  /** Every season the switcher may offer; the switcher hides with one. */
  switchable: SwitchableSeason[];
  /** Along the hero's bottom edge: the season's journey rail. */
  footer?: ReactNode;
}) {
  const season = overview.competition;
  const when = dateRange(season.startsOn, season.endsOn);
  const badge = seasonStatusBadge(
    season.status,
    overview.settlement === null
      ? null
      : overview.settlement.status === "settled" || overview.settlement.status === "closed"
        ? "settled"
        : "settling",
    overview.auctionStatus === "completed" || overview.auctionStatus === "reconciled",
  );
  const live = overview.auctionLive;
  return (
    <div className="home-hero">
      <HeroBanner
        sideAlign="start"
        testId="home-club-hero"
        {...(footer !== undefined ? { footer } : {})}
        image={coverOf(season)}
        crest={<SeasonCrest name={season.name} logoUrl={overview.logoUrl} />}
        eyebrow={<HeroStatus live={live}>{live ? "Auction live" : badge.label}</HeroStatus>}
        title={
          <Link href={`/seasons/${season.slug}`} className="home-hero-link">
            {season.name}
          </Link>
        }
        meta={[
          ...(overview.orgName !== ""
            ? [
                <>
                  {overview.orgName} · {seasonsInClub} season{seasonsInClub === 1 ? "" : "s"}
                </>,
              ]
            : []),
          ...(when !== null
            ? [
                <>
                  <IconCalendar />
                  {when}
                </>,
              ]
            : []),
          ...(season.location !== null
            ? [
                <>
                  <IconPin />
                  {season.location}
                </>,
              ]
            : []),
          <HeroFigures
            key="figures"
            label={`${season.name} at a glance`}
            figures={[
              {
                key: "teams",
                icon: <IconUsers />,
                value: overview.teamCount.toLocaleString("en-IN"),
                label: "Teams",
              },
              {
                key: "players",
                icon: <IconUser />,
                value: overview.approvedPlayers.toLocaleString("en-IN"),
                label: "Players",
              },
              {
                key: "auction",
                icon: <IconGavel />,
                value:
                  overview.auctionStatus === null
                    ? "Not set"
                    : (AUCTION_WORD[overview.auctionStatus] ?? "Set up"),
                label: "Auction night",
              },
            ]}
          />,
        ]}
        actions={
          switchable.length > 1 ? (
            <PopoverMenu
              label="Switch season"
              trigger={
                <>
                  <span className="home-hero-switch">{season.name}</span>
                  <IconChevronDown size={16} />
                </>
              }
              triggerClassName="sh-ghost-trigger"
              items={switchable.map((row) => ({
                key: row.slug,
                label: row.slug === season.slug ? `${row.name} (showing)` : row.name,
                href: `/home?season=${encodeURIComponent(row.slug)}`,
              }))}
            />
          ) : (
            <Link href={`/seasons/${season.slug}`} className="sh-ghost">
              Open season
              <IconArrowRight size={14} />
            </Link>
          )
        }
      />
    </div>
  );
}
