import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, ButtonLink, Card, EmptyState, Money, PageHeader, SectionHeader } from "@desiauction/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { auctionDashboard } from "../../server/auction/actions";
import { currentSession } from "../../server/auth/actions";
import { competitionsView, registrationDashboard } from "../../server/competition/actions";
import { organizerScheduleView } from "../../server/competition/fixture-actions";
import { myRegistrations } from "../../server/competition/public";
import { homeDashboard } from "../../server/home/dashboard";
import { HomeShortcuts } from "./home-shortcuts";
import "./home.css";

export const metadata = { title: "Home · DesiAuction" };

const REG_TONE: Record<string, "info" | "success" | "warning" | "danger" | "neutral"> = {
  submitted: "info",
  approved: "success",
  waitlisted: "warning",
  rejected: "danger",
  withdrawn: "neutral",
  draft: "neutral",
};

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

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
  calendar: (
    <path
      d="M7 3v4M17 3v4M4 9h16M5 5h14v16H5z"
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
} as const;

function Glyph({ d }: { d: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      {d}
    </svg>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
  href,
  hint,
}: {
  label: string;
  value: string;
  tone: string;
  icon: ReactNode;
  href: string;
  hint?: string;
}) {
  return (
    <Link href={href} className="home-tile">
      <span className={`home-tile-ic home-tile-ic--${tone}`}>{icon}</span>
      <span className="home-tile-body">
        <span className="home-tile-label">{label}</span>
        <span className="home-tile-value">{value}</span>
        {hint !== undefined ? <span className="home-tile-hint">{hint}</span> : null}
      </span>
    </Link>
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

function humanizeAction(action: string): string {
  const tail = action.split(".").pop() ?? action;
  const words = tail
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

/** Build a polyline `points` string for a 7-value series. */
function points(series: number[], max: number): string {
  const x0 = 42;
  const x1 = 448;
  const yTop = 18;
  const yBase = 150;
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
          href: `/competitions/${competition.slug}/registrations`,
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
              ? `/competitions/${competition.slug}/readiness`
              : `/competitions/${competition.slug}/auction`,
        });
      }
    }
  }

  const greeting = greetingFor(new Date(), session.name);
  const isEmpty =
    view.orgs.length === 0 && view.competitions.length === 0 && registrationsMine.length === 0;
  const chartMax = Math.max(...dash.money.thisWeek, ...dash.money.lastWeek, 1);

  return (
    <main className="home">
      <PageHeader
        title={greeting}
        subtitle="Here's what's happening across your competitions."
        actions={
          view.orgs.length > 0 ? (
            <ButtonLink href="/competitions">Create a competition</ButtonLink>
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
          {attention.length > 0 ? (
            <Card data-testid="attention-queue" className="home-attention-card">
              <SectionHeader title="Needs attention" />
              <ul className="home-attention-list">
                {attention.map((row) => (
                  <li key={row.key}>
                    <Link href={row.href} className="home-attention-row">
                      <span className="home-attention-label">{row.label}</span>
                      <span className="home-attention-detail">{row.detail} →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card data-testid="attention-queue">
              <SectionHeader title="Needs attention" />
              <p className="home-hint">All clear — nothing is waiting on you.</p>
            </Card>
          )}

          <div className="home-stats" data-testid="home-stats">
            <StatCard
              label="Total Competitions"
              value={String(dash.stats.competitions)}
              tone="accent"
              icon={<Glyph d={G.trophy} />}
              href="/competitions"
            />
            <StatCard
              label="Total Registrations"
              value={dash.stats.registrations.toLocaleString("en-IN")}
              tone="green"
              icon={<Glyph d={G.users} />}
              href="/competitions"
            />
            <StatCard
              label="Active Auctions"
              value={String(dash.stats.activeAuctions)}
              tone="gold"
              icon={<Glyph d={G.gavel} />}
              href="/competitions"
            />
            <StatCard
              label="Collected"
              value={rupeesShort(dash.stats.collectedPaise)}
              tone="info"
              icon={<Glyph d={G.rupee} />}
              href="/money"
            />
            <StatCard
              label="Total Bids"
              value={dash.stats.bids.toLocaleString("en-IN")}
              tone="violet"
              icon={<Glyph d={G.chart} />}
              href="/competitions"
            />
          </div>

          <div className="home-row home-row--a">
            {/* ---- money overview ---- */}
            <Card className="home-panel">
              <div className="home-panel-head">
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
              <svg className="home-chart" viewBox="0 0 470 178" role="img" aria-label="Collected per day">
                <defs>
                  <linearGradient id="home-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--accent)" stopOpacity="0.26" />
                    <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[18, 51, 84, 117, 150].map((y) => (
                  <line
                    key={y}
                    x1="42"
                    y1={y}
                    x2="448"
                    y2={y}
                    stroke="var(--border-subtle)"
                    strokeWidth="1"
                  />
                ))}
                <polygon
                  fill="url(#home-area)"
                  points={`42,150 ${points(dash.money.thisWeek, chartMax)} 448,150`}
                />
                <polyline
                  fill="none"
                  stroke="var(--text-muted)"
                  strokeWidth="2"
                  strokeDasharray="4 4"
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
                    x={42 + index * ((448 - 42) / 6)}
                    y="170"
                    fill="var(--text-muted)"
                    fontSize="10"
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                ))}
              </svg>
              <div className="home-money-foot">
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

            {/* ---- active auctions ---- */}
            <Card className="home-panel">
              <div className="home-panel-head">
                <SectionHeader title="Active auctions" />
                <Link href="/competitions" className="home-more">
                  View all
                </Link>
              </div>
              {dash.auctions.length === 0 ? (
                <p className="home-hint">No auction is live or scheduled right now.</p>
              ) : (
                <ul className="home-auctions">
                  {dash.auctions.map((auction) => (
                    <li key={auction.auctionId}>
                      <Link
                        href={`/competitions/${auction.competitionSlug}/auction`}
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

            {/* ---- upcoming events ---- */}
            <Card className="home-panel">
              <div className="home-panel-head">
                <SectionHeader title="Upcoming events" />
              </div>
              {schedule.length === 0 ? (
                <p className="home-hint">Nothing scheduled yet.</p>
              ) : (
                <ul className="home-events">
                  {schedule.slice(0, 4).map((fixture) => {
                    const when =
                      fixture.kickoffAt !== null ? new Date(fixture.kickoffAt) : null;
                    return (
                      <li key={fixture.id}>
                        <Link
                          href={`/competitions/${fixture.competitionSlug}/fixtures`}
                          className="home-event"
                        >
                          <span className="home-event-date">
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
          </div>

          <div className="home-row home-row--b">
            {/* ---- top competitions ---- */}
            <Card className="home-panel home-panel--flush">
              <div className="home-panel-head home-panel-head--pad">
                <SectionHeader title="Top competitions" />
                <Link href="/competitions" className="home-more">
                  View all
                </Link>
              </div>
              <div className="home-table-wrap">
                <table className="home-table" data-testid="home-competitions">
                  <thead>
                    <tr>
                      <th>Competition</th>
                      <th>Teams</th>
                      <th>Players</th>
                      <th className="home-num">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dash.top.map((row) => (
                      <tr key={row.slug}>
                        <td>
                          <Link href={`/competitions/${row.slug}`} className="home-tcell">
                            <span className="home-crest home-crest--sm" aria-hidden>
                              {monogram(row.name)}
                            </span>
                            <span className="home-tcell-text">
                              <strong>{row.name}</strong>
                              <span>{rupeesShort(row.collectedPaise)} collected</span>
                            </span>
                          </Link>
                        </td>
                        <td className="home-mono">{row.teams}</td>
                        <td className="home-mono">{row.registrations}</td>
                        <td className="home-num">
                          <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ---- quick actions ---- */}
            <Card className="home-panel">
              <div className="home-panel-head">
                <SectionHeader title="Quick actions" />
              </div>
              <div className="home-actions">
                <Link href="/competitions" className="home-action">
                  <span className="home-action-ic home-tile-ic--accent">
                    <Glyph d={G.trophy} />
                  </span>
                  <b>New competition</b>
                </Link>
                <Link href="/orgs" className="home-action">
                  <span className="home-action-ic home-tile-ic--info">
                    <Glyph d={G.users} />
                  </span>
                  <b>Organizations</b>
                </Link>
                <Link href="/competitions" className="home-action">
                  <span className="home-action-ic home-tile-ic--gold">
                    <Glyph d={G.gavel} />
                  </span>
                  <b>Run an auction</b>
                </Link>
                <Link href="/competitions" className="home-action">
                  <span className="home-action-ic home-tile-ic--green">
                    <Glyph d={G.check} />
                  </span>
                  <b>Review players</b>
                </Link>
                <Link href="/money" className="home-action">
                  <span className="home-action-ic home-tile-ic--violet">
                    <Glyph d={G.rupee} />
                  </span>
                  <b>Money</b>
                </Link>
                <Link href="/help" className="home-action">
                  <span className="home-action-ic home-tile-ic--teal">
                    <Glyph d={G.doc} />
                  </span>
                  <b>Help centre</b>
                </Link>
              </div>
            </Card>

            {/* ---- recent activity ---- */}
            <Card className="home-panel">
              <div className="home-panel-head">
                <SectionHeader title="Recent activity" />
                <Link href="/inbox" className="home-more">
                  View all
                </Link>
              </div>
              {dash.activity.length === 0 ? (
                <p className="home-hint">Nothing has happened yet.</p>
              ) : (
                <ul className="home-feed">
                  {dash.activity.map((row) => (
                    <li key={row.id} className="home-feed-row">
                      <span className="home-feed-ic" aria-hidden>
                        <Glyph d={G.check} />
                      </span>
                      <span className="home-feed-text">
                        <strong>{humanizeAction(row.action)}</strong>
                        <span>{row.action.split(".")[0]}</span>
                      </span>
                      <span className="home-feed-time">{ago(row.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
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
                <ul className="home-attention-list">
                  {registrationsMine.map((registration) => (
                    <li key={registration.competitionSlug}>
                      <Link
                        href={`/competitions/${registration.competitionSlug}/register`}
                        className="home-attention-row"
                      >
                        <span className="home-attention-label">
                          {registration.competitionName}
                          <Badge tone={REG_TONE[registration.status] ?? "neutral"}>
                            {registration.status}
                          </Badge>
                        </span>
                        <span className="home-attention-detail">
                          {registration.orgName} · {registration.role.replace(/_/g, " ")} ·{" "}
                          {registration.number}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : null}

          <SectionHeader title="Your organizations" />
          <div className="home-orgs" data-testid="home-orgs">
            {view.orgs.map((org) => (
              <span key={org.id} className="home-org">
                <span className="home-crest home-crest--sm" aria-hidden>
                  {monogram(org.name)}
                </span>
                <strong>{org.name}</strong>
              </span>
            ))}
            <Link href="/orgs" className="home-org home-org--ghost">
              <span className="home-org-plus" aria-hidden>
                +
              </span>
              <strong>Manage organizations</strong>
            </Link>
          </div>
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
