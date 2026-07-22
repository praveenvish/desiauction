import type { OutcomeMetrics } from "@desiauction/core";
import { Badge, Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import type { PlatformOverview } from "../../server/admin/views";
import { ReadOnlyNotice, RelativeTime, statusTone } from "./admin-ui";

function pct(rate: number): number {
  return Math.round(rate * 100);
}

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
  const { totals, runner, followers, attention, recent } = overview;
  return (
    <>
      <ReadOnlyNotice />

      <section aria-labelledby="admin-totals">
        <h2 className="admin-section-title" id="admin-totals">
          The platform
        </h2>
        <div className="stat-row">
          <Tile label="Organizations" value={totals.orgs} href="/admin/orgs" />
          <Tile label="Competitions" value={totals.competitions} />
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
          <Tile label="Competitions created" value={outcomes.competitionsCreated} />
          <Tile label="Cloned (run it again)" value={outcomes.competitionsCloned} />
          <Tile label="Clone share %" value={pct(outcomes.cloneAdoptionRate)} />
          <Tile label="Repeat orgs" value={outcomes.orgsRepeating} />
          <Tile label="Repeat org rate %" value={pct(outcomes.repeatOrgRate)} />
          <Tile label="Registrations" value={outcomes.registrationsSubmitted} />
          <Tile label="Players placed" value={outcomes.playersAssigned} />
        </div>
      </section>

      <div className="admin-grid">
        <Card>
          <h2 className="admin-section-title">Auctions</h2>
          <StatusList lines={overview.auctionsByStatus} empty="No auction has been created yet." />
        </Card>
        <Card>
          <h2 className="admin-section-title">Settlements</h2>
          <StatusList lines={overview.casesByStatus} empty="No settlement case has been opened." />
        </Card>
        <Card>
          <h2 className="admin-section-title">System status</h2>
          <div className="admin-health-org">
            <div className="admin-health-row">
              <span>Job runner</span>
              <Badge tone={runner.healthy ? "success" : "danger"}>
                {runner.healthy ? "Healthy" : `${String(runner.jobs.dead)} dead`}
              </Badge>
            </div>
            <div className="admin-chips">
              {Object.entries(runner.jobs).map(([state, count]) => (
                <Badge key={state} tone={state === "dead" && count > 0 ? "danger" : "neutral"}>
                  {state} {count}
                </Badge>
              ))}
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
            </Link>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="admin-section-title">Attention queue</h2>
        {attention.length === 0 ? (
          <EmptyState
            title="Nothing needs a human"
            description="No dead jobs, no stalled ingest, no discrepant case, no failed delivery."
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
                    Open the console →
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
      <span className="stat-value">{value}</span>
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

function StatusList({
  lines,
  empty,
}: {
  lines: readonly { status: string; count: number }[];
  empty: string;
}) {
  if (lines.length === 0) {
    return <EmptyState title="Nothing yet" description={empty} />;
  }
  return (
    <div className="admin-chips">
      {lines.map((line) => (
        <Badge key={line.status} tone={statusTone(line.status)}>
          {line.status} <span className="admin-count">{line.count}</span>
        </Badge>
      ))}
    </div>
  );
}
