"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import {
  Badge,
  Button,
  ButtonLink,
  PlayerImage,
  Select,
  useToast,
  type TabItem,
} from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  auctionLifecycleAction,
  issuePaddleAction,
  queueAllLotsAction,
  releasePaddleAction,
  setAuctionFeatureAction,
  verifyReplayAction,
  type AuctionDashboard,
  type ReplayVerifyReport,
} from "../../../../server/auction/actions";
import { HashTabs } from "../../../../components/hash-tabs/hash-tabs";
import { formatTime } from "../../../../lib/format-date";
import { compactINR } from "../../../../lib/inr";
import { lotSeed } from "../../../../lib/player-seed";
import { AbortDialog } from "./abort-dialog";
import { AuctionSetupFlow } from "./setup/setup-flow";
import { ConnectionCheck, RulesCard } from "./live-experience";
import { useHydrated } from "../../../../lib/use-hydrated";
import "./hub.css";

/*
 * THE AUCTION DESK, ONE SECTION AT A TIME.
 *
 * This page used to be every panel of the night stacked in one column — the
 * progress, the screens, the rules, the connection, the gates, the lifecycle,
 * the paddles, the lot table and a forty-row event log — 4,700px on a laptop
 * and 6,500px on a phone, with the one control that mattered somewhere in the
 * middle. Now a ruled figure strip says where the night stands, and tabs hold
 * the rest: the setup steps (or, once the room is open, the overview and its
 * controls), the players, the paddles, the room's screens and settings, and
 * the log. The tab lives in the URL hash, so a reload keeps its place.
 *
 * Server-rendered pieces (the overview, the broadcast links, the auctioneer
 * panel) arrive as slots from page.tsx.
 */

const LOT_TONE = {
  prepared: "neutral",
  queued: "info",
  on_block: "success",
  closing_soon: "warning",
  sold: "success",
  unsold: "neutral",
  frozen: "warning",
  withdrawn: "danger",
} as const;

// One legal next step per status, rendered one gate at a time.
const AUCTION_NEXT: Partial<Record<string, { command: string; label: string }[]>> = {
  scheduled: [{ command: "open", label: "Open auction" }],
  live: [
    { command: "pause", label: "Pause" },
    { command: "complete", label: "Close auction" },
  ],
  paused: [
    { command: "resume", label: "Resume" },
    { command: "complete", label: "Close auction" },
  ],
};

type LotFilter = "all" | "waiting" | "sold" | "unsold";

const LOT_FILTERS: { id: LotFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Still to come" },
  { id: "sold", label: "Sold" },
  { id: "unsold", label: "Unsold" },
];

function lotMatches(filter: LotFilter, status: string): boolean {
  switch (filter) {
    case "all":
      return true;
    case "waiting":
      return (
        status === "prepared" ||
        status === "queued" ||
        status === "on_block" ||
        status === "closing_soon" ||
        status === "frozen"
      );
    case "sold":
      return status === "sold";
    case "unsold":
      return status === "unsold" || status === "withdrawn";
  }
}

