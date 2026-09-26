import { EmptyState, IconClock, IconCog, IconLedger, Pill, SectionCard } from "@desiauction/ui";

import { formatCount, waitedFor } from "../../../server/admin/format";
import type { OrgHealthRow, PlatformHealth } from "../../../server/admin/views";
import { RelativeTime } from "../admin-ui";

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
  // A channel no organization has configured is a fact about the SERVER.
  const channelNames = [
    ...new Set(orgs.flatMap((org) => org.provider.channels.map((channel) => channel.channel))),
  ];
  const unconfigured = channelNames.filter((name) =>
    orgs.every((org) =>
      org.provider.channels.every((channel) => channel.channel !== name || !channel.configured),
    ),
  );
  return (
    <>
      <div className="admin-health-top">
        <SectionCard
          icon={<IconCog />}
          tone={runnerVerdict.healthy ? "green" : "red"}
          title="Background workers"
          description="The job runner, its queues, and its oldest wait"
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
          tone="neutral"
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
      </div>

      <SectionCard
        icon={<IconLedger />}
        tone={followers.behind > 0 ? "amber" : "green"}
        title="Follower health"
        headingLevel={2}
        description={
          // The four figures that were four tall tiles, as one line. Channels
          // this server has no provider for are said ONCE here, not as a grey
          // "not configured" chip on every organization.
          <span className="admin-follow-summary" data-testid="admin-follower-summary">
            <span>
              <strong>{formatCount(followers.orgs)}</strong> following
            </span>
            <span>
              <strong>{formatCount(followers.current)}</strong> current
            </span>
            <span data-zero={followers.behind === 0 || undefined}>
              <strong>{formatCount(followers.behind)}</strong> behind
            </span>
            <span data-zero={followers.totalBehind === 0 || undefined}>
              <strong>{formatCount(followers.totalBehind)}</strong> events behind
            </span>
            {unconfigured.length > 0 ? (
              <span className="admin-meta">
                Not set up on this server: {unconfigured.join(", ")}
              </span>
            ) : null}
          </span>
        }
        flush
      >
        {orgs.length === 0 ? (
          <div className="admin-card-empty">
            <EmptyState
              headingLevel={3}
              title="No organization has declared finance"
              description="Storage, dispatch, exports and certification begin once an organization declares a financial profile."
            />
          </div>
        ) : (
          <ul className="admin-follow-list">
            {/* One header for the column labels on a wide screen; each row
                still names its own facts (visually hidden there, drawn on a
                phone where there is no header to read them from). */}
            <li className="admin-follow-row admin-follow-head" aria-hidden>
              <span>Organization</span>
              <span className="admin-follow-facts">
                <span>Settlement ingest</span>
                <span>Certification</span>
                <span>Dispatch channels</span>
                <span>Recent failures</span>
              </span>
            </li>
            {orgs.map((org) => (
              <OrgHealth key={org.orgId} org={org} hidden={unconfigured} />
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

function OrgHealth({ org, hidden }: { org: OrgHealthRow; hidden: readonly string[] }) {
  const { follower, provider, certification, queue } = org;
  const channels = provider.channels.filter((channel) => !hidden.includes(channel.channel));
  return (
    // No "Finance console" door. `platform:admin` carries no finops capability,
    // so /org/<slug>/money 404s for the one person this page is built for.
    <li className="admin-follow-row" data-testid={`admin-health-${org.orgSlug}`}>
      <span className="admin-follow-org">
        <h3 className="admin-name">{org.orgName}</h3>
        <span className="admin-id">{org.orgSlug}</span>
      </span>
      <dl className="admin-follow-facts">
        <div>
          <dt>Settlement ingest</dt>
          <dd>
            {/* A healthy fact is a dot and a word; only a problem gets a pill.
                Twenty-five green "Current · 3 stream(s)" pills said nothing. */}
            {follower.current ? (
              <span
                className="admin-state"
                data-tone="green"
                title={`${String(follower.streams)} ${follower.streams === 1 ? "stream" : "streams"} followed`}
              >
                <span className="admin-state-dot" aria-hidden />
                Current
                <span className="admin-sr-only">
                  {" "}
                  · {follower.streams} {follower.streams === 1 ? "stream" : "streams"}
                </span>
              </span>
            ) : (
              <Pill tone="amber" dot>
                {follower.totalBehind} {follower.totalBehind === 1 ? "event" : "events"} behind
              </Pill>
            )}
          </dd>
        </div>
        <div>
          <dt>Certification</dt>
          <dd>
            {certification === null ? (
              // Never certified is not a failure — it means the runner has not
              // reached this org yet. Administration says what it sees.
              <Pill tone="neutral">Never certified</Pill>
            ) : (
              <span className="admin-follow-cert">
                {certification.verdict === "PASS" ? (
                  <span className="admin-state" data-tone="green">
                    <span className="admin-state-dot" aria-hidden />
                    Pass · {certification.at.toISOString().slice(0, 10)}
                  </span>
                ) : (
                  <Pill tone="red" dot>
                    {certification.verdict} · {certification.at.toISOString().slice(0, 10)}
                  </Pill>
                )}
                {/* The digest is evidence, so it is all there — the first eight
                    characters drawn, the whole of it announced and on hover. */}
                <span className="admin-id admin-digest" title={certification.digest}>
                  <span aria-hidden>{certification.digest.slice(0, 8)}</span>
                  <span className="admin-sr-only">Digest {certification.digest}</span>
                </span>
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Dispatch channels</dt>
          <dd className="admin-follow-chans">
            {channels.map((channel) => {
              const state = !channel.configured ? "off" : channel.failed > 0 ? "bad" : "ok";
              return (
                <span key={channel.channel} className="admin-chan" data-state={state}>
                  <span className="admin-chan-dot" aria-hidden />
                  {channel.channel}
                  <span
                    className="admin-chan-n"
                    data-zero={
                      (channel.configured && channel.confirmed === 0 && channel.failed === 0) ||
                      undefined
                    }
                  >
                    {channel.configured
                      ? `${String(channel.confirmed)}${channel.failed > 0 ? ` · ${String(channel.failed)} failed` : ""}`
                      : "off"}
                  </span>
                  <span className="admin-sr-only">
                    {channel.configured
                      ? `: ${String(channel.confirmed)} confirmed, ${String(channel.failed)} failed`
                      : ": not configured"}
                  </span>
                </span>
              );
            })}
            {provider.deadSendJobs > 0 ? (
              <Pill tone="red">{provider.deadSendJobs} dead send job(s)</Pill>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Recent failures</dt>
          <dd>
            {queue.items.length === 0 ? (
              <span className="admin-zero" title="None">
                <span aria-hidden>—</span>
                <span className="admin-sr-only">None</span>
              </span>
            ) : (
              <details className="admin-follow-fails">
                <summary>
                  <Pill tone="red" dot>
                    {queue.items.length} to recover
                  </Pill>
                </summary>
                <ul>
                  {queue.items.map((item, index) => (
                    <li key={`${item.kind}-${String(index)}`}>
                      <span>{item.subject}</span>
                      <span className="admin-attention-kind">{item.kind}</span>
                      {/* The platform's own resolving capability, NAMED not
                          offered: administration shows what would fix this and
                          where it lives; it does not hold the power to run it. */}
                      <span className="admin-meta">Resolved by {item.action}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}
