import {
  EmptyState,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconCog,
  IconLedger,
  Pill,
  SectionCard,
} from "@desiauction/ui";

import { countNoun } from "../../../lib/plural";
import { formatCount, waitedFor } from "../../../server/admin/format";
import type { OrgHealthRow, PlatformHealth } from "../../../server/admin/views";
import { humanAction, RelativeTime } from "../admin-ui";
import { formatDate } from "../../../lib/format-date";

/**
 * PX-9 §5 — platform health.
 *
 * Every verdict below is a certified snapshot's own field: `runner.healthy`,
 * `follower.current`, `certification.*`, and the compliance queue's items.
 * Administration arranges them and names the org. It grades nothing.
 *
 * Redesign (2026-09-27): the answer first. The page used to open on two cards
 * and then list every club — 51 near-identical rows, with the 13 that had a
 * failure to recover mixed in among them, and a failure that read as code
 * ("health:exports:failed", "Resolved by regenerateExportArtifact"). Now a
 * verdict says what needs a look and who fixes it, the clubs with a problem
 * come first, and the healthy ones fold into one row.
 */

/**
 * The compliance queue's kinds and resolving actions, in words. They come from
 * the finance package's `complianceQueueSnapshot` (IP-6, frozen), which names
 * them for code — `health:<component>:<status>` and a function name. The
 * translation lives here, on the one page that shows them to a person.
 */
const COMPONENT_WORDS: Readonly<Record<string, { what: string; fix: string }>> = {
  follower: { what: "Settlement ingest has stalled", fix: "Run or rewind the ingest follower" },
  runner: { what: "A background job was given up", fix: "Requeue the job" },
  exports: { what: "Export files fail verification", fix: "Regenerate the export files" },
  documents: { what: "Documents need recovery", fix: "Recover the documents, or investigate" },
  fiscal: {
    what: "A day is unattested or a period open",
    fix: "Attest the day, or close the period",
  },
};

export function queueWords(kind: string): { what: string; fix: string } {
  if (kind.startsWith("health:")) {
    const component = kind.split(":")[1] ?? "";
    return COMPONENT_WORDS[component] ?? { what: humanAction(kind), fix: "Investigate" };
  }
  if (kind === "dispatch:failed") {
    return { what: "A message did not send", fix: "Retry the send" };
  }
  if (kind === "export:failed") {
    return { what: "An export failed", fix: "Retry the export" };
  }
  return { what: humanAction(kind), fix: "Investigate" };
}

/** "3 artifact(s) fail verification — regenerate from sources" → plain words.
 *  The part after the dash is the fix, which the line beneath already says. */
function subjectWords(subject: string): string {
  return subject
    .replace(/ — .*$/, "")
    .replace(
      /(\d+) artifact\(s\)/g,
      (_, n: string) => `${n} export ${n === "1" ? "file" : "files"}`,
    )
    .replace(/\(s\)/g, "s");
}

