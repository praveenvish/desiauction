import { Badge, Card, EmptyState } from "@desiauction/ui";
import Link from "next/link";

import type { OrgHealthRow, PlatformHealth } from "../../../server/admin/views";
import { ReadOnlyNotice } from "../admin-ui";

/**
 * PX-9 §5 — platform health.
 *
 * Every verdict below is a certified snapshot's own field: `runner.healthy`,
 * `follower.current`, `certification.*`, and the compliance queue's items.
 * Administration arranges them and names the org. It grades nothing.
 */
export function HealthPanel({ health }: { health: PlatformHealth }) {
  const { runner, orgs, followers } = health;
  const schedules = runner.schedules;
  return (
    <>
      <ReadOnlyNotice />

      <section aria-labelledby="admin-workers">
        <h2 className="admin-section-title" id="admin-workers">
          Background workers
        </h2>
        <Card>
          <div className="admin-health-row">
            <span>Job runner</span>
            <Badge tone={runner.healthy ? "success" : "danger"} data-testid="admin-runner-health">
              {runner.healthy ? "Healthy" : `${String(runner.jobs.dead)} dead job(s)`}
            </Badge>
          </div>
          <h3 className="admin-section-title">Queues</h3>
          <div className="admin-chips" data-testid="admin-queues">
            {Object.entries(runner.jobs).map(([state, count]) => (
              <Badge key={state} tone={state === "dead" && count > 0 ? "danger" : "neutral"}>
                {state} <span className="admin-count">{count}</span>
              </Badge>
            ))}
          </div>
          <h3 className="admin-section-title">Schedules</h3>
          {schedules.length === 0 ? (
            <EmptyState title="No schedules" description="The runner has no registered schedule." />
          ) : (
            <div className="table-scroll">
              <table className="reg-table" data-testid="admin-schedules">
                <thead>
                  <tr>
                    <th scope="col">Slot</th>
                    <th scope="col">Last fired</th>
                    <th scope="col">Next due</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((schedule) => (
                    <tr key={schedule.slot} className="reg-row">
                      <td>
                        <span className="admin-action">{schedule.slot}</span>
                      </td>
                      <td>
                        <span className="admin-meta">
                          {schedule.lastFiredMs === null
                            ? "Never"
                            : new Date(schedule.lastFiredMs).toISOString()}
                        </span>
                      </td>
                      <td>
                        <span className="admin-meta">
                          {new Date(schedule.nextDueMs).toISOString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="admin-followers">
        <h2 className="admin-section-title" id="admin-followers">
          Follower health
        </h2>
        <div className="stat-row">
          <div className="stat-tile">
            <span className="stat-value">{followers.orgs}</span>
            <span className="stat-label">Following orgs</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{followers.current}</span>
            <span className="stat-label">Current</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{followers.behind}</span>
            <span className="stat-label">Behind</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value">{followers.totalBehind}</span>
            <span className="stat-label">Events behind</span>
          </div>
        </div>
      </section>

      {orgs.length === 0 ? (
        <Card>
          <EmptyState
            title="No organization has declared finance"
            description="Storage, dispatch, exports and certification begin once an organization declares a financial profile."
          />
        </Card>
      ) : (
        orgs.map((org) => <OrgHealth key={org.orgId} org={org} />)
      )}
    </>
  );
}

function OrgHealth({ org }: { org: OrgHealthRow }) {
  const { follower, provider, certification, queue } = org;
  return (
    <Card data-testid={`admin-health-${org.orgSlug}`}>
      <div className="admin-health-row">
        <h2 className="admin-section-title">{org.orgName}</h2>
        <Link href={`/org/${org.orgSlug}/money`} className="admin-meta">
          Finance console →
        </Link>
      </div>
      <div className="admin-health-org">
        <div className="admin-health-row">
          <span>Settlement ingest</span>
          <Badge tone={follower.current ? "success" : "warning"}>
            {follower.current
              ? `Current · ${String(follower.streams)} stream(s)`
              : `${String(follower.totalBehind)} event(s) behind`}
          </Badge>
        </div>

        <div className="admin-health-row">
          <span>Certification</span>
          {certification === null ? (
            // Never certified is not a failure — it means the runner has not
            // reached this org yet. Administration says what it sees.
            <Badge tone="neutral">Never certified</Badge>
          ) : (
            <Badge tone={certification.verdict === "PASS" ? "success" : "danger"}>
              {certification.verdict} · {certification.at.toISOString().slice(0, 10)}
            </Badge>
          )}
        </div>
        {certification !== null ? (
          <p className="admin-evidence" title="The digest the runner recorded">
            {certification.digest}
          </p>
        ) : null}

        <div>
          <span className="stat-label">Dispatch channels</span>
          <div className="admin-chips">
            {provider.channels.map((channel) => (
              <Badge
                key={channel.channel}
                tone={!channel.configured ? "neutral" : channel.failed > 0 ? "danger" : "success"}
              >
                {channel.channel}
                {channel.configured
                  ? ` · ${String(channel.confirmed)} confirmed, ${String(channel.failed)} failed`
                  : " · not configured"}
              </Badge>
            ))}
            {provider.deadSendJobs > 0 ? (
              <Badge tone="danger">{provider.deadSendJobs} dead send job(s)</Badge>
            ) : null}
          </div>
        </div>

        <div>
          <span className="stat-label">Recent failures &amp; recovery</span>
          {queue.items.length === 0 ? (
            <p className="admin-meta">Nothing outstanding.</p>
          ) : (
            <ul className="admin-attention">
              {queue.items.map((item, index) => (
                <li key={`${item.kind}-${String(index)}`}>
                  <span className="admin-attention-subject">
                    <span>{item.subject}</span>
                    <span className="admin-attention-kind">{item.kind}</span>
                  </span>
                  {/* The platform's own resolving capability, NAMED not offered:
                      administration shows what would fix this and where it
                      lives; it does not hold the power to run it. */}
                  <span className="admin-meta">Resolved by {item.action}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
