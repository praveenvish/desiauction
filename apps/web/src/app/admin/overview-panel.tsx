import type { OutcomeMetrics } from "@desiauction/core";
import { Badge, Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import { ADMIN_ACCESS_ACTION } from "../../server/admin/capabilities";
import { formatCount, lifecycleLabel, waitedFor } from "../../server/admin/format";
import type { PlatformOverview } from "../../server/admin/views";
import { ReadOnlyNotice, RelativeTime, statusTone } from "./admin-ui";

function pct(rate: number): number {
  return Math.round(rate * 100);
}

const SOURCE_LABELS: Record<string, string> = {
  direct: "no share link",
  other: "unrecognised link",
};

/**
 * PX-9 §1 — the platform overview.
 *
 * Every figure is a row count or a certified snapshot's own field. Nothing on
 * this screen decides whether the platform is healthy: `runnerHealthSnapshot`
 * reports `healthy`, the follower reports `current`, and the attention queue is
 * the union of verdicts other platforms already reached. This renders them.
 */
export function OverviewPanel({
  overview,
  outcomes,
}: {
  overview: PlatformOverview;
  outcomes: OutcomeMetrics;
}) {
  const { totals, runnerVerdict, followers, attention, recent, liveAuctions } = overview;
  return (
    <>
      <ReadOnlyNotice />

      <section aria-labelledby="admin-totals">
        <h2 className="admin-section-title" id="admin-totals">
          The platform
        </h2>
        <div className="stat-row">
          <Tile label="Organizations" value={totals.orgs} href="/admin/orgs" />
          <Tile label="Seasons" value={totals.competitions} />
          <Tile label="Users" value={totals.people} href="/admin/users" />
          <Tile label="Auctions" value={totals.auctions} />
          <Tile label="Settlement cases" value={totals.cases} />
          <Tile label="Finance orgs" value={totals.financeOrgs} href="/admin/health" />
        </div>
      </section>

      <section aria-labelledby="admin-outcomes">
        <h2 className="admin-section-title" id="admin-outcomes">
          Outcomes · last {outcomes.windowDays} days
        </h2>
        <div className="stat-row" data-testid="admin-outcomes">
          <Tile label="Seasons created" value={outcomes.competitionsCreated} />
          <Tile label="Cloned (run it again)" value={outcomes.competitionsCloned} />
          <Tile label="Clone share %" value={pct(outcomes.cloneAdoptionRate)} />
          <Tile label="Repeat orgs" value={outcomes.orgsRepeating} />
          <Tile label="Repeat org rate %" value={pct(outcomes.repeatOrgRate)} />
          <Tile label="Registrations" value={outcomes.registrationsSubmitted} />
          <Tile label="Players placed" value={outcomes.playersAssigned} />
        </div>
        {Object.keys(outcomes.registrationsBySource).length > 0 ? (
          <div className="admin-chips" data-testid="admin-outcomes-sources">
            <span className="admin-meta">Registrations by share source:</span>
            {Object.entries(outcomes.registrationsBySource)
              .sort((a, b) => b[1] - a[1])
              .map(([src, n]) => (
                <Badge key={src} tone="neutral">
                  {/* The badge uppercases, so the fold's two bucket keys read
                      as "OTHER" and "DIRECT" — which name nothing. `other` is a
                      `?ref` the platform does not recognise; `direct` is no
                      `?ref` at all (attribution.ts:44). They are different
                      findings and the chip should say which. */}
                  {SOURCE_LABELS[src] ?? src} <span className="admin-count">{formatCount(n)}</span>
                </Badge>
              ))}
          </div>
        ) : null}
      </section>

      <div className="admin-grid">
        <Card>
          <h2 className="admin-section-title">Auctions</h2>
          <StatusList
            lines={overview.auctionsByStatus}
            liveAuctions={liveAuctions}
            empty="No auction has been created yet."
          />
        </Card>
        <Card>
          <h2 className="admin-section-title">Settlements</h2>
          <StatusList lines={overview.casesByStatus} empty="No settlement case has been opened." />
        </Card>
        <Card>
          <h2 className="admin-section-title">System status</h2>
          <div className="admin-health-org">
            {/* `runnerVerdict`, NOT `runner.healthy`. The snapshot's rule is
                `dead === 0`, which a runner that never runs also satisfies:
                measured at 1,558 queued and 2 done with the oldest job eleven
                days old, it reported HEALTHY in green — three lines above
                "Settlement ingest 2 behind", which was behind because of it. */}
            <div className="admin-health-row">
              <span>Job runner</span>
              <Badge
                tone={runnerVerdict.healthy ? "success" : "danger"}
                data-testid="admin-overview-runner"
              >
                {runnerVerdict.healthy ? "Healthy" : "Not running"}
              </Badge>
            </div>
            {runnerVerdict.detail !== null ? (
              <p className="admin-meta">{runnerVerdict.detail}</p>
            ) : null}
            <div className="admin-chips">
              <Badge
                tone={runnerVerdict.queued > 0 && !runnerVerdict.healthy ? "warning" : "neutral"}
              >
                queued <span className="admin-count">{formatCount(runnerVerdict.queued)}</span>
              </Badge>
              <Badge tone={runnerVerdict.dead > 0 ? "danger" : "neutral"}>
                dead <span className="admin-count">{formatCount(runnerVerdict.dead)}</span>
              </Badge>
              {runnerVerdict.oldestQueuedWaitMs === null ? null : (
                <Badge tone={runnerVerdict.healthy ? "neutral" : "danger"}>
                  oldest waited {waitedFor(runnerVerdict.oldestQueuedWaitMs)}
                </Badge>
              )}
            </div>
            <div className="admin-health-row">
              <span>Settlement ingest</span>
              <Badge tone={followers.behind === 0 ? "success" : "warning"}>
                {followers.behind === 0
                  ? `${String(followers.orgs)} current`
                  : `${String(followers.behind)} behind`}
              </Badge>
            </div>
            <Link href="/admin/health" className="admin-meta">
              Platform health →
            </Link>{" "}
            {/* The door this console lacked. Whether the deployment holds the
                registered DLT ids it needs is a health fact like any other —
                without an id a message shape does not send at all — and it was
                answerable only by reading a running process's environment. */}
            <Link href="/admin/messaging" className="admin-meta" data-testid="admin-messaging-link">
              Messaging →
            </Link>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="admin-section-title">Attention queue</h2>
        {/* Every link here used to read "Open the console →" and point at an
            org console that `platform:admin` cannot open — the grant confers
            zero org capability by design, so each one 404'd for its only
            audience. The links now go where administration can actually go, and
            the sentence says who holds the fix. */}
        <p className="admin-meta">
          Administration cannot act on any of these. Each links to what an administrator can open;
          the repair itself lives in the owning console, under that console&rsquo;s own permissions.
        </p>
        {attention.length === 0 ? (
          <EmptyState
            title="Nothing needs a human"
            description="No dead jobs, no stalled runner, no stuck auction, no discrepant case, no failed delivery."
          />
        ) : (
          <ul className="admin-attention" data-testid="admin-attention">
            {attention.map((row, index) => (
              <li key={`${row.kind}-${String(index)}`}>
                <span className="admin-attention-subject">
                  <span>{row.subject}</span>
                  <span className="admin-attention-kind">
                    {row.kind}
                    {row.orgName !== null ? ` · ${row.orgName}` : ""}
                  </span>
                </span>
                {row.href !== null ? (
                  <Link href={row.href} className="admin-meta">
                    Inspect →
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="admin-section-title">Recent activity</h2>
        {recent.length === 0 ? (
          <EmptyState title="No activity yet" description="The audit log is empty." />
        ) : (
          <>
            <ul className="admin-timeline" data-testid="admin-recent">
              {recent.map((row) => (
                <li key={row.id}>
                  <span>
                    <span className="admin-action">{row.action}</span>
                    <span className="admin-meta"> by {row.actorName ?? row.actor.slice(-6)}</span>
                  </span>
                  <RelativeTime at={row.at} />
                </li>
              ))}
            </ul>
            <Link href="/admin/audit" className="admin-meta">
              Open the audit explorer →
            </Link>{" "}
            {/* Administration records its own page views, so this list would
                otherwise fill with an admin watching themselves refresh. They
                are excluded HERE only, and this link is the disclosure. */}
            <Link
              href={`/admin/audit?action=${ADMIN_ACCESS_ACTION}`}
              className="admin-meta"
              data-testid="admin-access-log-link"
            >
              Administration&rsquo;s own access log →
            </Link>
          </>
        )}
      </Card>
    </>
  );
}

function Tile({ label, value, href }: { label: string; value: number; href?: string }) {
  const tile = (
    <div className="stat-tile">
      {/* 1539 and 1558 were four unbroken digits the eye has to count. */}
      <span className="stat-value">{formatCount(value)}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
  return href === undefined ? (
    tile
  ) : (
    <Link href={href} className="stat-tile-link">
      {tile}
    </Link>
  );
}

/**
 * The `live` row is the one status that cannot be rendered as the enum says.
 *
 * `● LIVE 40`, with a pulsing dot, reads as forty rooms bidding right now. All
 * forty had been sitting `live` for four to ten days: not activity, forty
 * auction nights that ended without anyone closing them. So the count derives
 * from RECENCY and splits, and the pulsing "live" tone is reserved for the
 * auctions that are actually live.
 */
function StatusList({
  lines,
  liveAuctions,
  empty,
}: {
  lines: readonly { status: string; count: number }[];
  liveAuctions?: { total: number; stale: number };
  empty: string;
}) {
  if (lines.length === 0) {
    return <EmptyState title="Nothing yet" description={empty} />;
  }
  return (
    <div className="admin-chips">
      {lines.map((line) => {
        if (line.status === "live" && liveAuctions !== undefined && liveAuctions.stale > 0) {
          const running = liveAuctions.total - liveAuctions.stale;
          return (
            <span key={line.status} className="admin-chips">
              {running > 0 ? (
                <Badge tone="live">
                  live now <span className="admin-count">{formatCount(running)}</span>
                </Badge>
              ) : null}
              <Badge tone="danger" data-testid="admin-stuck-live">
                stuck in live <span className="admin-count">{formatCount(liveAuctions.stale)}</span>
              </Badge>
            </span>
          );
        }
        return (
          <Badge key={line.status} tone={statusTone(line.status)}>
            {lifecycleLabel(line.status)}{" "}
            <span className="admin-count">{formatCount(line.count)}</span>
          </Badge>
        );
      })}
    </div>
  );
}
