import {
  ButtonLink,
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
  Pill,
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
import { compactINR } from "../../lib/inr";
import type { SeasonOverviewView } from "../../server/competition/actions";
import type { CompetitionSummary } from "../../server/competition/competitions";
import type { SeasonRow } from "../../server/competition/tournament-actions";
import { dateRange, seasonStatusBadge } from "./season-card";
import { seasonJourney } from "./season-journey";

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
  const badge = seasonStatusBadge(season.status, season.settlement);
  const live = overview?.auctionLive === true;
  const isPublic = season.visibility === "public";

  const figures: HeroFigure[] = [
    {
      key: "teams",
      icon: <IconUsers />,
      value: (overview?.teamCount ?? season.counts.teams).toLocaleString("en-IN"),
      label: "Teams",
    },
    ...(overview !== null
      ? [
          {
            key: "players",
            icon: <IconUser />,
            value: overview.approvedPlayers.toLocaleString("en-IN"),
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
            value: compactINR(overview.pursePerTeam),
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
      <div className="tg-feature-top">
        <HeroBanner
          image={coverOf(season)}
          crest={<SeasonCrest name={season.name} logoUrl={overview?.logoUrl ?? null} />}
          // The chip and the menu ride the eyebrow row, right-aligned, so the
          // banner's main column keeps its full width for the four figures.
          eyebrow={
            <div className="sh-eyebrow-row">
              <HeroStatus live={live}>{live ? "Auction live" : badge.label}</HeroStatus>
              <span className="sh-eyebrow-actions">
                {season.orgName !== "" ? <HeroChip>{season.orgName}</HeroChip> : null}
                <PopoverMenu
                  label={`${season.name} actions`}
                  trigger={<IconKebab width={18} height={18} />}
                  triggerClassName="sh-ghost-trigger"
                  items={menu}
                />
              </span>
            </div>
          }
          title={season.name}
          meta={[
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
        />

        <div className="tg-feature-side">
          {season.running ? (
            <Pill tone="green" dot>
              Now running
            </Pill>
          ) : (
            <Pill tone="neutral">Latest season</Pill>
          )}
          {/* Not a heading: the banner beside it already is one, with this name. */}
          <p className="tg-feature-name">{season.name}</p>
          <p className="tg-feature-sub">{tournamentName ?? "One-off season"}</p>
          {when !== null || season.location !== null ? (
            <p className="tg-feature-when">
              {[when, season.location].filter((part) => part !== null).join(" · ")}
            </p>
          ) : null}
          <div className="tg-feature-actions">
            <ButtonLink href={base} variant="secondary" size="touch">
              Open season
              <IconArrowRight size={16} className="icon-trail" />
            </ButtonLink>
            {isPublic ? (
              <ButtonLink href={`/c/${season.slug}`} variant="ghost" size="touch">
                <IconGlobe size={16} />
                Public page
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </div>

      <div className="tg-feature-steps">
        <JourneyStepper
          label={`${season.name} progress`}
          linkComponent={Link}
          steps={steps.map((step): JourneyStep => {
            const href = stepHref[step.key];
            const item: JourneyStep = {
              key: step.key,
              label: step.label,
              state: step.state,
              hint: step.hint,
            };
            return href === undefined ? item : { ...item, href };
          })}
        />
      </div>
    </section>
  );
}