/** What is wrong with one club, in the order an operator should read it. */
function problemsOf(org: OrgHealthRow): string[] {
  const problems: string[] = [];
  if (org.certification !== null && org.certification.verdict !== "PASS") {
    problems.push(`Certification ${org.certification.verdict.toLowerCase()}`);
  }
  if (org.provider.deadSendJobs > 0) {
    problems.push(`${countNoun(org.provider.deadSendJobs, "send")} given up`);
  }
  if (!org.follower.current) {
    problems.push(`Ingest ${countNoun(org.follower.totalBehind, "event")} behind`);
  }
  const failedSends = org.provider.channels.reduce((sum, channel) => sum + channel.failed, 0);
  if (failedSends > 0) {
    problems.push(`${countNoun(failedSends, "message")} failed`);
  }
  for (const what of new Set(org.queue.items.map((item) => queueWords(item.kind).what))) {
    problems.push(what);
  }
  return problems;
}

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

  const troubled = orgs.filter((org) => problemsOf(org).length > 0);
  const clear = orgs.filter((org) => problemsOf(org).length === 0);
  const certified = orgs.filter((org) => org.certification?.verdict === "PASS");
  const latestCert = certified.reduce<Date | null>(
    (latest, org) =>
      org.certification !== null && (latest === null || org.certification.at > latest)
        ? org.certification.at
        : latest,
    null,
  );

  /* The verdict: each problem once, in words, with who fixes it. Clubs are
     grouped by what is wrong, so thirteen export failures are one sentence. */
  const findings: { tone: "red" | "amber"; title: string; detail: string }[] = [];
  if (!runnerVerdict.healthy) {
    findings.push({
      tone: "red",
      title: "The background workers are not keeping up",
      detail: runnerVerdict.detail ?? "Jobs are waiting and nothing is picking them up.",
    });
  }
  const byProblem = new Map<string, number>();
  for (const org of troubled) {
    for (const problem of problemsOf(org)) {
      byProblem.set(problem, (byProblem.get(problem) ?? 0) + 1);
    }
  }
  for (const [problem, clubs] of byProblem) {
    findings.push({
      tone: "red",
      title: `${countNoun(clubs, "club")}: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`,
      detail:
        "Each club's finance controller fixes this from Money → Finance; the clubs are listed below.",
    });
  }
  if (runnerVerdict.futureSchedules > 0) {
    findings.push({
      tone: "amber",
      title: `${countNoun(runnerVerdict.futureSchedules, "schedule")} ${runnerVerdict.futureSchedules === 1 ? "reports" : "report"} a last run in the future`,
      detail:
        "The server clock is ahead of real time, so those times prove nothing — check the host's time sync.",
    });
  }

  return (
    <>
      <section
        className="admin-health-verdict"
        data-tone={findings.some((finding) => finding.tone === "red") ? "red" : undefined}
        aria-labelledby="admin-health-verdict-title"
        data-testid="admin-health-verdict"
      >
        <h2 id="admin-health-verdict-title" className="admin-health-verdict-title">
          {findings.length === 0
            ? "Everything is running"
            : `${countNoun(findings.length, "thing")} ${findings.length === 1 ? "needs" : "need"} a look`}
        </h2>
        {findings.length > 0 ? (
          <ul className="admin-health-findings">
            {findings.map((finding) => (
              <li key={finding.title} data-tone={finding.tone}>
                <span className="admin-health-finding-dot" aria-hidden />
                <span>
                  <strong>{finding.title}</strong>
                  <span>{finding.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="admin-health-checks" data-testid="admin-follower-summary">
          {runnerVerdict.healthy ? (
            <li>
              <IconCheck size={16} aria-hidden />
              Workers running · {formatCount(runner.jobs.done)} jobs done
            </li>
          ) : null}
          <li data-off={followers.current < followers.orgs || undefined}>
            <IconCheck size={16} aria-hidden />
            {formatCount(followers.current)} of {formatCount(followers.orgs)} clubs current
          </li>
          <li data-off={certified.length < orgs.length || undefined}>
            <IconCheck size={16} aria-hidden />
            {formatCount(certified.length)} of {formatCount(orgs.length)} certified
            {latestCert !== null ? ` · latest ${formatDate(latestCert)}` : ""}
          </li>
          {unconfigured.length > 0 ? (
            <li className="is-note">Not set up on this server: {unconfigured.join(", ")}</li>
          ) : null}
        </ul>
      </section>

      <div className="admin-health-top">
        <SectionCard
          icon={<IconCog />}
          tone={runnerVerdict.healthy ? "green" : "red"}
          title="Background workers"
          action={
            <Pill tone={runnerVerdict.healthy ? "green" : "red"} dot testId="admin-runner-health">
              {runnerVerdict.healthy ? "Running" : "Not running"}
            </Pill>
          }
        >
          {/* The verdict is CORRECTED against queue age (see `runnerVerdictOf`).
            The snapshot's own rule — `dead === 0` — reports a runner that has
            stopped entirely as healthy, because a runner that never runs
            cannot produce a dead job. Its reasons show only when it is not
            healthy; a skewed clock is said once, under Schedules. */}
          {!runnerVerdict.healthy && runnerVerdict.detail !== null ? (
            <p className="admin-live-trouble" role="note" data-testid="admin-runner-detail">
              {runnerVerdict.detail}
            </p>
          ) : null}
          <dl className="admin-health-jobs" data-testid="admin-queues">
            {Object.entries(runner.jobs).map(([state, count]) => (
              <div key={state} data-zero={count === 0 || undefined}>
                <dt>{state}</dt>
                <dd data-bad={(state === "dead" && count > 0) || undefined}>
                  {formatCount(count)}
                </dd>
              </div>
            ))}
          </dl>
          {runnerVerdict.oldestQueuedWaitMs === null ? null : (
            <p className="admin-meta">
              The oldest queued job has waited {waitedFor(runnerVerdict.oldestQueuedWaitMs)}.
            </p>
          )}
        </SectionCard>

        <SectionCard icon={<IconClock />} tone="neutral" title="Schedules" flush>
          {schedules.length === 0 ? (
            <div className="admin-card-empty">
              <EmptyState
                size="compact"
                headingLevel={3}
                title="No schedules"
                description="The runner has no registered schedule."
              />
            </div>
          ) : (
            <ul className="admin-health-schedules" data-testid="admin-schedules">
              {schedules.map((schedule) => (
                <li key={schedule.slot}>
                  {/* The slot's name as words; its key is the hover. */}
                  <strong title={schedule.slot}>{humanAction(schedule.slot)}</strong>
                  <span
                    data-tone={
                      schedule.lastFiredMs !== null && schedule.lastFiredMs > now
                        ? "amber"
                        : undefined
                    }
                  >
                    {schedule.lastFiredMs === null ? (
                      "Never run"
                    ) : (
                      <>
                        Last ran <RelativeTime at={new Date(schedule.lastFiredMs)} absolute />
                        {/* `daily-ops` reported a last fire fifteen hours in
                            the FUTURE. Administration cannot fix the clock,
                            but it must not present the value as evidence. */}
                        {schedule.lastFiredMs > now ? " — ahead of the server clock" : ""}
                      </>
                    )}
                  </span>
                  <span data-tone={schedule.nextDueMs < now ? "amber" : undefined}>
                    Next <RelativeTime at={new Date(schedule.nextDueMs)} absolute />
                    {schedule.nextDueMs < now ? " — overdue" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {orgs.length === 0 ? (
        <SectionCard icon={<IconLedger />} tone="neutral" title="Clubs">
          <EmptyState
            size="compact"
            headingLevel={3}
            title="No organization has declared finance"
            description="Storage, dispatch, exports and certification begin once an organization declares a financial profile."
          />
        </SectionCard>
      ) : null}

      {troubled.length > 0 ? (
        <SectionCard
          icon={<IconLedger />}
          tone="red"
          title="Clubs that need a look"
          description={`${formatCount(troubled.length)} of ${formatCount(orgs.length)} · worst first`}
          flush
          data-testid="admin-health-troubled"
        >
          <OrgList orgs={troubled} hidden={unconfigured} />
        </SectionCard>
      ) : null}

      {clear.length > 0 ? (
        // The healthy clubs are a fact, not a list to read: one row that opens.
        <details className="admin-health-clear" data-testid="admin-health-clear">
          <summary>
            <IconCheck size={18} aria-hidden />
            <strong>{countNoun(clear.length, "club")} all clear</strong>
            <span className="admin-health-clear-hint">
              Ingest current, certified, nothing to recover
            </span>
            <IconChevronDown size={16} aria-hidden className="admin-health-caret" />
          </summary>
          <OrgList orgs={clear} hidden={unconfigured} />
        </details>
      ) : null}
    </>
  );
}

function OrgList({ orgs, hidden }: { orgs: readonly OrgHealthRow[]; hidden: readonly string[] }) {
  return (
    <ul className="admin-follow-list">
      {/* One header for the column labels on a wide screen; each row still
          names its own facts (visually hidden there, drawn on a phone where
          there is no header to read them from). */}
      <li className="admin-follow-row admin-follow-head" aria-hidden>
        <span>Organization</span>
        <span className="admin-follow-facts">
          <span>Settlement ingest</span>
          <span>Certification</span>
          <span>Dispatch channels</span>
          <span>What is wrong</span>
        </span>
      </li>
      {orgs.map((org) => (
        <OrgHealth key={org.orgId} org={org} hidden={hidden} />
      ))}
    </ul>
  );
}

function OrgHealth({ org, hidden }: { org: OrgHealthRow; hidden: readonly string[] }) {
  const { follower, provider, certification, queue } = org;
  const channels = provider.channels.filter((channel) => !hidden.includes(channel.channel));
  const problems = problemsOf(org);
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
            {/* A healthy fact is a dot and a word; only a problem gets a pill. */}
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
            ) : certification.verdict === "PASS" ? (
              // The digest is evidence: whole, on hover and to a screen reader.
              <span className="admin-state" data-tone="green" title={certification.digest}>
                <span className="admin-state-dot" aria-hidden />
                Pass · {formatDate(certification.at)}
                <span className="admin-sr-only">, digest {certification.digest}</span>
              </span>
            ) : (
              <Pill tone="red" dot>
                {certification.verdict} · {formatDate(certification.at)}
              </Pill>
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
          </dd>
        </div>
        <div>
          <dt>What is wrong</dt>
          <dd>
            {problems.length === 0 ? (
              <span className="admin-zero" title="Nothing">
                <span aria-hidden>—</span>
                <span className="admin-sr-only">Nothing</span>
              </span>
            ) : (
              <span className="admin-state" data-tone="red">
                <span className="admin-state-dot" aria-hidden />
                {problems.join(" · ")}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {queue.items.length > 0 ? (
        // Its own full-width line under the row: opened, it used to spill
        // into whichever grid column it sat in.
        <details className="admin-health-items">
          <summary>
            {countNoun(queue.items.length, "item")} to recover
            <IconChevronDown size={14} aria-hidden className="admin-health-caret" />
          </summary>
          <ul>
            {queue.items.map((item, index) => {
              const words = queueWords(item.kind);
              return (
                <li key={`${item.kind}-${String(index)}`}>
                  <strong>{subjectWords(item.subject)}</strong>
                  {/* The platform's own resolving capability, NAMED not
                      offered: administration shows what would fix this and
                      who can; it does not hold the power to run it. */}
                  <span>{words.fix} — the club&rsquo;s finance controller, in Money → Finance</span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </li>
  );
}
