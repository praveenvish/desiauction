import { formatPaiseINR, paise } from "@desiauction/core";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  Money,
  PageHeader,
  SectionHeader,
} from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { auctionDashboard } from "../../server/auction/actions";
import { currentSession } from "../../server/auth/actions";
import { competitionsView, registrationDashboard } from "../../server/competition/actions";
import { organizerScheduleView } from "../../server/competition/fixture-actions";
import { myRegistrations } from "../../server/competition/public";
import { homeDashboard } from "../../server/home/dashboard";
import type { HomeDashboardData, HomeStages } from "../../server/home/dashboard";
import { HomeShortcuts } from "./home-shortcuts";
import "./home.css";

export const metadata = { title: "Home · DesiAuction" };

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const REG_TONE: Record<string, Tone> = {
  submitted: "info",
  approved: "success",
  waitlisted: "warning",
  rejected: "danger",
  withdrawn: "neutral",
  draft: "neutral",
};

function statusTone(status: string): Tone {
  switch (status) {
    case "setup":
      return "info";
    case "registration_open":
      return "success";
    case "registration_closed":
      return "warning";
    default:
      return "neutral";
  }
}

/** Compact label so the status column never truncates in a narrow panel. */
function statusLabel(status: string): string {
  switch (status) {
    case "registration_open":
      return "Open";
    case "registration_closed":
      return "Closed";
    case "setup":
      return "Setup";
    case "draft":
      return "Draft";
    default:
      return status.replace(/_/g, " ");
  }
}

interface AttentionRow {
  key: string;
  label: string;
  detail: string;
  href: string;
}

const ATTENTION_SCAN_LIMIT = 8;

