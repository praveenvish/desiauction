import { Badge, Card, SectionHeader, VisuallyHidden, IconArrowRight } from "@desiauction/ui";
import Link from "next/link";

import type { HomeDashboardData } from "../../server/home/dashboard";
import { seasonBadge, monogram } from "./home-parts";
import {
  ATTENTION_SCAN_LIMIT,
  DAY_LABELS,
  G,
  Glyph,
  IST_DAY,
  IST_MONTH,
  MoneyCell,
  PanelEmpty,
  activityLabel,
  activityStyle,
  ago,
  points,
  rupees,
  rupeesShort,
  type AttentionRow,
} from "./organizer-parts";

/**
 * THE SIX PANELS — what is waiting, the money, the seasons, the auctions, the
 * week ahead, and what just happened.
 *
 * Lifted out of `organizer-home.tsx` for the reason /home itself was lifted
 * apart in Phase 3: a file nobody can hold in their head is a file that drifts
 * in the middle. The home now reads as what it is — load, decide, compose —
 * and every panel's own markup is here, where it can be changed without
 * scrolling past five others.
 *
 * Every prop is already computed by the caller. This component decides only
 * layout, never what to show: the `show*` flags encode "has this earned its
 * space", and that is a product decision that stays with the page.
 */
export interface OrganizerPanelsProps {
  dash: HomeDashboardData;
  view: {
    competitions: { id: string; slug: string; name: string; orgName: string; status: string }[];
  };
  schedule: Awaited<
    ReturnType<typeof import("../../server/competition/fixture-actions").organizerScheduleView>
  >;
  restAttention: AttentionRow[];
  unscanned: number;
  chartMax: number;
  showChart: boolean;
  showLeft: boolean;
  showRight: boolean;
  showAttention: boolean;
  showMoney: boolean;
  showSeasons: boolean;
  showAuctions: boolean;
  showEvents: boolean;
  showActivity: boolean;
  otherAuctions: HomeDashboardData["auctions"];
  /** The night in progress, if any — the hero above already renders it. */
  liveRow: HomeDashboardData["auctions"][number] | null;
  /** The season the "open registration" empty state points at. */
  seasonToOpen: { slug: string; name: string } | undefined;
}

