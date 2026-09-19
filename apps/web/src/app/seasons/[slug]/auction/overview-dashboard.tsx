"use client";

import {
  ButtonLink,
  CardGrid,
  IconArrowRight,
  IconCheck,
  IconClock,
  IconCrown,
  IconFlag,
  IconGavel,
  IconList,
  IconMegaphone,
  IconTrophy,
  IconUsers,
  IconWallet,
  Pill,
  PlayerImage,
  SectionCard,
  TeamChip,
} from "@desiauction/ui";

import type { AuctionDashboard } from "../../../../server/auction/actions";
import type { AppointmentsPanelView } from "../../../../server/competition/appointment-actions";
import { formatTime } from "../../../../lib/format-date";
import { compactINR, exactINR } from "../../../../lib/inr";
import { lotSeed } from "../../../../lib/player-seed";
import { roleLabeller } from "../../../../lib/role-label";
import { LotStatusPill, PaddleChip, eventLabel } from "./auction-bits";
import { BroadcastLinks } from "./broadcast-links";
import { ConnectionCheck, RulesCard } from "./live-experience";

/*
 * THE OVERVIEW TAB AS A DASHBOARD (founder mockup 4).
 *
 * Once the room has opened, the organizer's first tab is a grid of cards that
 * answers the night's questions in the order they are asked: how far along is
 * it, what is on the block, where the money went, which screens to open, what
 * the rules are, whether this device can reach the room, who plans and who
 * still has to be told — then the head of the lot queue and the tail of the
 * log, each with a door to its own tab.
 *
 * Everything is a read of what the page already loaded; nothing here writes.
 * The controls that DO write (queue all, release, replay) stay on their tabs,
 * once each, so no test id is ever on the page twice.
 */

const QUEUE_PREVIEW = 8;
const LOG_PREVIEW = 5;

function TabLink({ tab, children }: { tab: string; children: string }) {
  return (
    <a className="auc-card-link" href={`#${tab}`}>
      {children}
      <IconArrowRight size={16} />
    </a>
  );
}

