"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, Button, Card, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  auctionLifecycleAction,
  createAuctionAction,
  issuePaddleAction,
  queueAllLotsAction,
  verifyReplayAction,
  type AuctionDashboard,
  type ReplayVerifyReport,
} from "../../../../server/auction/actions";

// The M-IP4-1 founder demonstration: AuctionReady, creation, the lot queue,
// the three frozen state machines, the replay/recovery proof, and the timer
// model — all server-computed, nothing animated, no bidding.

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
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const { ready, view, machines, timerDemo, viewer } = dashboard;

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
      <Card data-testid="ready-panel">
        <h2>AuctionReady</h2>
        <p className="competitions-hint">
          The sole gateway into Auction — built from the ScheduleSnapshot and the
          approved-registration projection, never mutable Competition entities.
        </p>
        <ul className="conflict-list">
          {ready.checks.map((check) => (
            <li key={check.id} data-testid={`check-${check.id}`}>
              <Badge tone={check.pass ? "success" : "danger"}>{check.pass ? "pass" : "fail"}</Badge>
              <span>{check.label}</span>
              <span className="registration-phone">{check.detail}</span>
            </li>
          ))}
          <li>
            <Badge tone="neutral">info</Badge>
            <span>
              Pool {ready.pool.length} · Teams {ready.teams.length} · Fixtures{" "}
              {ready.scheduledFixtures} · Code {ready.competitionCode}
            </span>
          </li>
        </ul>
        {view === null && viewer.canConduct ? (
          <Button
            onClick={() => void act(() => createAuctionAction(slug), "Auction created")}
            loading={busy}
            disabled={!ready.ok}
            data-testid="create-auction"
          >
            Create auction
          </Button>
        ) : null}
      </Card>

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
              Purse {formatPaiseINR(paise(view.auction.config.pursePerTeam))} · squad{" "}
              {view.auction.config.squadMin}–{view.auction.config.squadMax} · timer{" "}
              {view.auction.config.timer.initialSeconds}s +{" "}
              {view.auction.config.timer.extensionSeconds}s anti-snipe · config locked at creation
            </p>
            {viewer.canConduct ? (
              <div className="date-row">
                {(AUCTION_NEXT[view.auction.status] ?? []).map((step) => (
                  <Button
                    key={step.command}
                    onClick={() =>
                      void act(() => auctionLifecycleAction(slug, step.command), step.label)
                    }
                    loading={busy}
                    data-testid={`auction-${step.command}`}
                  >
                    {step.label}
                  </Button>
                ))}
                {view.auction.status !== "completed" &&
                view.auction.status !== "reconciled" &&
                view.auction.status !== "abandoned" ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void act(
                        () => auctionLifecycleAction(slug, "abort", "conductor abort"),
                        "Auction aborted",
                      )
                    }
                    loading={busy}
                    data-testid="auction-abort"
                  >
                    Abort
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card data-testid="paddles-panel">
            <h2>Paddles</h2>
            <p className="competitions-hint">
              Immutable identity: one paddle per team, issued once, never reused, never mutated.
            </p>
            {view.paddles.length === 0 ? (
              <p className="competitions-hint">No paddles issued yet.</p>
            ) : (
              <ul className="conflict-list">
                {view.paddles.map((paddle) => (
                  <li key={paddle.id} data-testid={`paddle-${paddle.paddleNumber}`}>
                    <Badge tone="info">{paddle.paddleNumber}</Badge>
                    <span className="registration-name">{paddle.teamName}</span>
                    <span className="registration-phone">
                      {paddle.holderName ?? "—"} · committed{" "}
                      {formatPaiseINR(paise(paddle.committed))} · squad {paddle.squadSize}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {viewer.canConduct ? (
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
                {view.lots.length} lots · deterministic registration-number order
              </span>
            </div>
            {viewer.canConduct ? (
              <div className="date-row">
                <Button
                  variant="secondary"
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
                    <tr key={lot.id} data-testid={`lot-${lot.lotNumber}`}>
                      <td className="reg-number">{lot.lotNumber}</td>
                      <td>{lot.playerName ?? "Unnamed"}</td>
                      <td>{lot.role.replace(/_/g, " ")}</td>
                      <td>{formatPaiseINR(paise(lot.basePrice))}</td>
                      <td>
                        <Badge tone={LOT_TONE[lot.status]}>{lot.status.replace(/_/g, " ")}</Badge>
                      </td>
                      <td>
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
                {view.eventCount} immutable events · single-writer seq order
              </span>
            </div>
            {viewer.canConduct ? (
              <Button
                variant="secondary"
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
            <ol className="timeline">
              {view.events.map((event) => (
                <li key={event.seq}>
                  <Badge tone="neutral">#{event.seq}</Badge>
                  <span className="registration-name">{event.type}</span>
                  <span className="timeline-at">{new Date(event.atMs).toLocaleTimeString()}</span>
                </li>
              ))}
            </ol>
          </Card>
        </>
      ) : null}

      <Card data-testid="machines-panel">
        <h2>The frozen state machines</h2>
        <p className="competitions-hint">
          Rendered from the machine descriptors in core — the single source of truth for code,
          tests, docs and this page.
        </p>
        {(
          [
            ["Auction", machines.auction],
            ["Lot", machines.lot],
            ["Bid record", machines.bid],
          ] as const
        ).map(([name, edges]) => (
          <div key={name} className="table-scroll">
            <h3 className="dash-hint">{name}</h3>
            <table
              className="reg-table"
              data-testid={`machine-${name.toLowerCase().replace(" ", "-")}`}
            >
              <thead>
                <tr>
                  <th>From</th>
                  <th>Command</th>
                  <th>To</th>
                  <th>Guard</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((edge) => (
                  <tr key={`${edge.from}-${edge.command}`}>
                    <td>{edge.from.replace(/_/g, " ")}</td>
                    <td className="reg-number">{edge.command}</td>
                    <td>{edge.to.replace(/_/g, " ")}</td>
                    <td className="dash-hint">{edge.guard ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Card>

      <Card data-testid="timer-panel">
        <h2>Timer model</h2>
        <p className="competitions-hint">
          Deterministic, server-time only: endsAt := max(endsAt, now + {timerDemo.extensionSeconds}
          s), capped at now + {timerDemo.initialSeconds}s — the timer never shrinks (invariant 14).
          A worked example, computed by the same pure functions the engine uses:
        </p>
        <div className="table-scroll">
          <table className="reg-table" data-testid="timer-table">
            <thead>
              <tr>
                <th>Moment</th>
                <th>At</th>
                <th>Ends at</th>
                <th>Extended?</th>
              </tr>
            </thead>
            <tbody>
              {timerDemo.steps.map((step, index) => (
                <tr key={index}>
                  <td>{step.label}</td>
                  <td className="reg-number">{step.atSecond}s</td>
                  <td className="reg-number">{step.endsAtSecond}s</td>
                  <td>{step.extended ? "yes — anti-snipe" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
