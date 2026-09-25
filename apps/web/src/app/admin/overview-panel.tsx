import type { OutcomeMetrics } from "@desiauction/core";
import {
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconBroadcast,
  IconChart,
  IconCheckCircle,
  IconClock,
  IconFlag,
  IconGavel,
  IconLedger,
  IconShieldCheck,
  IconTrophy,
  IconUser,
  Pill,
  SectionCard,
  StatCard,
  StatGrid,
  type KitTone,
} from "@desiauction/ui";
import Link from "next/link";

import { ADMIN_ACCESS_ACTION } from "../../server/admin/capabilities";
import type { DeskItem } from "../../server/admin/desk-queue";
import {
  actorLabel,
  countNoun,
  formatCount,
  lifecycleLabel,
  waitedFor,
} from "../../server/admin/format";
import type { LiveBoard } from "../../server/admin/live-views";
import type { PlatformOverview } from "../../server/admin/views";
import { RelativeTime, statusPillTone } from "./admin-ui";
import { groupAttention } from "./attention-groups";

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
  live,
  desks,
}: {
  overview: PlatformOverview;
  outcomes: OutcomeMetrics;
  live: LiveBoard;
  desks: { items: readonly DeskItem[]; desks: number };
}) {
  const { totals, runnerVerdict, followers, attention, recent, liveAuctions } = overview;
  const attentionGroups = groupAttention(attention);
  return (
    <>
      <StatGrid testId="admin-totals">
        <StatCard
          icon={<IconFlag />}
          tone="gold"
          value={formatCount(totals.orgs)}
          label="Organizations"
          hint="All clubs"
          href="/admin/orgs"
          linkComponent={Link}
        />
        <StatCard
          icon={<IconTrophy />}
          tone="blue"
          value={formatCount(totals.competitions)}
          label="Seasons"
          hint="Across every club"
          // The one tile without a door. Seasons are listed per club, and the
          // organizations directory is where an administrator reaches them.
          href="/admin/orgs"
          linkComponent={Link}
        />
        <StatCard
          icon={<IconUser />}
          tone="green"
          value={formatCount(totals.people)}
          label="Users"
          hint="With an account"
          href="/admin/users"
          linkComponent={Link}
        />
        <StatCard
          icon={<IconGavel />}
          tone="purple"
          value={formatCount(totals.auctions)}
          label="Auctions"
          hint={
            liveAuctions.total > 0
              ? `${formatCount(liveAuctions.total - liveAuctions.stale)} live now`
              : "None live now"
          }
          href="/admin/live"
          linkComponent={Link}
        />
      </StatGrid>

      <AttentionStrip attentionGroups={attentionGroups} desks={desks} />

      <div className="adm-overview">
        <div className="adm-col">
          <LiveNow live={live} />

          <SectionCard
            icon={<IconClock />}
            tone="neutral"
            title="Recent activity"
            description="Latest audit entries, admin page views left out"
            action={
              <Link href="/admin/audit" className="adm-link">
                Audit explorer
                <IconArrowRight size={16} aria-hidden />
              </Link>
            }
            flush={recent.length > 0}
          >
            {recent.length === 0 ? (
              <EmptyState title="No activity yet" description="The audit log is empty." />
            ) : (
              <>
                <ul className="adm-rows adm-feed" data-testid="admin-recent">
                  {recent.map((row) => (
                    <li key={row.id} className="adm-feed-row">
                      <RelativeTime at={row.at} />
                      <span className="adm-feed-action">{row.action}</span>
                      <span className="adm-feed-actor">{actorLabel(row.actor, row.actorName)}</span>
                    </li>
                  ))}
                </ul>
                {/* Administration records its own page views, so this list would
                    otherwise fill with an admin watching themselves refresh. They
                    are excluded HERE only, and this link is the disclosure. */}
                <p className="adm-foot">
                  <Link
                    href={`/admin/audit?action=${ADMIN_ACCESS_ACTION}`}
                    className="adm-link"
                    data-testid="admin-access-log-link"
                  >
                    Administration&rsquo;s own access log
                    <IconArrowRight size={16} aria-hidden />
                  </Link>
                </p>
              </>
            )}
          </SectionCard>
        </div>

        <div className="adm-col">
          <SectionCard
            icon={<IconShieldCheck />}
            tone={runnerVerdict.healthy && followers.behind === 0 ? "green" : "amber"}
            title="System status"
            description="As the runner and each follower report themselves"
          >
            {/* `runnerVerdict`, NOT `runner.healthy`. The snapshot's rule is
                `dead === 0`, which a runner that never runs also satisfies —
                measured at 1,558 queued with the oldest eleven days old, it
                reported HEALTHY in green. */}
            <ul className="adm-status">
              <li>
                <span className="adm-status-name">Job runner</span>
                <Pill
                  tone={runnerVerdict.healthy ? "green" : "red"}
                  dot
                  testId="admin-overview-runner"
                >
                  {runnerVerdict.healthy ? "Healthy" : "Not running"}
                </Pill>
              </li>
              {runnerVerdict.detail !== null ? (
                <li className="adm-status-note">{runnerVerdict.detail}</li>
              ) : null}
              <li className="adm-status-chips">
                <Pill
                  tone={runnerVerdict.queued > 0 && !runnerVerdict.healthy ? "amber" : "neutral"}
                >
                  Queued {formatCount(runnerVerdict.queued)}
                </Pill>
                <Pill tone={runnerVerdict.dead > 0 ? "red" : "neutral"}>
                  Dead {formatCount(runnerVerdict.dead)}
                </Pill>
                {runnerVerdict.oldestQueuedWaitMs === null ? null : (
                  <Pill tone={runnerVerdict.healthy ? "neutral" : "red"}>
                    Oldest waited {waitedFor(runnerVerdict.oldestQueuedWaitMs)}
                  </Pill>
                )}
              </li>
              <li>
                <span className="adm-status-name">Settlement ingest</span>
                <Pill tone={followers.behind === 0 ? "green" : "amber"} dot>
                  {followers.behind === 0
                    ? `${String(followers.orgs)} current`
                    : `${String(followers.behind)} behind`}
                </Pill>
              </li>
            </ul>
            <p className="adm-foot adm-foot-inline">
              <Link href="/admin/health" className="adm-link">
                Platform health
                <IconArrowRight size={16} aria-hidden />
              </Link>
              {/* Whether the deployment holds the registered DLT ids it needs is
                  a health fact like any other — without an id a message shape
                  does not send at all. */}
              <Link href="/admin/messaging" className="adm-link" data-testid="admin-messaging-link">
                Messaging
                <IconArrowRight size={16} aria-hidden />
              </Link>
            </p>
          </SectionCard>

          <SectionCard icon={<IconGavel />} tone="purple" title="Auctions by status">
            <StatusList
              lines={overview.auctionsByStatus}
              liveAuctions={liveAuctions}
              empty="No auction has been created yet."
            />
          </SectionCard>

          <SectionCard
            icon={<IconLedger />}
            tone="blue"
            title="Settlements"
            description={`${countNoun(totals.cases, "settlement case")} · ${countNoun(totals.financeOrgs, "finance org")}`}
            action={
              <Link href="/admin/health" className="adm-link">
                Finance health
                <IconArrowRight size={16} aria-hidden />
              </Link>
            }
          >
            <StatusList
              lines={overview.casesByStatus}
              empty="No settlement case has been opened."
            />
          </SectionCard>

          <SectionCard
            icon={<IconChart />}
            tone="green"
            title={`Outcomes · last ${String(outcomes.windowDays)} days`}
          >
            <dl className="adm-figures" data-testid="admin-outcomes">
              <Figure label="Seasons created" value={outcomes.competitionsCreated} />
              {/* Was "Cloned (run it again)" — the parenthetical was the internal
                  metric definition, not a label an operator should decode. */}
              <Figure label="Seasons cloned" value={outcomes.competitionsCloned} />
              <Figure label="Clone share" value={pct(outcomes.cloneAdoptionRate)} suffix="%" />
              <Figure label="Repeat orgs" value={outcomes.orgsRepeating} />
              <Figure label="Repeat org rate" value={pct(outcomes.repeatOrgRate)} suffix="%" />
              <Figure label="Registrations" value={outcomes.registrationsSubmitted} />
              <Figure label="Players placed" value={outcomes.playersAssigned} />
            </dl>
            {Object.keys(outcomes.registrationsBySource).length > 0 ? (
              <div className="adm-chips" data-testid="admin-outcomes-sources">
                <span className="adm-chips-label">Registrations by share source</span>
                {Object.entries(outcomes.registrationsBySource)
                  .sort((a, b) => b[1] - a[1])
                  .map(([src, n]) => (
                    <Pill key={src} tone="neutral">
                      {/* `other` is a `?ref` the platform does not recognise;
                          `direct` is no `?ref` at all (attribution.ts:44). They
                          are different findings and the chip says which. */}
                      {SOURCE_LABELS[src] ?? src} · {formatCount(n)}
                    </Pill>
                  ))}
              </div>
            ) : null}
          </SectionCard>
        </div>
      </div>
    </>
  );
}