export function OrganizerPanels({
  dash,
  view,
  schedule,
  restAttention,
  unscanned,
  chartMax,
  showChart,
  showLeft,
  showRight,
  showAttention,
  showMoney,
  showSeasons,
  showAuctions,
  showEvents,
  showActivity,
  otherAuctions,
  liveRow,
  seasonToOpen,
}: OrganizerPanelsProps) {
  return (
    <>
      {showLeft || showRight ? (
        <div className={`home-main${showLeft && showRight ? "" : " home-main--single"}`}>
          {/* ================= LEFT ================= */}
          {showLeft ? (
            <div className="home-col">
              {showAttention ? (
                <Card
                  data-testid="attention-queue"
                  className={
                    restAttention.length > 0 ? "home-panel home-panel--alert" : "home-panel"
                  }
                >
                  <div className="home-head">
                    <SectionHeader title="Needs attention" />
                    {restAttention.length > 0 ? (
                      <span className="home-count" aria-live="polite">
                        {restAttention.length}
                        <VisuallyHidden>
                          {" "}
                          item{restAttention.length === 1 ? "" : "s"} needing attention
                        </VisuallyHidden>
                      </span>
                    ) : null}
                  </div>
                  {restAttention.length === 0 ? (
                    <PanelEmpty
                      icon={<Glyph d={G.check} />}
                      text="All clear — nothing is waiting on you."
                    />
                  ) : (
                    <ul className="home-list">
                      {restAttention.map((row) => (
                        <li key={row.key}>
                          <Link href={row.href} className="home-attn">
                            <span className="home-ic home-ic--warn home-ic--sm">
                              <Glyph d={G.bolt} />
                            </span>
                            <span className="home-attn-text">
                              <strong>{row.label}</strong>
                              <span>{row.detail}</span>
                            </span>
                            <span className="home-go" aria-hidden>
                              <IconArrowRight size={16} aria-hidden />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* The scan stops at eight and used to say so nowhere, so a
                  portfolio of twenty read as "these eight are all there is". */}
                  {unscanned > 0 ? (
                    <p className="home-scan-note">
                      <span>
                        Checked the {ATTENTION_SCAN_LIMIT} most recent of {view.competitions.length}{" "}
                        seasons.
                      </span>
                      <Link href="/tournaments?view=seasons" className="home-blank-cta">
                        See every season
                      </Link>
                    </p>
                  ) : null}
                </Card>
              ) : null}

              {showMoney ? (
                <Card className="home-panel">
                  <div className="home-head">
                    <SectionHeader title="Money overview" />
                    {showChart ? (
                      <span className="home-legend">
                        <span>
                          <i className="home-dot home-dot--accent" />
                          This week
                        </span>
                        <span>
                          <i className="home-dot home-dot--muted" />
                          Last week
                        </span>
                      </span>
                    ) : null}
                  </div>
                  {showChart ? (
                    <div className="home-chart-wrap">
                      {chartMax > 0 ? (
                        <span className="home-chart-peak">Peak {rupeesShort(chartMax)}/day</span>
                      ) : null}
                      <svg
                        className="home-chart"
                        viewBox="0 0 470 156"
                        role="img"
                        aria-label="Money collected per day, this week versus last week"
                      >
                        <defs>
                          <linearGradient id="home-area" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.24" />
                            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        {[16, 45, 74, 103, 132].map((y) => (
                          <line
                            key={y}
                            x1="44"
                            y1={y}
                            x2="452"
                            y2={y}
                            stroke="var(--border-subtle)"
                            strokeWidth="1"
                          />
                        ))}
                        <polygon
                          fill="url(#home-area)"
                          points={`44,132 ${points(dash.money.thisWeek, chartMax)} 452,132`}
                        />
                        <polyline
                          fill="none"
                          stroke="var(--text-muted)"
                          strokeWidth="2"
                          strokeDasharray="4 5"
                          strokeLinecap="round"
                          points={points(dash.money.lastWeek, chartMax)}
                        />
                        <polyline
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={points(dash.money.thisWeek, chartMax)}
                        />
                        {DAY_LABELS.map((label, index) => (
                          <text
                            key={label}
                            x={44 + index * ((452 - 44) / 6)}
                            y="150"
                            fill="var(--text-muted)"
                            fontSize="10"
                            textAnchor="middle"
                          >
                            {label}
                          </text>
                        ))}
                      </svg>
                      {/* The chart is the only place these seven numbers exist, and
                    a polyline says nothing to a screen reader. */}
                      <VisuallyHidden>
                        Collected per day this week:{" "}
                        {DAY_LABELS.map(
                          (label, index) =>
                            `${label} ${rupeesShort(dash.money.thisWeek[index] ?? 0)}`,
                        ).join(", ")}
                        .
                      </VisuallyHidden>
                    </div>
                  ) : null}
                  <div className="home-money">
                    <MoneyCell href={dash.moneyHref} label="Collected" tone="remaining">
                      {rupees(dash.money.collectedPaise)}
                    </MoneyCell>
                    <MoneyCell href={dash.moneyHref} label="Outstanding" tone="frozen">
                      {rupees(dash.money.outstandingPaise)}
                    </MoneyCell>
                    <MoneyCell href={dash.moneyHref} label="Waived" tone="spent">
                      {rupees(dash.money.waivedPaise)}
                    </MoneyCell>
                  </div>
                </Card>
              ) : null}

              {showSeasons ? (
                <Card className="home-panel home-panel--flush">
                  <div className="home-head home-head--pad">
                    <SectionHeader title="Top seasons" />
                    <Link href="/tournaments?view=seasons" className="home-more">
                      View all
                    </Link>
                  </div>
                  {/* Two renderings, one visible at a time (see home.css).
                  `table-layout: fixed` plus three pinned numeric columns left
                  the season name 0px wide on every phone — 262px of a 316px
                  row was spoken for before the name got a pixel — and
                  `overflow-x: auto` could never rescue it because a
                  `width: 100%` fixed table cannot exceed its wrapper. Below
                  640px the rows become cards with the name first and full
                  width; a horizontally scrolling table would have been the
                  lesser fix and a worse phone. */}
                  <div className="home-table-wrap" data-testid="home-competitions">
                    <table className="home-table">
                      <thead>
                        <tr>
                          <th>Season</th>
                          <th className="home-num">Teams</th>
                          <th className="home-num">Players</th>
                          <th className="home-num">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dash.top.map((row) => {
                          const badge = seasonBadge(row);
                          return (
                            <tr key={row.slug}>
                              <td>
                                <Link href={`/seasons/${row.slug}`} className="home-tcell">
                                  <span className="home-crest home-crest--sm" aria-hidden>
                                    {monogram(row.name)}
                                  </span>
                                  <span className="home-tcell-text">
                                    <strong>{row.name}</strong>
                                    {row.canSeeMoney ? (
                                      <span>{rupeesShort(row.collectedPaise)} collected</span>
                                    ) : null}
                                  </span>
                                </Link>
                              </td>
                              <td className="home-num home-mono">{row.teams}</td>
                              <td className="home-num home-mono">{row.registrations}</td>
                              <td className="home-num">
                                <Badge tone={badge.tone}>{badge.label}</Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <ul className="home-season-cards">
                      {dash.top.map((row) => {
                        const badge = seasonBadge(row);
                        return (
                          <li key={row.slug}>
                            <Link href={`/seasons/${row.slug}`} className="home-season-card">
                              <span className="home-season-top">
                                <span className="home-crest home-crest--sm" aria-hidden>
                                  {monogram(row.name)}
                                </span>
                                <strong className="home-season-name">{row.name}</strong>
                                <Badge tone={badge.tone}>{badge.label}</Badge>
                              </span>
                              <span className="home-season-meta">
                                <span>
                                  <b className="home-mono">{row.teams}</b> team
                                  {row.teams === 1 ? "" : "s"}
                                </span>
                                <span>
                                  <b className="home-mono">{row.registrations}</b> player
                                  {row.registrations === 1 ? "" : "s"}
                                </span>
                                {row.canSeeMoney ? (
                                  <span>{rupeesShort(row.collectedPaise)} collected</span>
                                ) : null}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </Card>
              ) : null}
            </div>
          ) : null}

          {/* ================= RIGHT ================= */}
          {showRight ? (
            <div className="home-col">
              {showAuctions ? (
                <Card className="home-panel">
                  <div className="home-head">
                    <SectionHeader title="Active auctions" />
                    <Link href="/tournaments?view=seasons" className="home-more">
                      View all
                    </Link>
                  </div>
                  {otherAuctions.length === 0 ? (
                    <PanelEmpty
                      icon={<Glyph d={G.gavel} />}
                      text={
                        liveRow === null
                          ? "No auction running yet."
                          : "Nothing else scheduled right now."
                      }
                      ctaHref={
                        seasonToOpen === undefined
                          ? "/tournaments?view=seasons"
                          : `/seasons/${seasonToOpen.slug}/auction`
                      }
                      ctaLabel={liveRow === null ? "Set one up" : "Plan the next one"}
                    />
                  ) : (
                    <ul className="home-list">
                      {otherAuctions.map((auction) => (
                        <li key={auction.auctionId}>
                          <Link
                            href={`/seasons/${auction.competitionSlug}/auction`}
                            className="home-auction"
                          >
                            <span className="home-crest" aria-hidden>
                              {monogram(auction.competitionName)}
                            </span>
                            <span className="home-auction-main">
                              <span className="home-auction-top">
                                <strong>{auction.competitionName}</strong>
                                <span
                                  className={`home-chip home-chip--${auction.status === "live" ? "live" : "soon"}`}
                                >
                                  {auction.status === "live" ? "LIVE" : "SCHEDULED"}
                                </span>
                              </span>
                              <span className="home-auction-meta">
                                <span>
                                  Spend <b>{rupeesShort(auction.spendPaise)}</b>
                                </span>
                                <span>
                                  Lots{" "}
                                  <b>
                                    {auction.lotsSold}/{auction.lotsTotal}
                                  </b>
                                </span>
                              </span>
                              <span className="home-progress" aria-hidden>
                                <i
                                  style={{
                                    width: `${String(auction.lotsTotal === 0 ? 0 : Math.round((auction.lotsSold / auction.lotsTotal) * 100))}%`,
                                  }}
                                />
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ) : null}

              {showEvents ? (
                <Card className="home-panel">
                  <div className="home-head">
                    <SectionHeader title="Upcoming events" />
                  </div>
                  {schedule.length === 0 ? (
                    <PanelEmpty
                      icon={<Glyph d={G.calendar} />}
                      text="No fixtures scheduled."
                      ctaHref={
                        seasonToOpen === undefined
                          ? "/tournaments?view=seasons"
                          : `/seasons/${seasonToOpen.slug}/fixtures`
                      }
                      ctaLabel="Generate a schedule"
                    />
                  ) : (
                    <ul className="home-list">
                      {schedule.slice(0, 5).map((fixture) => {
                        const when =
                          fixture.kickoffAt !== null ? new Date(fixture.kickoffAt) : null;
                        return (
                          <li key={fixture.id}>
                            <Link
                              href={`/seasons/${fixture.competitionSlug}/fixtures`}
                              className="home-event"
                            >
                              <span className="home-date">
                                <b>{when !== null ? IST_DAY.format(when) : "--"}</b>
                                <span>
                                  {when !== null ? IST_MONTH.format(when).toUpperCase() : "TBD"}
                                </span>
                              </span>
                              <span className="home-event-text">
                                <strong>
                                  {fixture.homeTeamName} vs {fixture.awayTeamName}
                                </strong>
                                <span>{fixture.competitionName}</span>
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              ) : null}

              {showActivity ? (
                <Card className="home-panel">
                  <div className="home-head">
                    <SectionHeader title="Recent activity" />
                    <Link href="/inbox" className="home-more">
                      View all
                    </Link>
                  </div>
                  {dash.activity.length === 0 ? (
                    <PanelEmpty icon={<Glyph d={G.bolt} />} text="No activity recorded yet." />
                  ) : (
                    <ul className="home-list">
                      {dash.activity.map((row) => {
                        const style = activityStyle(row.action);
                        return (
                          <li key={row.id} className="home-feed">
                            <span className={`home-ic home-ic--${style.tone} home-ic--sm`}>
                              {style.icon}
                            </span>
                            <span className="home-feed-text">
                              <strong>
                                {row.action === "finops.summary"
                                  ? `${String(row.count)} finance ${row.count === 1 ? "update" : "updates"}`
                                  : activityLabel(row.action)}
                              </strong>
                              {/* Which season the event belongs to — six
                                  anonymous "Paddle granted" lines answer
                                  nothing without it. */}
                              {row.scope !== null ? (
                                <span className="home-feed-scope">{row.scope}</span>
                              ) : null}
                            </span>
                            <span className="home-time">{ago(row.at)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
