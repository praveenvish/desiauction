"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, Button, Card, Select, useToast, ButtonLink } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { formatTime } from "../../../../lib/format-date";
import { AbortDialog } from "./abort-dialog";
import { AuctionSetupFlow } from "./setup/setup-flow";
import { ConnectionCheck, RulesCard } from "./live-experience";
import { useHydrated } from "../../../../lib/use-hydrated";

// The auction desk: readiness gates, creation, lifecycle, paddles, the lot
// queue and the replay proof. The operational dashboard above it is rendered by
// AuctionOverviewPanel; the live bidding surfaces are /live and /cockpit.

const AUCTION_TONE = {
  scheduled: "info",
  live: "success",
  paused: "warning",
  completed: "neutral",
  reconciled: "neutral",
  abandoned: "danger",
} as const;

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

export function AuctionPanel({ slug, dashboard }: { slug: string; dashboard: AuctionDashboard }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [paddleTeam, setPaddleTeam] = useState("");
  const [report, setReport] = useState<ReplayVerifyReport | null>(null);
  const hydrated = useHydrated();
  const [acceptShortOpen, setAcceptShortOpen] = useState(false);
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

  return (
    <div
      className="competitions-stack"
      data-testid="auction-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      {setupMode ? <AuctionSetupFlow slug={slug} dashboard={dashboard} /> : null}
      {setupMode && view !== null ? <h2 className="as-details-title">Room details</h2> : null}
      {dashboard.rules !== null ? <RulesCard rules={dashboard.rules} /> : null}
      {dashboard.wsUrl !== null && !setupMode ? <ConnectionCheck wsUrl={dashboard.wsUrl} /> : null}

      {view !== null ? (
        <>
          <Card data-testid="auction-lifecycle">
            <div className="competition-head">
              <h2>{view.auction.name}</h2>
              <Badge tone={AUCTION_TONE[view.auction.status]} data-testid="auction-status">
                {view.auction.status}
              </Badge>
            </div>
            <p className="competitions-hint">
              {/* DA-30: purse is money sight. Absent from the payload, not
                  dimmed in the markup, for anyone without it. */}
              {view.auction.config.pursePerTeam !== undefined
                ? `Purse ${formatPaiseINR(paise(view.auction.config.pursePerTeam))} · `
                : ""}
              squad {view.auction.config.squadMin}–{view.auction.config.squadMax} · timer{" "}
              {view.auction.config.timer.initialSeconds}s +{" "}
              {view.auction.config.timer.extensionSeconds}s anti-snipe · config locked at creation
            </p>
            {/* WR-1: the organizer's switch for owner plans. Outside the locked
                config on purpose — a switch flipped mid-season is not a rule of
                the night. Layers above (platform, club, deploy) can only be
                read here, so the row says when one of them has decided. */}
            {viewer.canManage && dashboard.ownerPlans !== undefined ? (
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
                      : "Team owners keep a private list of who they want and the most they'd pay, and see it against the live bidding. Off hides it for every team in this auction. It is never visible to you or to rival owners."}
                  </span>
                </span>
              </label>
            ) : null}
            {/* The shortfall follows the auction all the way to its close —
                stated here every time the page is opened, not discovered at
                11pm behind a refusal. */}
            {!liveFeasibility.ok ? (
              <p className="auction-feasibility is-short" data-testid="feasibility-banner">
                {liveFeasibility.headline} Closing this auction will need the conductor&apos;s
                override on the cockpit (Close auction → “Close short — on the record”).
              </p>
            ) : null}
            {viewer.canConduct ? (
              <div className="date-row">
                {(setupMode ? [] : (AUCTION_NEXT[view.auction.status] ?? [])).map((step) =>
                  // DO NOT OFFER WHAT THIS SCREEN CANNOT DO.
                  //
                  // Closing an auction whose squads are short needs a REASON on
                  // the record (DA-06), and the place that asks for one is the
                  // cockpit's two-act dialog. This panel has no such dialog, and
                  // its Close passed no override at all — so for a short auction
                  // the button could only ever produce a refusal. The refusal
                  // was at least well-written (it names the cockpit and the
                  // exact control), but a button whose only outcome is an error
                  // is a worse thing to put in front of a conductor at 11pm than
                  // a link to where the work happens.
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
                      onClick={() =>
                        void act(
                          () =>
                            auctionLifecycleAction(slug, step.command, undefined, {
                              acceptShortSquads: acceptShortOpen,
                            }),
                          step.label,
                        )
                      }
                      loading={busy}
                      // Only `open` carries the go-live guard; pause, resume and
                      // the rest must never be gated on paddle counts.
                      disabled={step.command === "open" && goLiveBlockers.length > 0}
                      data-testid={`auction-${step.command}`}
                    >
                      {step.label}
                    </Button>
                  ),
                )}
                {viewer.canManage &&
                view.auction.status !== "completed" &&
                view.auction.status !== "reconciled" &&
                view.auction.status !== "abandoned" ? (
                  /* Behind a confirmation now. This is the catastrophic exit —
                     `abandoned` is terminal and there is no command back — and
                     it used to be a single tap beside Pause, with the reason
                     hardcoded to "conductor abort" so the log never said why. */
                  <AbortDialog
                    busy={busy}
                    onAbort={(reason) => {
                      void act(
                        () => auctionLifecycleAction(slug, "abort", reason),
                        "Auction aborted",
                      );
                    }}
                  />
                ) : null}
              </div>
            ) : null}
            {/* A disabled control must always say why, or it is just a dead
                button. This is the one place a first-time organizer stalls, so
                it names the blocker AND who can clear it — several of these are
                not things the organizer can do from this screen at all. */}
            {viewer.canConduct &&
            !setupMode &&
            view.auction.status === "scheduled" &&
            goLiveBlockers.length > 0 ? (
              <p className="competitions-hint" data-testid="auction-open-blockers">
                Not ready to open: {goLiveBlockers.join("; ")}.
              </p>
            ) : null}
            {viewer.canConduct &&
            !setupMode &&
            view.auction.status === "scheduled" &&
            !liveFeasibility.ok ? (
              <label className="auction-ack">
                <input
                  type="checkbox"
                  checked={acceptShortOpen}
                  data-testid="accept-short-open"
                  onChange={(event) => {
                    setAcceptShortOpen(event.target.checked);
                  }}
                />
                <span>
                  Open anyway — {liveFeasibility.shortfall} squad place
                  {liveFeasibility.shortfall === 1 ? "" : "s"} cannot be filled from this pool.
                </span>
              </label>
            ) : null}
          </Card>

          <Card data-testid="paddles-panel">
            <h2>Paddles</h2>
            {/* THE PADDLE TRAP, stated before auction night instead of
                discovered in the hall: "Issue paddle" hands the paddle to
                WHOEVER CLICKS IT, one browser can hold one paddle, and opening
                needs two teams able to bid. An organizer who clicks twice ends
                up holding both paddles and cannot run the room. */}
            <p className="competitions-hint">
              {setupMode ? (
                <>
                  Owners get their paddle through the <strong>Team owners</strong> step above.
                  Issuing one here gives it to <strong>you</strong> — the person clicking — which is
                  only useful for a test run on your own devices.
                </>
              ) : (
                <>
                  One paddle per team. Issuing gives the paddle to <strong>you</strong> — the person
                  clicking — so bidding needs each team&apos;s owner on their own device. Owners are
                  invited from the{" "}
                  <a href={`/seasons/${slug}/auction/cockpit`} className="auction-inline-link">
                    cockpit
                  </a>
                  , and they claim their own paddle. Release hands one back.
                </>
              )}
            </p>
            {view.paddles.length === 0 ? (
              <p className="competitions-hint">No paddles issued yet.</p>
            ) : (
              <ul className="conflict-list">
                {view.paddles.map((paddle) => {
                  // The overview lists ACTIVE paddles only (released ones are
                  // filtered at the read), which is how a released paddle is
                  // told apart from a live one here.
                  const active =
                    dashboard.overview === null ||
                    dashboard.overview.paddles.some(
                      (row) => row.paddleNumber === paddle.paddleNumber,
                    );
                  return (
                    <li key={paddle.id} data-testid={`paddle-${paddle.paddleNumber}`}>
                      <Badge tone={active ? "info" : "neutral"}>{paddle.paddleNumber}</Badge>
                      <span className="registration-name">{paddle.teamName}</span>
                      <span className="registration-phone">
                        {active ? (paddle.holderName ?? "—") : "released"}
                        {paddle.committed !== undefined
                          ? ` · committed ${formatPaiseINR(paise(paddle.committed))}`
                          : ""}{" "}
                        · squad {paddle.squadSize}
                      </span>
                      {viewer.canConduct && active ? (
                        <Button
                          variant="ghost"
                          size="touch"
                          onClick={() =>
                            void act(
                              () => releasePaddleAction(slug, paddle.teamId),
                              "Paddle released",
                            )
                          }
                          loading={busy}
                          data-testid={`release-paddle-${paddle.paddleNumber}`}
                        >
                          Release
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {/* Issuing a paddle hands its purse to whoever clicks — the
                season manager's act, never the appointed auctioneer's. */}
            {viewer.canManage ? (
              <div className="date-row">
                <Select
                  label="Team"
                  name="paddleTeam"
                  value={paddleTeam}
                  onChange={(event) => {
                    setPaddleTeam(event.target.value);
                  }}
                >
                  <option value="">Choose…</option>
                  {ready.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
                <Button
                  size="touch"
                  onClick={() =>
                    void act(() => issuePaddleAction(slug, paddleTeam), "Paddle issued")
                  }
                  loading={busy}
                  disabled={paddleTeam === ""}
                  data-testid="issue-paddle"
                >
                  Issue paddle
                </Button>
              </div>
            ) : null}
          </Card>

          <Card data-testid="lot-queue">
            <div className="competition-head">
              <h2>Lot queue</h2>
              <span className="competitions-hint">
                {view.lots.length} lots · registration-number order
              </span>
            </div>
            {viewer.canConduct && !setupMode ? (
              <div className="date-row">
                <Button
                  variant="secondary"
                  size="touch"
                  onClick={() => void act(() => queueAllLotsAction(slug), "Lots queued")}
                  loading={busy}
                  data-testid="queue-all"
                >
                  Queue all prepared
                </Button>
              </div>
            ) : null}
            <div className="table-scroll">
              <table className="reg-table" data-testid="lots-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th>Role</th>
                    <th>Base</th>
                    <th>Status</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {view.lots.map((lot) => (
                    /* `.reg-table` drops its `thead` below 1100px and brings the
                       headings back through `data-label` (seasons.css). */
                    <tr key={lot.id} data-testid={`lot-${lot.lotNumber}`}>
                      <td data-label="#" className="reg-number">
                        {lot.lotNumber}
                      </td>
                      <td data-label="Player">{lot.playerName ?? "Unnamed"}</td>
                      <td data-label="Role">{lot.role.replace(/_/g, " ")}</td>
                      <td data-label="Base">{formatPaiseINR(paise(lot.basePrice))}</td>
                      <td data-label="Status">
                        <Badge tone={LOT_TONE[lot.status]}>{lot.status.replace(/_/g, " ")}</Badge>
                      </td>
                      <td data-label="Result">
                        {lot.soldPrice !== null
                          ? `${formatPaiseINR(paise(lot.soldPrice))} → ${lot.soldToPaddle ?? ""}`
                          : lot.bidCount > 0
                            ? `${String(lot.bidCount)} bid(s)`
                            : "—"}
                      </td>
                    </tr>
                  ))}
                  {view.lots.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="dash-hint">
                        No lots.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>

          <Card data-testid="replay-panel">
            <div className="competition-head">
              <h2>Event log &amp; replay</h2>
              <span className="competitions-hint">
                {view.eventCount} immutable events · single-writer order
              </span>
            </div>
            {viewer.canConduct ? (
              <Button
                variant="secondary"
                size="touch"
                onClick={() => void verify()}
                loading={busy}
                data-testid="verify-replay"
              >
                Replay events &amp; verify state
              </Button>
            ) : null}
            {report !== null ? (
              <p data-testid="replay-report" className="competitions-hint">
                {report.ok
                  ? report.divergences === 0
                    ? `Replayed ${String(report.eventCount)} events — projection matches persisted state exactly.`
                    : `Replayed ${String(report.eventCount)} events — healed ${String(report.divergences)} divergence(s) from the log.`
                  : `Replay failed closed: ${report.reason ?? ""}`}
              </p>
            ) : null}
            <ol className="timeline event-log">
              {view.events.map((event) => (
                <li key={event.seq}>
                  <Badge tone="neutral">#{event.seq}</Badge>
                  <span className="registration-name">{event.type}</span>
                  <span className="timeline-at">{formatTime(event.atMs)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </>
      ) : null}
    </div>
  );
}