export function OverviewDashboard({
  slug,
  dashboard,
  appointments,
  idleHint,
}: {
  slug: string;
  dashboard: AuctionDashboard;
  appointments: AppointmentsPanelView | null;
  idleHint: string;
}) {
  const { view, viewer, overview, ready, feasibility } = dashboard;
  if (view === null || overview === null) {
    return null;
  }
  const status = view.auction.status;
  const inProgress = status === "live" || status === "paused";
  const terminal = status === "completed" || status === "reconciled" || status === "abandoned";
  const { counts, totalLots, moneyMoved, paddles, onBlock } = overview;
  const labelOf = roleLabeller(overview.roles);
  const pct = (n: number) => (totalLots > 0 ? (n / totalLots) * 100 : 0);
  const colorOfPaddle = new Map(paddles.map((row) => [row.paddleNumber, row.color]));
  const colorOfTeam = new Map(paddles.map((row) => [row.teamId, row.color]));
  const colorOfTeamName = new Map(paddles.map((row) => [row.teamName, row.color]));
  const activePaddles = new Set(paddles.map((row) => row.paddleNumber));
  const purseTotal = paddles.every((row) => row.purseTotal !== undefined)
    ? paddles.reduce((sum, row) => sum + (row.purseTotal ?? 0), 0)
    : null;
  const segments = [
    { key: "sold", label: "Sold", n: counts.sold },
    { key: "block", label: "On block", n: counts.onBlock },
    { key: "queued", label: "Queued", n: counts.queued },
    { key: "prepared", label: "Prepared", n: counts.prepared },
    { key: "unsold", label: "Unsold", n: counts.unsold },
  ];

  /* ---- Auction progress ---------------------------------------------------- */
  const progress = (
    <SectionCard
      icon={<IconTrophy />}
      title="Auction progress"
      data-testid="auction-progress-summary"
      action={
        <span className="auc-card-meta" data-testid="auction-progress-counts">
          {counts.sold} sold · {counts.onBlock} on block · {counts.queued} queued ·{" "}
          {counts.prepared} prepared · {counts.unsold} unsold
        </span>
      }
    >
      <span className="dash-progress" aria-hidden>
        {segments.map((segment) =>
          segment.n > 0 ? (
            <span
              key={segment.key}
              className="dash-progress-seg"
              data-kind={segment.key}
              style={{ width: `${String(pct(segment.n))}%` }}
            />
          ) : null,
        )}
      </span>
      <div className="dash-progress-foot">
        <ul className="dash-legend">
          {segments.map((segment) => (
            <li key={segment.key}>
              <span className="dash-key" data-kind={segment.key} aria-hidden />
              {segment.label} <strong>{segment.n}</strong>
            </li>
          ))}
        </ul>
        <span className="dash-money">
          {purseTotal !== null && purseTotal > 0 ? (
            <>
              Money used{" "}
              <strong>{((moneyMoved / purseTotal) * 100).toFixed(1).replace(/\.0$/, "")}%</strong>
              <span className="dash-money-sub"> · {compactINR(moneyMoved)}</span>
            </>
          ) : (
            <>
              Money moved <strong>{compactINR(moneyMoved)}</strong>
            </>
          )}
        </span>
      </div>
      {counts.queued === 0 && counts.prepared > 0 && !terminal ? (
        <p className="auc-card-note" data-testid="nothing-queued-hint">
          Nothing is queued yet. {counts.prepared} prepared lot
          {counts.prepared === 1 ? " is" : "s are"} waiting for “Queue all prepared” on the Players
          tab — the auction cannot open until at least one lot is queued.
        </p>
      ) : null}
    </SectionCard>
  );

  /* ---- On the block -------------------------------------------------------- */
  const blockCard = (
    <SectionCard
      icon={<IconGavel />}
      tone={onBlock !== null ? "green" : "gold"}
      title={onBlock !== null ? "On the block now" : "Nothing on the block"}
      description={onBlock === null ? idleHint : undefined}
      data-testid="on-block-card"
      className="dash-block"
    >
      {onBlock !== null ? (
        <div className="dash-block-body">
          <div className="dash-block-player">
            <PlayerImage
              name={onBlock.playerName ?? "Unnamed"}
              seed={onBlock.registrationId}
              src={onBlock.photoUrl}
              size="md"
              shape="round"
              decorative
            />
            <span className="dash-who">
              <strong>{onBlock.playerName ?? "Unnamed"}</strong>
              <span>
                {labelOf(onBlock.role)} · base {exactINR(onBlock.basePrice)}
              </span>
            </span>
          </div>
          <dl className="dash-block-bid">
            <div>
              <dt>Current bid</dt>
              <dd>{onBlock.currentBid !== null ? exactINR(onBlock.currentBid) : "No bids yet"}</dd>
            </div>
            {onBlock.leadingTeamName !== null ? (
              <div>
                <dt>Leading</dt>
                <dd>
                  <TeamChip color={onBlock.leadingColor}>{onBlock.leadingTeamName}</TeamChip>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
      {viewer.canConduct && inProgress ? (
        <div className="dash-block-actions">
          <ButtonLink href={`/seasons/${slug}/auction/cockpit`} size="touch">
            Open auction cockpit
            <IconArrowRight size={18} />
          </ButtonLink>
        </div>
      ) : terminal ? (
        <div className="dash-block-actions">
          <ButtonLink href={`/seasons/${slug}/auction/live`} variant="secondary" size="touch">
            See the final room
            <IconArrowRight size={18} />
          </ButtonLink>
        </div>
      ) : null}
    </SectionCard>
  );

  /* ---- Paddle purse breakdown --------------------------------------------- */
  const purseCard = (
    <SectionCard
      icon={<IconWallet />}
      tone="blue"
      title="Paddle purse breakdown"
      data-testid="purse-burndown"
      action={
        <span className="auc-card-meta">
          {paddles.length} paddle{paddles.length === 1 ? "" : "s"}
        </span>
      }
    >
      {paddles.length === 0 ? (
        <p className="auc-card-note">No paddles issued yet.</p>
      ) : (
        <ul className="dash-purses">
          {paddles.map((paddle) => {
            const used =
              paddle.purseTotal !== undefined && paddle.spent !== undefined && paddle.purseTotal > 0
                ? Math.round((paddle.spent / paddle.purseTotal) * 100)
                : null;
            return (
              <li key={paddle.paddleNumber}>
                <PaddleChip number={paddle.paddleNumber} color={paddle.color} />
                <span className="dash-purse-team">{paddle.teamName}</span>
                {/* DA-30: a rival's remaining purse is the one thing an auction
                    keeps back. Without money sight the figures were never sent. */}
                {used !== null ? (
                  <span
                    className="dash-bar"
                    style={paddle.color !== null ? { ["--team" as string]: paddle.color } : {}}
                    aria-hidden
                  >
                    <span style={{ width: `${String(used)}%` }} />
                  </span>
                ) : (
                  <span />
                )}
                {paddle.remaining !== undefined ? (
                  <span className="dash-purse-left">{compactINR(paddle.remaining)} left</span>
                ) : (
                  <span className="dash-purse-left">sealed</span>
                )}
                <span className="dash-purse-pct">
                  {used !== null ? `${String(used)}% used` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );

  /* ---- Ready to open ------------------------------------------------------- */
  const readyCard = (
    <SectionCard icon={<IconFlag />} tone="red" title="Ready to open" className="dash-ready">
      <ul className="dash-checks">
        {ready.checks.map((check) => (
          <li key={check.id} data-pass={check.pass}>
            <span className="dash-check-mark" aria-hidden>
              <IconCheck size={14} />
            </span>
            <span className="dash-check-label">{check.label}</span>
            <span className="dash-check-detail">
              <span className="auction-sr-only">{check.pass ? "Passed: " : "Not yet: "}</span>
              {check.detail}
            </span>
          </li>
        ))}
        <li data-pass={feasibility.ok}>
          <span className="dash-check-mark" aria-hidden>
            <IconCheck size={14} />
          </span>
          <span className="dash-check-label">Pool against squads</span>
          <span className="dash-check-detail">
            <span className="auction-sr-only">{feasibility.ok ? "Passed: " : "Not yet: "}</span>
            {feasibility.headline}
          </span>
        </li>
      </ul>
      <p className="dash-code">
        Pool of {ready.pool.length} · {ready.teams.length} teams · code {ready.competitionCode}
      </p>
    </SectionCard>
  );

  /* ---- Owner plans (the switch holder only; plans themselves stay private) - */
  const ownerPlans = dashboard.ownerPlans;
  const plansCard =
    ownerPlans !== undefined ? (
      <SectionCard
        icon={<IconCrown />}
        title="Owner plans"
        description={
          ownerPlans.enabled
            ? "Each team owner keeps a private list of who they want and the most they'd pay. Their lists are never shown here — you see what they've spent."
            : "Owner plans are switched off for this auction. Switch them on in Room."
        }
        action={
          viewer.planAvailable ? (
            <ButtonLink href={`/seasons/${slug}/auction/plan`} variant="secondary" size="sm">
              View my plan
            </ButtonLink>
          ) : (
            <Pill tone={ownerPlans.enabled ? "green" : "neutral"} dot>
              {ownerPlans.enabled ? "On" : "Off"}
            </Pill>
          )
        }
      >
        {ownerPlans.enabled && view.paddles.length > 0 ? (
          <ul className="dash-plans">
            {view.paddles.map((paddle) => (
              <li key={paddle.id}>
                <PaddleChip
                  number={paddle.paddleNumber}
                  color={colorOfTeam.get(paddle.teamId) ?? null}
                />
                <span className="dash-plan-text">
                  <strong>{paddle.teamName}</strong>
                  <span>
                    {paddle.committed !== undefined
                      ? `committed ${exactINR(paddle.committed)}`
                      : "purse sealed"}{" "}
                    · squad {paddle.squadSize}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </SectionCard>
    ) : null;

  /* ---- Paddles (read; Release lives on the Paddles tab) -------------------- */
  const paddlesCard = (
    <SectionCard
      icon={<IconUsers />}
      tone="amber"
      title="Paddles"
      description="One paddle per team, held by the team's owner on their own device."
      action={<TabLink tab="paddles">Manage</TabLink>}
      flush
    >
      {view.paddles.length === 0 ? (
        <p className="auc-card-note dash-pad">No paddles yet.</p>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th scope="col">Paddle</th>
              <th scope="col">Team</th>
              <th scope="col" className="dash-hide-sm">
                Owner
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {view.paddles.map((paddle) => {
              const active = activePaddles.has(paddle.paddleNumber);
              return (
                <tr key={paddle.id}>
                  <td>
                    <PaddleChip
                      number={paddle.paddleNumber}
                      color={colorOfTeam.get(paddle.teamId) ?? null}
                    />
                  </td>
                  <td className="dash-strong">{paddle.teamName}</td>
                  <td className="dash-hide-sm dash-muted">{paddle.holderName ?? "Not claimed"}</td>
                  <td>
                    <Pill tone={active ? "green" : "neutral"} dot>
                      {active ? "Active" : "Released"}
                    </Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SectionCard>
  );

  /* ---- Announce captains & icons (sending stays on Teams) ------------------ */
  const appointmentsCard =
    appointments !== null ? (
      <SectionCard
        icon={<IconMegaphone />}
        title="Announce captains & icons"
        description={
          appointments.pending.length === 0
            ? appointments.told > 0
              ? `Everyone named has been told (${String(appointments.told)}).`
              : "Name captains and icons on a team's roster, then announce them from Teams."
            : `${String(appointments.pending.length)} named but not told yet. Each gets an inbox message, and an email if they have a verified address.`
        }
        action={
          <ButtonLink href={`/seasons/${slug}/teams`} variant="secondary" size="sm">
            {appointments.pending.length > 0 ? "Announce on Teams" : "Open Teams"}
          </ButtonLink>
        }
        flush
      >
        {appointments.pending.length > 0 ? (
          <table className="dash-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Player</th>
                <th scope="col">Role</th>
                <th scope="col">Team</th>
              </tr>
            </thead>
            <tbody>
              {appointments.pending.slice(0, QUEUE_PREVIEW).map((item, index) => (
                <tr key={`${item.name}-${item.role}-${item.team}`}>
                  <td className="dash-muted">{index + 1}</td>
                  <td className="dash-strong">{item.name}</td>
                  <td>
                    <Pill tone={/captain/i.test(item.role) ? "blue" : "amber"}>{item.role}</Pill>
                  </td>
                  <td>
                    <TeamChip color={colorOfTeamName.get(item.team) ?? null}>{item.team}</TeamChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </SectionCard>
    ) : null;

  /* ---- Lot queue preview --------------------------------------------------- */
  const lots = view.lots.slice(0, QUEUE_PREVIEW);
  const queueCard = (
    <SectionCard
      icon={<IconList />}
      title="Lot queue"
      description={`${String(view.lots.length)} lots · registration-number order`}
      action={<TabLink tab="players">View all</TabLink>}
      flush
    >
      {lots.length === 0 ? (
        <p className="auc-card-note dash-pad">No players in this auction.</p>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Player</th>
              <th scope="col" className="dash-hide-sm">
                Role
              </th>
              <th scope="col" className="dash-hide-sm">
                Base
              </th>
              <th scope="col">Status</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr key={lot.id}>
                <td className="dash-muted dash-mono">{lot.lotNumber}</td>
                <td>
                  <span className="dash-player">
                    <PlayerImage
                      name={lot.playerName ?? "Unnamed"}
                      seed={lotSeed(lot.id, dashboard.lotMedia)}
                      src={dashboard.lotMedia[lot.id]?.photoUrl ?? null}
                      size="xs"
                      shape="round"
                      decorative
                    />
                    <span className="dash-strong">{lot.playerName ?? "Unnamed"}</span>
                  </span>
                </td>
                <td className="dash-hide-sm dash-muted">{labelOf(lot.role)}</td>
                <td className="dash-hide-sm dash-muted">{exactINR(lot.basePrice)}</td>
                <td>
                  <LotStatusPill status={lot.status} />
                </td>
                <td>
                  {lot.soldPrice !== null ? (
                    <span className="dash-result">
                      <strong>{exactINR(lot.soldPrice)}</strong>
                      {lot.soldToPaddle !== null ? (
                        <PaddleChip
                          number={lot.soldToPaddle}
                          color={colorOfPaddle.get(lot.soldToPaddle) ?? null}
                        />
                      ) : null}
                    </span>
                  ) : (
                    <span className="dash-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );

  /* ---- Event log preview --------------------------------------------------- */
  const logCard = (
    <SectionCard
      icon={<IconClock />}
      tone="neutral"
      title="Event log & replay"
      description={`${String(view.eventCount)} immutable events · single-writer order`}
      action={<TabLink tab="log">View all events</TabLink>}
      flush
    >
      <table className="dash-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Event</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {view.events.slice(0, LOG_PREVIEW).map((event) => (
            <tr key={event.seq}>
              <td className="dash-muted dash-mono">#{event.seq}</td>
              <td className="dash-strong">{eventLabel(event.type)}</td>
              <td className="dash-muted">{formatTime(event.atMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  );

  const showScreens = viewer.canConduct && status !== "abandoned";

  return (
    <div className="dash" data-testid="auction-dashboard">
      {progress}
      <CardGrid>
        {blockCard}
        {purseCard}
      </CardGrid>
      <CardGrid>
        {showScreens ? <BroadcastLinks slug={slug} /> : null}
        {dashboard.rules !== null ? (
          <RulesCard
            rules={dashboard.rules}
            action={<TabLink tab="room">Room &amp; settings</TabLink>}
          />
        ) : null}
      </CardGrid>
      <CardGrid>
        {dashboard.wsUrl !== null ? <ConnectionCheck wsUrl={dashboard.wsUrl} /> : null}
        {readyCard}
      </CardGrid>
      {plansCard}
      <CardGrid>
        {paddlesCard}
        {appointmentsCard}
      </CardGrid>
      {queueCard}
      {logCard}
    </div>
  );
}
