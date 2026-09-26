import {
  HeroBanner,
  IconArrowRight,
  IconCalendar,
  IconGlobe,
  IconKebab,
  IconPin,
  IconShieldCheck,
  IconUser,
  IconUsers,
  IconWallet,
  JourneyStepper,
  type JourneyStep,
  PopoverMenu,
} from "@desiauction/ui";
import Link from "next/link";

import {
  HeroChip,
  HeroFigures,
  HeroStatus,
  SeasonCrest,
  type HeroFigure,
} from "../../components/season-hero/season-hero";
import { cardAmount } from "../../lib/money";
import type { SeasonOverviewView } from "../../server/competition/actions";
import type { CompetitionSummary } from "../../server/competition/competitions";
import type { SeasonRow } from "../../server/competition/tournament-actions";
import { dateRange, seasonStatusBadge } from "./season-card";
import { seasonJourney } from "./season-journey";
import { formatCount } from "../../lib/plural";

/**
 * The season a reader most likely came here for, drawn as the founder's
 * mockup draws it: a floodlit banner with its figures, a side panel with the
 * way in, and the season's road underneath.
 *
 * Which season: the one running today, else the newest that is still in
 * flight, else the newest of all (`pickFeatured`). The figures come from the
 * season overview's own read — the same gate and the same money rule — so the
 * banner can never show a purse the season page would hide.
 */

/**
 * The season's cover photo. `competitions.cover_url` is being added by another
 * stream; until the summary carries it this answers null and the banner draws
 * its floodlight. When the field lands on the read model it flows through here
 * with no change to the page.
 */
export function coverOf(season: CompetitionSummary & { coverUrl?: string | null }): string | null {
  return season.coverUrl ?? null;
}

const IN_FLIGHT = new Set(["setup", "registration_open", "registration_closed"]);

/** Newest edition first, undated last — the order the index already reads in. */
function byEditionDesc(a: SeasonRow, b: SeasonRow): number {
  if (a.startsOn === b.startsOn) return 0;
  if (a.startsOn === null) return 1;
  if (b.startsOn === null) return -1;
  return a.startsOn > b.startsOn ? -1 : 1;
}

export function pickFeatured(seasons: SeasonRow[]): SeasonRow | null {
  const ordered = [...seasons].sort(byEditionDesc);
  return (
    ordered.find((season) => season.running) ??
    ordered.find((season) => IN_FLIGHT.has(season.status) && season.settlement !== "settled") ??
    ordered[0] ??
    null
  );
}

export function FeaturedSeason({
  season,
  tournamentName,
  overview,
}: {
  season: SeasonRow;
  /** The recurring tournament this is an edition of; null for a one-off. */
  tournamentName: string | null;
  overview: SeasonOverviewView | null;
}) {
  const base = `/seasons/${season.slug}`;
  const when = dateRange(season.startsOn, season.endsOn);
  const badge = seasonStatusBadge(
    season.status,
    season.settlement,
    season.counts.auctionDone === true ||
      overview?.auctionStatus === "completed" ||
      overview?.auctionStatus === "reconciled",
  );
  const live = overview?.auctionLive === true;
  const isPublic = season.visibility === "public";

  const figures: HeroFigure[] = [
    {
      key: "teams",
      icon: <IconUsers />,
      value: formatCount(overview?.teamCount ?? season.counts.teams),
      label: "Teams",
    },
    ...(overview !== null
      ? [
          {
            key: "players",
            icon: <IconUser />,
            value: formatCount(overview.approvedPlayers),
            label: "Players",
          },
        ]
      : []),
    // Money-gated in the read: absent (undefined) for a reader without money
    // sight, null before an auction exists — neither draws a figure.
    ...(overview?.pursePerTeam != null
      ? [
          {
            key: "purse",
            icon: <IconWallet />,
            value: cardAmount(overview.competition.auctionUnit, overview.pursePerTeam),
            label: "Purse per team",
          },
        ]
      : []),
    ...(overview?.squadCap != null
      ? [
          {
            key: "squad",
            icon: <IconShieldCheck />,
            value: `Squad of ${String(overview.squadCap)}`,
            label: "Players per team",
          },
        ]
      : []),
  ];

  const steps = seasonJourney(
    {
      status: season.status,
      teams: overview?.teamCount ?? season.counts.teams,
      registrations: (overview?.approvedPlayers ?? 0) + (overview?.pendingPlayers ?? 0),
      auctionStatus: overview?.auctionStatus ?? null,
      settlement: overview?.settlement?.status ?? season.settlement,
      ...(overview !== null
        ? { auctionUnit: overview.competition.auctionUnit, fixtures: overview.fixtureCount }
        : {}),
    },
    { withTeams: true },
  );
  const stepHref: Record<string, string | undefined> = {
    setup: base,
    teams: `${base}/teams`,
    registration: `${base}/registrations`,
    auction: `${base}/auction`,
    // The Money tab answers 404 without `settlement.view` — no link beats a
    // link to a dead end.
    settlement: overview?.viewer.canSettle === true ? `${base}/money` : undefined,
    fixtures: `${base}/fixtures`,
  };

  const menu = [
    { key: "open", label: "Open season", href: base },
    { key: "teams", label: "Teams", href: `${base}/teams` },
    { key: "registrations", label: "Registrations", href: `${base}/registrations` },
    { key: "auction", label: "Auction", href: `${base}/auction` },
    ...(isPublic ? [{ key: "public", label: "Public page", href: `/c/${season.slug}` }] : []),
  ];

  return (
    <section className="tg-feature" aria-label="Featured season" data-testid="tg-featured">
      {/* One floodlit banner: the season, its figures, the way in, and its road
          along the bottom edge. The white side panel beside it said the name,
          dates and "Open season" a second time, and the stepper under it was a
          third band. */}
      <HeroBanner
        image={coverOf(season)}
        crest={<SeasonCrest name={season.name} logoUrl={overview?.logoUrl ?? null} />}
        sideAlign="start"
        eyebrow={
          <div className="sh-eyebrow-row">
            <HeroStatus
              live={live}
              done={badge.label === "Settled" || badge.label === "Auction done"}
            >
              {live ? "Auction live" : badge.label}
            </HeroStatus>
            {season.running ? <HeroChip>Now running</HeroChip> : null}
          </div>
        }
        title={season.name}
        meta={[
          <>
            {season.orgName !== "" ? season.orgName : null}
            {season.orgName !== "" && tournamentName !== null ? " · " : null}
            {tournamentName ?? (season.orgName === "" ? "One-off season" : null)}
          </>,
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
          <HeroFigures key="figures" figures={figures} label={`${season.name} at a glance`} />,
        ]}
        actions={
          <>
            {isPublic ? (
              <Link href={`/c/${season.slug}`} className="sh-ghost">
                <IconGlobe size={16} />
                Public page
              </Link>
            ) : null}
            <Link href={base} className="sh-ghost tg-feature-open">
              Open season
              <IconArrowRight size={16} />
            </Link>
            <PopoverMenu
              label={`${season.name} actions`}
              trigger={<IconKebab size={16} />}
              triggerClassName="sh-ghost-trigger"
              items={menu}
            />
          </>
        }
        footer={
          <JourneyStepper
            variant="rail"
            label={`${season.name} progress`}
            linkComponent={Link}
            steps={steps.map((step): JourneyStep => {
              const href = stepHref[step.key];
              const item: JourneyStep = {
                key: step.key,
                label: step.label,
                state: step.state,
              };
              return href === undefined ? item : { ...item, href };
            })}
          />
        }
      />
    </section>
  );
}
