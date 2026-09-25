import {
  CardGrid,
  EmptyState,
  IconCheckCircle,
  IconClock,
  IconCog,
  IconLayers,
  IconLedger,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
} from "@desiauction/ui";

import { formatCount, waitedFor } from "../../../server/admin/format";
import type { OrgHealthRow, PlatformHealth } from "../../../server/admin/views";
import { ReadOnlyNotice, RelativeTime } from "../admin-ui";

/**
 * PX-9 §5 — platform health.
 *
 * Every verdict below is a certified snapshot's own field: `runner.healthy`,
 * `follower.current`, `certification.*`, and the compliance queue's items.
 * Administration arranges them and names the org. It grades nothing.
 */
export function HealthPanel({ health }: { health: PlatformHealth }) {
  const { runner, runnerVerdict, orgs, followers } = health;
  const schedules = runner.schedules;
  // A SERVER component: it renders once per request and never hydrates, so
  // reading the clock here cannot disagree with a client pass. The rule cannot
  // tell a server component from a client one.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  return (
    <>
      <ReadOnlyNotice />

      <SectionCard
        icon={<IconCog />}
        tone={runnerVerdict.healthy ? "green" : "red"}
        title="Background workers"
        description="The job runner, its queues, and how long the oldest job has waited."
        action={
          <Pill tone={runnerVerdict.healthy ? "green" : "red"} dot testId="admin-runner-health">
            {runnerVerdict.healthy ? "Healthy" : "Not running"}
          </Pill>
        }
      >
        {/* The verdict is CORRECTED against queue age (see `runnerVerdictOf`).
            The snapshot's own rule — `dead === 0` — reports a runner that has
            stopped entirely as healthy, because a runner that never runs
            cannot produce a dead job. */}
        <dl className="admin-kv">
          {runnerVerdict.detail !== null ? (
            <div>
              <dt>Job runner</dt>
              <dd className="admin-meta" data-testid="admin-runner-detail">
                {runnerVerdict.detail}
              </dd>
            </div>
          ) : null}
          <div className="is-block">
            <dt>Queues</dt>
            <dd className="admin-chips" data-testid="admin-queues">
              {Object.entries(runner.jobs).map(([state, count]) => (
                <Pill key={state} tone={state === "dead" && count > 0 ? "red" : "neutral"}>
                  {state} <span className="admin-count">{formatCount(count)}</span>
                </Pill>
              ))}
              {/* Age is the fact that discloses a stopped runner; the queue
                  counts alone never did. */}
              {runnerVerdict.oldestQueuedWaitMs === null ? null : (
                <Pill tone={runnerVerdict.healthy ? "neutral" : "red"}>
                  oldest queued job has waited {waitedFor(runnerVerdict.oldestQueuedWaitMs)}
                </Pill>
              )}
            </dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard
        icon={<IconClock />}
        tone="blue"
        title="Schedules"
        description="When each registered slot last fired and is next due."
        flush
      >
        {schedules.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              headingLevel={3}
              title="No schedules"
              description="The runner has no registered schedule."
            />
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table" data-testid="admin-schedules">
              <thead>
                <tr>
                  <th scope="col">Slot</th>
                  <th scope="col">Last fired</th>
                  <th scope="col">Next due</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.slot}>
                    <td data-label="Slot">
                      <span className="admin-action">{schedule.slot}</span>
                    </td>
                    <td data-label="Last fired">
                      {schedule.lastFiredMs === null ? (
                        <span className="admin-meta">Never</span>
                      ) : (
                        <span className="admin-pills">
                          <RelativeTime at={new Date(schedule.lastFiredMs)} absolute />
                          {/* `daily-ops` reported a last fire fifteen hours in
                              the FUTURE. Administration cannot fix the clock,
                              but it must not present the value as evidence. */}
                          {schedule.lastFiredMs > now ? (
                            <Pill tone="amber">recorded in the future</Pill>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td data-label="Next due">
                      <span className="admin-pills">
                        <RelativeTime at={new Date(schedule.nextDueMs)} absolute />
                        {schedule.nextDueMs < now ? <Pill tone="amber">overdue</Pill> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <section className="admin-group" aria-labelledby="admin-followers">
        <h2 className="admin-group-title" id="admin-followers">
          Follower health
        </h2>
        <StatGrid>
          <StatCard
            icon={<IconLedger />}
            tone="gold"
            value={formatCount(followers.orgs)}
            label="Following orgs"
          />
          <StatCard
            icon={<IconCheckCircle />}
            tone="green"
            value={formatCount(followers.current)}
            label="Current"
          />
          <StatCard
            icon={<IconClock />}
            tone={followers.behind > 0 ? "amber" : "neutral"}
            value={formatCount(followers.behind)}
            label="Behind"
          />
          <StatCard
            icon={<IconLayers />}
            tone={followers.totalBehind > 0 ? "amber" : "neutral"}
            value={formatCount(followers.totalBehind)}
            label="Events behind"
          />
        </StatGrid>
      </section>

      {orgs.length === 0 ? (
        <SectionCard icon={<IconLedger />} tone="neutral" title="Organizations">
          <EmptyState
            headingLevel={3}
            title="No organization has declared finance"
            description="Storage, dispatch, exports and certification begin once an organization declares a financial profile."
          />
        </SectionCard>
      ) : (
        <CardGrid>
          {orgs.map((org) => (
            <OrgHealth key={org.orgId} org={org} />
          ))}
        </CardGrid>
      )}
    </>
  );
}

function OrgHealth({ org }: { org: OrgHealthRow }) {
  const { follower, provider, certification, queue } = org;
  return (
    <SectionCard
      icon={<IconLedger />}
      title={org.orgName}
      // No "Finance console" door. `platform:admin` carries no finops
      // capability, so /org/<slug>/money 404s for the one person this page is
      // built for — a link on every card to a page its reader cannot open
      // (nav law 3). A caption apologising for it was still a dead link.
      data-testid={`admin-health-${org.orgSlug}`}
    >
      <dl className="admin-kv">
        <div>
          <dt>Settlement ingest</dt>
          <dd>
            <Pill tone={follower.current ? "green" : "amber"} dot>
              {follower.current
                ? `Current · ${String(follower.streams)} stream(s)`
                : `${String(follower.totalBehind)} event(s) behind`}
            </Pill>
          </dd>
        </div>

        <div>
          <dt>Certification</dt>
          <dd className="admin-cell-main">
            {certification === null ? (
              // Never certified is not a failure — it means the runner has not
              // reached this org yet. Administration says what it sees.
              <Pill tone="neutral">Never certified</Pill>
            ) : (
              <Pill tone={certification.verdict === "PASS" ? "green" : "red"} dot>
                {certification.verdict} · {certification.at.toISOString().slice(0, 10)}
              </Pill>
            )}
          </dd>
        </div>
        {certification !== null ? (
          <div>
            <dt className="admin-sr-only">Digest</dt>
            <dd className="admin-evidence" title="The digest the runner recorded">
              {certification.digest}
            </dd>
          </div>
        ) : null}

        <div className="is-block">
          <dt>Dispatch channels</dt>
          <dd className="admin-chips">
            {provider.channels.map((channel) => (
              <Pill
                key={channel.channel}
                tone={!channel.configured ? "neutral" : channel.failed > 0 ? "red" : "green"}
              >
                {channel.channel}
                {channel.configured
                  ? ` · ${String(channel.confirmed)} confirmed, ${String(channel.failed)} failed`
                  : " · not configured"}
              </Pill>
            ))}
            {provider.deadSendJobs > 0 ? (
              <Pill tone="red">{provider.deadSendJobs} dead send job(s)</Pill>
            ) : null}
          </dd>
        </div>

        <div className="is-block">
          <dt>Recent failures &amp; recovery</dt>
          <dd>
            {queue.items.length === 0 ? (
              <span className="admin-meta">Nothing outstanding.</span>
            ) : (
              <ul className="admin-rows is-inset">
                {queue.items.map((item, index) => (
                  <li key={`${item.kind}-${String(index)}`}>
                    <span className="admin-attention-subject">
                      <span>{item.subject}</span>
                      <span className="admin-attention-kind">{item.kind}</span>
                    </span>
                    {/* The platform's own resolving capability, NAMED not
                        offered: administration shows what would fix this and
                        where it lives; it does not hold the power to run it. */}
                    <span className="admin-meta">Resolved by {item.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}