const ROOM_TONE: Record<LiveBoard["running"][number]["state"], KitTone> = {
  active: "green",
  quiet: "neutral",
  paused: "amber",
  stale: "red",
};

const ROOM_WORDS: Record<LiveBoard["running"][number]["state"], string> = {
  active: "bidding",
  quiet: "quiet",
  paused: "paused",
  stale: "silent",
};

/**
 * What is live, first — before totals, before outcomes. On an auction night it
 * is the only question; on any other day it answers itself in one line.
 */
function LiveNow({ live }: { live: LiveBoard }) {
  const shown = live.running.slice(0, 5);
  return (
    <SectionCard
      icon={<IconBroadcast />}
      tone={shown.length > 0 ? "red" : "neutral"}
      title="Live now"
      description={
        shown.length === 0
          ? `No auction is running right now.${
              live.stale.length > 0
                ? ` ${countNoun(live.stale.length, "auction")} marked live ${live.stale.length === 1 ? "was" : "were"} never closed.`
                : ""
            }`
          : `${countNoun(live.running.length, "auction")} running`
      }
      action={
        <Link href="/admin/live" className="adm-link" data-testid="admin-live-board-link">
          Open the live board
          <IconArrowRight size={16} aria-hidden />
        </Link>
      }
      flush={shown.length > 0}
      data-testid="admin-live-now"
    >
      {shown.length === 0 ? undefined : (
        <>
          <ul className="adm-rows">
            {shown.map((row) => (
              <li key={row.auctionId} className="adm-row">
                <span className="adm-row-dot" data-tone={ROOM_TONE[row.state]} aria-hidden />
                <span className="adm-row-main">
                  <Link href={`/admin/auctions/${row.auctionId}`} className="adm-row-title">
                    {row.seasonName}
                  </Link>
                  <span className="adm-row-sub">{row.orgName}</span>
                </span>
                <span className="adm-row-side">
                  {/* "quiet" on every row said nothing; the dot carries it. */}
                  {row.state === "quiet" ? (
                    <span className="admin-sr-only">{ROOM_WORDS[row.state]}</span>
                  ) : (
                    <Pill tone={ROOM_TONE[row.state]}>{ROOM_WORDS[row.state]}</Pill>
                  )}
                  <span className="adm-row-sub">
                    {row.lots.sold} of {row.lots.total} sold · {row.bids.lastFiveMinutes} bids in 5
                    min
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {live.running.length > shown.length ? (
            <p className="adm-foot">
              And {formatCount(live.running.length - shown.length)} more on the live board.
            </p>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

/**
 * What needs a human, in one card directly under the figures: the desks this
 * operator can act on first (gold), then what administration can only point
 * at (red). It replaces an "Attention queue" card and a "Waiting on your desks"
 * card that each spent a header and a paragraph on one or two rows.
 */
function AttentionStrip({
  attentionGroups,
  desks,
}: {
  attentionGroups: ReturnType<typeof groupAttention>;
  desks: { items: readonly DeskItem[]; desks: number };
}) {
  const deskItems = desks.desks > 0 ? desks.items : [];
  const nothing = attentionGroups.groups.length === 0 && deskItems.length === 0;
  if (nothing) {
    return (
      <p className="admin-slim" data-testid="admin-attention-clear">
        <IconCheckCircle size={16} />
        <strong>Nothing needs a human.</strong>
        <span className="admin-meta">
          No dead jobs, stalled runner, stuck auction, discrepant case or failed delivery
          {desks.desks > 0 ? ", and your desks are clear" : ""}.
        </span>
      </p>
    );
  }
  return (
    <section className="adm-alerts" aria-labelledby="adm-alerts-title">
      <div className="adm-alerts-head">
        <h2 className="adm-alerts-title" id="adm-alerts-title">
          <IconAlert size={16} />
          Needs attention
        </h2>
        {/* Administration cannot act on the red rows; the gold ones are this
            operator's own desks. */}
        <span className="admin-meta">Red: fixed in the owning console · Gold: your desks</span>
      </div>
      {deskItems.length > 0 ? (
        <ul className="adm-rows adm-alert-rows" data-testid="admin-desks">
          {deskItems.map((item) => (
            <li key={item.key} className="adm-row" data-testid={`admin-desk-${item.key}`}>
              <span className="adm-row-dot" data-tone="amber" aria-hidden />
              <span className="adm-row-main">
                <span className="adm-row-title">
                  {countNoun(item.count, item.label[0], item.label[1])}
                  {item.oldestAt !== null ? (
                    <span className="adm-row-sub">
                      {" "}
                      · oldest <RelativeTime at={item.oldestAt} />
                    </span>
                  ) : null}
                </span>
              </span>
              <Link href={item.href} className="adm-link">
                Open
                <IconArrowRight size={16} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {attentionGroups.groups.length > 0 ? (
        <ul className="adm-rows adm-alert-rows" data-testid="admin-attention">
          {attentionGroups.groups.map((group) => (
            <li key={group.kind} className="adm-row">
              <span className="adm-row-dot" data-tone="red" aria-hidden />
              <span className="adm-row-main">
                <span className="adm-row-title">
                  {group.title}
                  <span className="adm-row-code"> {group.sub}</span>
                </span>
              </span>
              {group.href !== null ? (
                <Link href={group.href} className="adm-link">
                  {group.linkLabel}
                  <IconArrowRight size={16} aria-hidden />
                </Link>
              ) : null}
            </li>
          ))}
          {attentionGroups.more > 0 ? (
            <li className="adm-row" data-testid="admin-attention-more">
              <span className="adm-row-main">
                <span className="adm-row-sub">
                  and {attentionGroups.more} more{" "}
                  {attentionGroups.more === 1 ? "problem" : "problems"}
                </span>
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

function Figure({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  /** Rendered with the figure — "3" under "Repeat org rate %" scans as a count. */
  suffix?: string;
}) {
  return (
    <div className="adm-figure">
      <dt>{label}</dt>
      {/* 1539 and 1558 were four unbroken digits the eye has to count. */}
      <dd>
        {formatCount(value)}
        {suffix ?? ""}
      </dd>
    </div>
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
    return <p className="adm-empty">{empty}</p>;
  }
  return (
    <div className="adm-chips">
      {lines.map((line) => {
        if (line.status === "live" && liveAuctions !== undefined && liveAuctions.stale > 0) {
          const running = liveAuctions.total - liveAuctions.stale;
          return (
            <span key={line.status} className="adm-chips">
              {running > 0 ? (
                <Pill tone="green" dot>
                  Live now · {formatCount(running)}
                </Pill>
              ) : null}
              <Pill tone="red" dot testId="admin-stuck-live">
                Stuck in live · {formatCount(liveAuctions.stale)}
              </Pill>
            </span>
          );
        }
        return (
          <Pill key={line.status} tone={statusPillTone(line.status)} dot>
            {lifecycleLabel(line.status)} · {formatCount(line.count)}
          </Pill>
        );
      })}
    </div>
  );
}