/** "LotClosingSoon" → "Lot closing soon": the log reads as sentences. */
function eventLabel(type: string): string {
  const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const LOG_PREVIEW = 12;

export function AuctionPanel({
  slug,
  dashboard,
  overviewSlot,
  broadcastSlot,
  auctioneersSlot,
}: {
  slug: string;
  dashboard: AuctionDashboard;
  /** The operational read (progress, block, burndown) — live and after. */
  overviewSlot?: ReactNode;
  /** The board and overlay addresses, for anyone who can conduct. */
  broadcastSlot?: ReactNode;
  /** Who else may run this room. */
  auctioneersSlot?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [paddleTeam, setPaddleTeam] = useState("");
  const [report, setReport] = useState<ReplayVerifyReport | null>(null);
  const [lotFilter, setLotFilter] = useState<LotFilter>("all");
  const [logOpen, setLogOpen] = useState(false);
  const hydrated = useHydrated();
  // WR-1: optimistic, then reconciled — a fully server-controlled checkbox
  // snaps back before the refresh lands, which reads as a switch that ignores
  // the click (and is exactly what a browser automation sees).
  // The server's answer is remembered beside the optimistic one, so a new
  // answer (the refresh after a save) replaces the guess in the same render.
  const serverOwnerPlansOn = dashboard.ownerPlans?.enabled ?? true;
  const [ownerPlans, setOwnerPlans] = useState({
    server: serverOwnerPlansOn,
    on: serverOwnerPlansOn,
  });
  if (ownerPlans.server !== serverOwnerPlansOn) {
    setOwnerPlans({ server: serverOwnerPlansOn, on: serverOwnerPlansOn });
  }
  const ownerPlansOn = ownerPlans.on;
  const setOwnerPlansOn = (on: boolean) => {
    setOwnerPlans((current) => ({ ...current, on }));
  };

  const { ready, view, viewer } = dashboard;
  /*
   * Before the room opens, the page is the guided setup (setup/setup-flow.tsx):
   * the gates, the rules form, owners, queueing and "Open auction" all live in
   * its steps. What stays below is the room's record — rules, status, paddles,
   * the lot list, the event log — so each control exists exactly once.
   */
  const setupMode =
    view === null || view.auction.status === "scheduled" || view.auction.status === "abandoned";

  const liveFeasibility = dashboard.feasibility;

  /**
   * THE GO-LIVE GUARD, SAID BEFORE THE CLICK INSTEAD OF AFTER IT (PA-1 §13).
   *
   * `packages/core` refuses `open` without at least two CLAIMED paddles and one
   * queued lot, and `guardFailureDetail` explains why — in a toast, after the
   * conductor has already pressed the button in front of a full room. It is
   * also the single most common first-run mistake, because paddles are claimed
   * by owners on their OWN devices: the organizer issues invitations and cannot
   * complete the step themselves, and nothing on this screen said so.
   *
   * Both numbers are already on this page. The guard is restated here rather
   * than imported because the button only needs to know whether to wait; the
   * engine remains the authority and refuses regardless. Should these ever
   * disagree, the engine wins and the conductor sees the toast — the old
   * behaviour, not a worse one.
   */
  // DISTINCT TEAMS, matching `auctionReadiness` exactly — it counts
  // `count(distinct paddles.team_id) where released_at is null`, not paddle
  // rows, and the whole value of this hint is that it agrees with the guard.
  // Counting rows instead would risk DISABLING a button the engine would have
  // accepted, which is a worse failure than the late toast being replaced.
  const claimedTeams = new Set((dashboard.overview?.paddles ?? []).map((paddle) => paddle.teamId))
    .size;
  const queuedLots = dashboard.overview?.counts.queued ?? 0;
  const goLiveBlockers: string[] = [];
  if (claimedTeams < 2) {
    goLiveBlockers.push(
      claimedTeams === 0
        ? "no paddles claimed yet — owners claim their own from the invitation link"
        : "only one paddle claimed — a second owner has to claim theirs before bidding can start",
    );
  }
  if (queuedLots < 1) {
    goLiveBlockers.push("no lots are queued — queue the pool first");
  }

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    if (result.ok) {
      if (done !== undefined) {
        toast({ title: done, tone: "success" });
      }
      router.refresh();
    } else {
      toast({ title: result.error ?? "Refused.", tone: "danger" });
    }
  };

  const verify = async () => {
    setBusy(true);
    const result = await verifyReplayAction(slug);
    setBusy(false);
    if (result.ok && result.report !== undefined) {
      setReport(result.report);
      router.refresh();
    } else {
      toast({ title: result.error ?? "Replay failed.", tone: "danger" });
    }
  };

  const status = view?.auction.status ?? null;
  const terminal = status === "completed" || status === "reconciled" || status === "abandoned";
  const teamOfPaddle = new Map(
    (view?.paddles ?? []).map((row) => [row.paddleNumber, row.teamName]),
  );
  const counts = dashboard.overview?.counts ?? null;

  /* ---- Figures: where the night stands, before any tab is opened. ---------- */
  // Four figures, the four a phone can hold two-by-two. Before and during
  // the night "still to come" is the number that matters; after it, the money.
  const figures =
    view !== null && counts !== null ? (
      <div className="stat-row auc-figures" data-testid="auction-figures">
        <div className="stat-tile">
          <span className="stat-value">{view.lots.length}</span>
          <span className="stat-label">Players in the auction</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">
            {claimedTeams}/{ready.teams.length}
          </span>
          <span className="stat-label">{terminal ? "Teams that bid" : "Teams ready to bid"}</span>
        </div>
        {terminal ? null : (
          <div className="stat-tile">
            <span className="stat-value">{counts.queued + counts.prepared + counts.onBlock}</span>
            <span className="stat-label">Still to come</span>
          </div>
        )}
        <div className="stat-tile">
          <span className="stat-value">{counts.sold}</span>
          <span className="stat-label">
            Sold{counts.unsold > 0 ? ` · ${String(counts.unsold)} unsold` : ""}
          </span>
        </div>
        {terminal && dashboard.overview !== null ? (
          <div className="stat-tile">
            <span className="stat-value">{compactINR(dashboard.overview.moneyMoved)}</span>
            <span className="stat-label">Spent</span>
          </div>
        ) : null}
      </div>
    ) : null;

  /* ---- Overview (once the room has opened): the read + its controls. ------- */
  const lifecycleButtons =
    view !== null && viewer.canConduct && !setupMode
      ? (AUCTION_NEXT[view.auction.status] ?? []).map((step) =>
          // DO NOT OFFER WHAT THIS SCREEN CANNOT DO. Closing a short auction
          // needs a REASON on the record (DA-06), and the place that asks for
          // one is the cockpit's two-act dialog — so here it is a link there,
          // never a button whose only outcome is a refusal.
          step.command === "complete" && !liveFeasibility.ok ? (
            <ButtonLink
              key={step.command}
              href={`/seasons/${slug}/auction/cockpit`}
              variant="secondary"
              size="touch"
              data-testid="auction-complete-on-cockpit"
            >
              Close short — on the cockpit
            </ButtonLink>
          ) : (
            <Button
              key={step.command}
              size="touch"
              variant={step.command === "complete" ? "secondary" : "primary"}
              onClick={() =>
                void act(
                  () =>
                    auctionLifecycleAction(slug, step.command, undefined, {
                      acceptShortSquads: false,
                    }),
                  step.label,
                )
              }
              loading={busy}
              disabled={step.command === "open" && goLiveBlockers.length > 0}
              data-testid={`auction-${step.command}`}
            >
              {step.label}
            </Button>
          ),
        )
      : [];

  const overviewTab = (
    <div className="auc-section-stack">
      {lifecycleButtons.length > 0 ? (
        <section className="auc-section" aria-labelledby="auc-controls-title">
          <div className="auc-section-head">
            <h2 id="auc-controls-title">Run the room</h2>
            <p className="auc-section-hint">
              Bidding itself happens in the cockpit. These pause or close the whole auction.
            </p>
          </div>
          <div className="date-row">{lifecycleButtons}</div>
        </section>
      ) : null}
      {/* The shortfall follows the auction to its close — stated every time
          the page is opened, not discovered at 11pm behind a refusal. */}
      {view !== null && !liveFeasibility.ok && !terminal ? (
        <p className="auction-feasibility is-short" data-testid="feasibility-banner">
          {liveFeasibility.headline} Closing this auction will need the conductor&apos;s override on
          the cockpit (Close auction → “Close short — on the record”).
        </p>
      ) : null}
      {overviewSlot}
    </div>
  );

  /* ---- Players: the lot list, with faces. --------------------------------- */
  const visibleLots = (view?.lots ?? []).filter((lot) => lotMatches(lotFilter, lot.status));
  const playersTab =
    view === null ? null : (
      <section className="auc-section" data-testid="lot-queue" aria-labelledby="auc-lots-title">
        <div className="auc-section-head auc-section-head-row">
          <div>
            <h2 id="auc-lots-title">Players under the hammer</h2>
            <p className="auc-section-hint">
              {view.lots.length} players, in registration-number order. Queued players come up one
              by one.
            </p>
          </div>
          {viewer.canConduct && !setupMode && (counts?.prepared ?? 0) > 0 ? (
            <Button
              variant="secondary"
              size="touch"
              onClick={() => void act(() => queueAllLotsAction(slug), "Lots queued")}
              loading={busy}
              data-testid="queue-all"
            >
              Queue {counts?.prepared ?? 0} waiting
            </Button>
          ) : null}
        </div>
        <div className="auc-filter" role="group" aria-label="Show players">
          {LOT_FILTERS.map((option) => {
            const n = view.lots.filter((lot) => lotMatches(option.id, lot.status)).length;
            return (
              <button
                key={option.id}
                type="button"
                className="auc-filter-chip"
                aria-pressed={lotFilter === option.id}
                onClick={() => {
                  setLotFilter(option.id);
                }}
              >
                {option.label}
                <span className="auc-filter-count">{n}</span>
              </button>
            );
          })}
        </div>
        <ul className="auc-lots" data-testid="lots-table">
          {visibleLots.map((lot) => {
            const soldTo =
              lot.soldToPaddle === null
                ? null
                : (teamOfPaddle.get(lot.soldToPaddle) ?? lot.soldToPaddle);
            return (
              <li
                key={lot.id}
                className="auc-lot"
                data-status={lot.status}
                data-testid={`lot-${lot.lotNumber}`}
              >
                <span className="auc-lot-number">{lot.lotNumber}</span>
                <PlayerImage
                  name={lot.playerName ?? "Unnamed"}
                  seed={lotSeed(lot.id, dashboard.lotMedia)}
                  src={dashboard.lotMedia[lot.id]?.photoUrl ?? null}
                  size="sm"
                  shape="round"
                  decorative
                />
                <span className="auc-lot-who">
                  <span className="auc-lot-name">{lot.playerName ?? "Unnamed"}</span>
                  <span className="auc-lot-meta">
                    {lot.role.replace(/_/g, " ")} · base {formatPaiseINR(paise(lot.basePrice))}
                  </span>
                </span>
                <span className="auc-lot-status">
                  <Badge tone={LOT_TONE[lot.status]}>{lot.status.replace(/_/g, " ")}</Badge>
                </span>
                <span className="auc-lot-result">
                  {lot.soldPrice !== null ? (
                    <>
                      <strong>{formatPaiseINR(paise(lot.soldPrice))}</strong>
                      {soldTo !== null ? <span> → {soldTo}</span> : null}
                    </>
                  ) : lot.bidCount > 0 ? (
                    `${String(lot.bidCount)} bid${lot.bidCount === 1 ? "" : "s"}`
                  ) : null}
                </span>
              </li>
            );
          })}
          {visibleLots.length === 0 ? (
            <li className="auc-empty">
              {view.lots.length === 0 ? "No players in this auction." : "No players here yet."}
            </li>
          ) : null}
        </ul>
      </section>
    );

  /* ---- Paddles: who holds each team's paddle. ----------------------------- */
  const paddlesTab =
    view === null ? null : (
      <section className="auc-section" data-testid="paddles-panel" aria-labelledby="auc-pad-title">
        <div className="auc-section-head">
          <h2 id="auc-pad-title">Paddles</h2>
          {/* THE PADDLE TRAP, stated before auction night instead of
              discovered in the hall: "Issue paddle" hands the paddle to
              WHOEVER CLICKS IT, and one browser can hold one paddle. */}
          <p className="auc-section-hint">
            {setupMode ? (
              <>
                Owners get their paddle through the <strong>Team owners</strong> setup step. Issuing
                one here gives it to <strong>you</strong> — only useful for a test run on your own
                devices.
              </>
            ) : (
              <>
                One paddle per team, held by the team&apos;s owner on their own device. Issuing here
                gives the paddle to <strong>you</strong>. Release hands one back.
              </>
            )}
          </p>
        </div>
        {view.paddles.length === 0 ? (
          <p className="auc-empty">No paddles yet.</p>
        ) : (
          <ul className="auc-pad-list">
            {view.paddles.map((paddle) => {
              // The overview lists ACTIVE paddles only (released ones are
              // filtered at the read), which is how a released paddle is told
              // apart from a live one here.
              const active =
                dashboard.overview === null ||
                dashboard.overview.paddles.some((row) => row.paddleNumber === paddle.paddleNumber);
              return (
                <li
                  key={paddle.id}
                  className="auc-pad-row"
                  data-active={active ? "true" : "false"}
                  data-testid={`paddle-${paddle.paddleNumber}`}
                >
                  <span className="auc-pad-number">{paddle.paddleNumber}</span>
                  <span className="auc-pad-team">
                    <span className="auc-lot-name">{paddle.teamName}</span>
                    <span className="auc-lot-meta">
                      {active ? (paddle.holderName ?? "Not claimed") : "Released"}
                    </span>
                  </span>
                  <span className="auc-pad-figures">
                    {paddle.committed !== undefined ? (
                      <span>
                        <strong>{formatPaiseINR(paise(paddle.committed))}</strong> spent
                      </span>
                    ) : null}
                    <span>
                      <strong>{paddle.squadSize}</strong> signed
                    </span>
                  </span>
                  {viewer.canConduct && active ? (
                    <Button
                      variant="ghost"
                      size="touch"
                      onClick={() =>
                        void act(() => releasePaddleAction(slug, paddle.teamId), "Paddle released")
                      }
                      loading={busy}
                      data-testid={`release-paddle-${paddle.paddleNumber}`}
                    >
                      Release
                    </Button>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {/* Issuing a paddle hands its purse to whoever clicks — the season
            manager's act, never the appointed auctioneer's. */}
        {viewer.canManage && !terminal ? (
          <div className="auc-inline-form">
            <Select
              label="Issue a paddle to yourself for"
              name="paddleTeam"
              value={paddleTeam}
              onChange={(event) => {
                setPaddleTeam(event.target.value);
              }}
            >
              <option value="">Choose a team…</option>
              {ready.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
            <Button
              size="touch"
              variant="secondary"
              onClick={() => void act(() => issuePaddleAction(slug, paddleTeam), "Paddle issued")}
              loading={busy}
              disabled={paddleTeam === ""}
              data-testid="issue-paddle"
            >
              Issue paddle
            </Button>
          </div>
        ) : null}
      </section>
    );

  /* ---- Room: screens, rules, settings, staff. ------------------------------ */
  const showOwnerPlans = view !== null && viewer.canManage && dashboard.ownerPlans !== undefined;
  const showAbort = view !== null && viewer.canManage && !terminal;
  // Two columns on a wide screen: what you open elsewhere on the left, what
  // is set for this room on the right.
  const roomTab = (
    <div className="auc-room">
      <div className="auc-section-stack">
        {broadcastSlot}
        {dashboard.wsUrl !== null && !setupMode ? (
          <ConnectionCheck wsUrl={dashboard.wsUrl} />
        ) : null}
        {dashboard.rules !== null ? <RulesCard rules={dashboard.rules} /> : null}
      </div>
      <div className="auc-section-stack">
        {showOwnerPlans && dashboard.ownerPlans !== undefined ? (
          <section className="auc-section" aria-labelledby="auc-settings-title">
            <div className="auc-section-head">
              <h2 id="auc-settings-title">Settings</h2>
            </div>
            {/* WR-1: the organizer's switch for owner plans. Outside the locked
              config on purpose — a switch flipped mid-season is not a rule of
              the night. Layers above (platform, club, deploy) can only be read
              here, so the row says when one of them has decided. */}
            <label className="plan-switch" htmlFor="owner-plans-switch">
              <input
                id="owner-plans-switch"
                type="checkbox"
                checked={ownerPlansOn}
                disabled={
                  busy ||
                  (dashboard.ownerPlans.deniedBy !== null &&
                    dashboard.ownerPlans.deniedBy !== "auction")
                }
                data-testid="owner-plans-switch"
                onChange={(event) => {
                  const next = event.target.checked;
                  setOwnerPlansOn(next);
                  void (async () => {
                    setBusy(true);
                    const result = await setAuctionFeatureAction(slug, next);
                    setBusy(false);
                    if (result.ok) {
                      toast({
                        title: next ? "Owner plans on" : "Owner plans off",
                        tone: "success",
                      });
                      router.refresh();
                    } else {
                      setOwnerPlansOn(!next);
                      toast({ title: result.error ?? "Refused.", tone: "danger" });
                    }
                  })();
                }}
              />
              <span className="plan-switch-text">
                <span className="plan-switch-label">Owner plans</span>
                <span className="plan-switch-detail">
                  {dashboard.ownerPlans.deniedBy !== null &&
                  dashboard.ownerPlans.deniedBy !== "auction"
                    ? "Switched off above this auction — the platform or your club decides this one."
                    : "Owners keep a private wish list with the most they'd pay, and see it against the live bidding. Never visible to you or rival owners."}
                </span>
              </span>
            </label>
          </section>
        ) : null}
        {auctioneersSlot}
        {showAbort ? (
          <section className="auc-section auc-danger" aria-labelledby="auc-danger-title">
            <div className="auc-section-head">
              <h2 id="auc-danger-title">Abort this auction</h2>
              <p className="auc-section-hint">
                Ends it for good — there is no way back, and the reason goes on the record.
              </p>
            </div>
            {/* Behind a confirmation: `abandoned` is terminal and there is no
              command back. */}
            <div className="date-row">
              <AbortDialog
                busy={busy}
                onAbort={(reason) => {
                  void act(() => auctionLifecycleAction(slug, "abort", reason), "Auction aborted");
                }}
              />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );

  /* ---- Log: the immutable record, newest first. --------------------------- */
  const logEvents = view === null ? [] : logOpen ? view.events : view.events.slice(0, LOG_PREVIEW);
  const logTab =
    view === null ? null : (
      <section className="auc-section" data-testid="replay-panel" aria-labelledby="auc-log-title">
        <div className="auc-section-head auc-section-head-row">
          <div>
            <h2 id="auc-log-title">Event log</h2>
            <p className="auc-section-hint">
              {view.eventCount} events, written once and never edited. Replaying them rebuilds the
              auction from scratch.
            </p>
          </div>
          {viewer.canConduct ? (
            <Button
              variant="secondary"
              size="touch"
              onClick={() => void verify()}
              loading={busy}
              data-testid="verify-replay"
            >
              Replay &amp; verify
            </Button>
          ) : null}
        </div>
        {report !== null ? (
          <p data-testid="replay-report" className="auc-report" data-ok={report.ok}>
            {report.ok
              ? report.divergences === 0
                ? `Replayed ${String(report.eventCount)} events — everything matches.`
                : `Replayed ${String(report.eventCount)} events — repaired ${String(report.divergences)} difference(s) from the log.`
              : `Replay failed closed: ${report.reason ?? ""}`}
          </p>
        ) : null}
        <ol className="auc-ev-list">
          {logEvents.map((event) => (
            <li key={event.seq}>
              <span className="auc-ev-seq">#{event.seq}</span>
              <span className="auc-ev-type">{eventLabel(event.type)}</span>
              <span className="auc-ev-at">{formatTime(event.atMs)}</span>
            </li>
          ))}
        </ol>
        {view.events.length > LOG_PREVIEW ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLogOpen((open) => !open);
            }}
            data-testid="log-toggle"
          >
            {logOpen ? "Show fewer" : `Show all ${String(view.events.length)} events`}
          </Button>
        ) : null}
      </section>
    );

  const tabs: TabItem[] = [];
  if (setupMode) {
    tabs.push({
      id: "setup",
      label: "Setup",
      content: <AuctionSetupFlow slug={slug} dashboard={dashboard} />,
    });
  } else {
    tabs.push({ id: "overview", label: "Overview", content: overviewTab });
  }
  if (playersTab !== null && view !== null) {
    tabs.push({ id: "players", label: "Players", badge: view.lots.length, content: playersTab });
  }
  if (paddlesTab !== null && view !== null) {
    tabs.push({
      id: "paddles",
      label: "Paddles",
      badge: `${String(claimedTeams)}/${String(ready.teams.length)}`,
      content: paddlesTab,
    });
  }
  tabs.push({ id: "room", label: "Room", content: roomTab });
  if (logTab !== null && view !== null) {
    tabs.push({ id: "log", label: "Log", badge: view.eventCount, content: logTab });
  }

  return (
    <div
      className="auc-hub"
      data-testid="auction-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      {figures}
      <HashTabs tabs={tabs} label="Auction sections" defaultId={setupMode ? "setup" : "overview"} />
    </div>
  );
}