/* ---- glyphs ------------------------------------------------------------- */
const G = {
  trophy: (
    <path
      d="M7 4h10v3a5 5 0 0 1-10 0V4ZM4 5H2v2a3 3 0 0 0 3 3M20 5h2v2a3 3 0 0 1-3 3M9 15h6v5H9z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  users: (
    <path
      d="M16 11a4 4 0 1 0-8 0M4 20a6 6 0 0 1 16 0"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  ),
  gavel: (
    <path
      d="M4 20 14 10M17 7l-3-3 4-1 3 3-1 4-3-3z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  rupee: (
    <path
      d="M7 6h9M7 10h9M13 6c3 0 4 4 0 4H9l6 8"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  chart: (
    <path
      d="m4 19 5-5 3 3 8-8M14 9h6v6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  check: (
    <path
      d="m9 11 3 3L22 4M21 12v7H3V5h12"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  doc: (
    <path
      d="M6 3h9l5 5v13H6zM14 3v5h5M9 13h6M9 17h6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  bolt: (
    <path
      d="M13 3 5 14h6l-1 7 8-11h-6z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  calendar: (
    <path
      d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
} as const;

function Glyph({ d }: { d: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      {d}
    </svg>
  );
}

/** An empty panel should still sell the next move, not just report nothing. */
function PanelEmpty({
  icon,
  text,
  ctaHref,
  ctaLabel,
}: {
  icon: ReactNode;
  text: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="home-blank">
      <span className="home-blank-ic" aria-hidden>
        {icon}
      </span>
      <p>{text}</p>
      {ctaHref !== undefined && ctaLabel !== undefined ? (
        <Link href={ctaHref} className="home-blank-cta">
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}

function monogram(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "—"
  );
}

function rupees(value: number): string {
  return formatPaiseINR(paise(value));
}

/** Compact INR for tiles: ₹1.2L / ₹48.7L / ₹2.4Cr. */
function rupeesShort(value: number): string {
  const r = value / 100;
  if (r >= 10_000_000) return `₹${(r / 10_000_000).toFixed(r % 10_000_000 === 0 ? 0 : 2)}Cr`;
  if (r >= 100_000) return `₹${(r / 100_000).toFixed(r % 100_000 === 0 ? 0 : 1)}L`;
  if (r >= 1_000) return `₹${(r / 1_000).toFixed(r % 1_000 === 0 ? 0 : 1)}K`;
  return `₹${String(Math.round(r))}`;
}

/** "grant.Issued" -> "Grant issued"; "auction.BidAccepted" -> "Auction bid accepted". */
function activityLabel(action: string): string {
  const parts = action.split(".");
  const domain = parts[0] ?? action;
  const tail = parts.slice(1).join(" ");
  const head = domain.charAt(0).toUpperCase() + domain.slice(1);
  if (tail === "") return head;
  const words = tail
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]/g, " ")
    .toLowerCase();
  return `${head} ${words}`;
}

const ACTIVITY_STYLE: Record<string, { tone: string; icon: ReactNode }> = {
  auction: { tone: "gold", icon: <Glyph d={G.gavel} /> },
  registration: { tone: "green", icon: <Glyph d={G.check} /> },
  competition: { tone: "accent", icon: <Glyph d={G.trophy} /> },
  team: { tone: "info", icon: <Glyph d={G.users} /> },
  org: { tone: "info", icon: <Glyph d={G.users} /> },
  grant: { tone: "violet", icon: <Glyph d={G.users} /> },
  auth: { tone: "violet", icon: <Glyph d={G.users} /> },
  profile: { tone: "violet", icon: <Glyph d={G.users} /> },
  settlement: { tone: "info", icon: <Glyph d={G.rupee} /> },
  payment: { tone: "info", icon: <Glyph d={G.rupee} /> },
  finops: { tone: "teal", icon: <Glyph d={G.doc} /> },
};

function activityStyle(action: string): { tone: string; icon: ReactNode } {
  return (
    ACTIVITY_STYLE[action.split(".")[0] ?? ""] ?? { tone: "accent", icon: <Glyph d={G.bolt} /> }
  );
}

function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}

/** Build a polyline `points` string for a 7-value series. */
function points(series: number[], max: number): string {
  const x0 = 44;
  const x1 = 452;
  const yTop = 16;
  const yBase = 132;
  const step = (x1 - x0) / 6;
  return series
    .map((value, index) => {
      const x = x0 + index * step;
      const y = yBase - (max === 0 ? 0 : (value / max) * (yBase - yTop));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The platform in one row. Every tournament walks these four stages, so the
 * strip doubles as an explanation of what DesiAuction does and a read on where
 * this organiser's competitions actually are.
 *
 * Each stage carries the number that matters AT that stage. That is deliberate:
 * a separate grid of stat tiles sat directly under this strip and restated the
 * same facts in different units — "Auction night 0" over "Active auctions 0",
 * "Settlement 1" over "Collected", and a "Registrations" tile counting players
 * beside a "Registration" stage counting competitions. Nine cards, five facts.
 * The counts belong to the stages that own them.
 */
function lifecycleFor(dash: HomeDashboardData): {
  key: keyof HomeStages;
  name: string;
  count: number;
  detail: string;
  tone: string;
  icon: ReactNode;
  href: string;
}[] {
  const { setup, registration, auction, settlement } = dash.stages;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return [
    {
      key: "setup",
      name: "Set up",
      count: setup.competitions,
      detail:
        setup.competitions === 0
          ? "Nothing in setup"
          : `${String(setup.teams)} ${plural(setup.teams, "team", "teams")} added`,
      tone: "info",
      icon: <Glyph d={G.trophy} />,
      href: "/seasons",
    },
    {
      key: "registration",
      name: "Registration",
      count: registration.competitions,
      detail:
        registration.competitions === 0
          ? "Nobody taking entries"
          : `${registration.registered.toLocaleString("en-IN")} registered · ${registration.approved.toLocaleString("en-IN")} approved`,
      tone: "green",
      icon: <Glyph d={G.check} />,
      href: "/seasons",
    },
    {
      key: "auction",
      name: "Auction night",
      count: auction.competitions,
      detail:
        auction.live > 0
          ? `${String(auction.live)} live right now`
          : auction.competitions === 0
            ? "Nothing at auction"
            : auction.bids > 0
              ? `${auction.bids.toLocaleString("en-IN")} ${plural(auction.bids, "bid", "bids")} placed`
              : "Ready to run",
      tone: "gold",
      icon: <Glyph d={G.gavel} />,
      href: "/seasons",
    },
    {
      key: "settlement",
      name: "Settlement",
      count: settlement.competitions,
      detail:
        settlement.competitions === 0
          ? "Nothing due yet"
          : settlement.outstandingPaise > 0
            ? `${rupeesShort(settlement.outstandingPaise)} still outstanding`
            : `${rupeesShort(settlement.collectedPaise)} collected · settled`,
      tone: "violet",
      icon: <Glyph d={G.rupee} />,
      href: "/money",
    },
  ];
}

export default async function HomePage() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login?next=/home");
  }
  if (session.name === null || session.name.trim() === "") {
    redirect("/onboarding");
  }
  const [view, schedule, registrationsMine, dash] = await Promise.all([
    competitionsView(),
    organizerScheduleView(),
    myRegistrations(session.personId),
    homeDashboard(),
  ]);

  const attention: AttentionRow[] = [];
  for (const competition of view.competitions.slice(0, ATTENTION_SCAN_LIMIT)) {
    if (competition.status === "registration_open") {
      const dashboard = await registrationDashboard(competition.slug, {});
      if (dashboard !== null && dashboard.viewer.canReview && dashboard.stats.submitted > 0) {
        attention.push({
          key: `reg-${competition.id}`,
          label: `${String(dashboard.stats.submitted)} registration${dashboard.stats.submitted === 1 ? "" : "s"} to review`,
          detail: competition.name,
          href: `/seasons/${competition.slug}/registrations`,
        });
      }
    } else if (competition.status === "registration_closed") {
      const dashboard = await auctionDashboard(competition.slug);
      if (dashboard !== null && dashboard.viewer.canConduct && dashboard.view === null) {
        const blockers = dashboard.ready.checks.filter((check) => !check.pass).length;
        attention.push({
          key: `auction-${competition.id}`,
          label:
            blockers > 0
              ? `Auction readiness: ${String(blockers)} blocker${blockers === 1 ? "" : "s"}`
              : "Ready — create the auction",
          detail: competition.name,
          href:
            blockers > 0
              ? `/seasons/${competition.slug}/readiness`
              : `/seasons/${competition.slug}/auction`,
        });
      }
    }
  }

  const greeting = greetingFor(new Date(), session.name);
  const isEmpty =
    view.orgs.length === 0 && view.competitions.length === 0 && registrationsMine.length === 0;
  const chartMax = Math.max(...dash.money.thisWeek, ...dash.money.lastWeek, 0);
  const openCount = view.competitions.filter(
    (competition) => competition.status === "registration_open",
  ).length;
  const liveCount = dash.auctions.filter((auction) => auction.status === "live").length;

  // Portfolio context belongs in the header line, not in a card of its own.
  const headline = [
    `${String(dash.stats.competitions)} competition${dash.stats.competitions === 1 ? "" : "s"}`,
    ...(openCount > 0 ? [`${String(openCount)} accepting entries`] : []),
    ...(liveCount > 0 ? [`${String(liveCount)} auction live now`] : []),
  ].join(" · ");

  return (
    <main className="home">
      <PageHeader
        title={greeting}
        subtitle={headline}
        actions={
          view.orgs.length > 0 ? (
            <ButtonLink href="/seasons">Create a season</ButtonLink>
          ) : undefined
        }
      />

      {isEmpty ? (
        <Card>
          <EmptyState
            headingLevel={2}
            title="Welcome to DesiAuction"
            description="Your auction night starts with an organization."
            action={<ButtonLink href="/orgs">Create your organization</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          {/* ---- lifecycle: what the platform does, and where your work sits ---- */}
          <section className="home-flow" aria-label="Season lifecycle">
            {lifecycleFor(dash).map((stage, index) => {
              const count = stage.count;
              return (
                <Link
                  key={stage.key}
                  href={stage.href}
                  className={`home-step${count > 0 ? " home-step--on" : ""}`}
                  style={{ ["--step" as string]: String(index + 1) }}
                >
                  <span className={`home-ic home-ic--${stage.tone} home-ic--sm`}>{stage.icon}</span>
                  <span className="home-step-text">
                    <span className="home-step-head">
                      <span className="home-step-name">{stage.name}</span>
                      <span className="home-step-count">{count}</span>
                    </span>
                    <span className="home-step-blurb">{stage.detail}</span>
                  </span>
                </Link>
              );
            })}
          </section>

          <div className="home-main">
            {/* ================= LEFT ================= */}
            <div className="home-col">
              <Card
                data-testid="attention-queue"
                className={attention.length > 0 ? "home-panel home-panel--alert" : "home-panel"}
              >
                <div className="home-head">
                  <SectionHeader title="Needs attention" />
                  {attention.length > 0 ? (
                    <span className="home-count">{attention.length}</span>
                  ) : null}
                </div>
                {attention.length === 0 ? (
                  <PanelEmpty icon={<Glyph d={G.check} />} text="All clear — nothing is waiting on you." />
                ) : (
                  <ul className="home-list">
                    {attention.map((row) => (
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
                            →
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="home-panel">
                <div className="home-head">
                  <SectionHeader title="Money overview" />
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
                </div>
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
                </div>
                <div className="home-money">
                  <Link href="/money" className="home-money-cell">
                    <span className="home-money-label">Collected</span>
                    <Money tone="remaining">{rupees(dash.money.collectedPaise)}</Money>
                  </Link>
                  <Link href="/money" className="home-money-cell">
                    <span className="home-money-label">Outstanding</span>
                    <Money tone="frozen">{rupees(dash.money.outstandingPaise)}</Money>
                  </Link>
                  <Link href="/money" className="home-money-cell">
                    <span className="home-money-label">Waived</span>
                    <Money tone="spent">{rupees(dash.money.waivedPaise)}</Money>
                  </Link>
                </div>
              </Card>

              <Card className="home-panel home-panel--flush">
                <div className="home-head home-head--pad">
                  <SectionHeader title="Top seasons" />
                  <Link href="/seasons" className="home-more">
                    View all
                  </Link>
                </div>
                <div className="home-table-wrap">
                  <table className="home-table" data-testid="home-competitions">
                    <thead>
                      <tr>
                        <th>Season</th>
                        <th className="home-num">Teams</th>
                        <th className="home-num">Players</th>
                        <th className="home-num">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dash.top.map((row) => (
                        <tr key={row.slug}>
                          <td>
                            <Link href={`/seasons/${row.slug}`} className="home-tcell">
                              <span className="home-crest home-crest--sm" aria-hidden>
                                {monogram(row.name)}
                              </span>
                              <span className="home-tcell-text">
                                <strong>{row.name}</strong>
                                <span>{rupeesShort(row.collectedPaise)} collected</span>
                              </span>
                            </Link>
                          </td>
                          <td className="home-num home-mono">{row.teams}</td>
                          <td className="home-num home-mono">{row.registrations}</td>
                          <td className="home-num">
                            <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* ================= RIGHT ================= */}
            <div className="home-col">
              <Card className="home-panel">
                <div className="home-head">
                  <SectionHeader title="Active auctions" />
                  <Link href="/seasons" className="home-more">
                    View all
                  </Link>
                </div>
                {dash.auctions.length === 0 ? (
                  <PanelEmpty
                    icon={<Glyph d={G.gavel} />}
                    text="No auction running yet."
                    ctaHref="/seasons"
                    ctaLabel="Set one up"
                  />
                ) : (
                  <ul className="home-list">
                    {dash.auctions.map((auction) => (
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

              <Card className="home-panel">
                <div className="home-head">
                  <SectionHeader title="Upcoming events" />
                </div>
                {schedule.length === 0 ? (
                  <PanelEmpty
                    icon={<Glyph d={G.calendar} />}
                    text="No fixtures scheduled."
                    ctaHref="/seasons"
                    ctaLabel="Generate a schedule"
                  />
                ) : (
                  <ul className="home-list">
                    {schedule.slice(0, 5).map((fixture) => {
                      const when = fixture.kickoffAt !== null ? new Date(fixture.kickoffAt) : null;
                      return (
                        <li key={fixture.id}>
                          <Link
                            href={`/seasons/${fixture.competitionSlug}/fixtures`}
                            className="home-event"
                          >
                            <span className="home-date">
                              <b>{when !== null ? String(when.getDate()).padStart(2, "0") : "--"}</b>
                              <span>
                                {when !== null
                                  ? when.toLocaleString("en-IN", { month: "short" }).toUpperCase()
                                  : "TBD"}
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
                            <strong>{activityLabel(row.action)}</strong>
                          </span>
                          <span className="home-time">{ago(row.at)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <HomeShortcuts
            competitions={view.competitions.map((competition) => ({
              slug: competition.slug,
              name: competition.name,
              orgName: competition.orgName,
            }))}
          />

          {registrationsMine.length > 0 ? (
            <>
              <SectionHeader title="My registrations" />
              <Card data-testid="home-registrations">
                <ul className="home-list">
                  {registrationsMine.map((registration) => (
                    <li key={registration.competitionSlug}>
                      <Link
                        href={`/seasons/${registration.competitionSlug}/register`}
                        className="home-attn"
                      >
                        <span className="home-crest home-crest--sm" aria-hidden>
                          {monogram(registration.competitionName)}
                        </span>
                        <span className="home-attn-text">
                          <strong>{registration.competitionName}</strong>
                          <span>
                            {registration.orgName} · {registration.role.replace(/_/g, " ")} ·{" "}
                            {registration.number}
                          </span>
                        </span>
                        <Badge tone={REG_TONE[registration.status] ?? "neutral"}>
                          {registration.status}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : null}

        </>
      )}
    </main>
  );
}

function greetingFor(now: Date, name: string | null): string {
  const hour = now.getHours();
  const daypart = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name !== null && name.trim() !== "" ? `${daypart}, ${name.trim()}` : daypart;
}
