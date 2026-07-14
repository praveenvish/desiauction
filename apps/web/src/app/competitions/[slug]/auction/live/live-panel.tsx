"use client";

import { formatPaiseINR, paise } from "@desiauction/core";
import { Badge, Button, Card, Field, Select, useToast } from "@desiauction/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  submitAuctionCommand,
  type LiveAuctionView,
} from "../../../../../server/auction/live-actions";
import { CeremonyStage } from "../ceremony-stage";
import { StatusRibbon } from "../status-ribbon";
import { useAuctionSocket } from "../use-auction-socket";

// The live client (M-IP4-2, rewired M-IP4-3). This component DECIDES NOTHING:
// it renders the broadcast AuctionSnapshot (shared socket hook), sends
// commands, and shows acknowledgements. Claims are grant-gated: only teams
// this person holds a paddle grant for are claimable (the production owner
// model) — and the engine enforces it regardless.

const AUCTION_TONE = {
  scheduled: "info",
  live: "success",
  paused: "warning",
  completed: "neutral",
  reconciled: "neutral",
  abandoned: "danger",
} as const;

function commandId(): string {
  return crypto.randomUUID();
}

export function LivePanel({ slug, view }: { slug: string; view: LiveAuctionView }) {
  const router = useRouter();
  const toast = useToast();
  const { snapshot, connection, remainingMs, version, ceremony } = useAuctionSocket(view.wsUrl);
  const [claimTeam, setClaimTeam] = useState(view.myPaddle?.teamId ?? "");
  const [customBid, setCustomBid] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const send = useCallback(
    async (type: string, payload: Record<string, unknown>, done?: string) => {
      setBusy(true);
      const ack = await submitAuctionCommand(slug, commandId(), type, payload);
      setBusy(false);
      if (ack.accepted) {
        if (done !== undefined) {
          toast({ title: done, tone: "success" });
        }
        return true;
      }
      toast({ title: `Rejected: ${ack.reason ?? "unknown"}`, tone: "danger" });
      return false;
    },
    [slug, toast],
  );

  const claim = async () => {
    if (await send("ClaimPaddle", { teamId: claimTeam }, "Paddle claimed")) {
      router.refresh();
    }
  };

  const bid = async (amount: number) => {
    if (view.myPaddle === null) {
      toast({ title: "Claim a paddle first.", tone: "danger" });
      return;
    }
    const lotId = snapshot?.currentLot?.lotId;
    if (lotId === undefined) {
      return;
    }
    await send("PlaceBid", { lotId, paddleId: view.myPaddle.paddleId, amountRaw: amount });
  };

  const lot = snapshot?.currentLot ?? null;
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const grantedTeams = view.teams.filter((team) => view.myGrantTeamIds.includes(team.id));

  return (
    <div
      className="competitions-stack"
      data-testid="live-panel"
      data-hydrated={hydrated ? "true" : "false"}
    >
      <StatusRibbon snapshot={snapshot} connection={connection} remainingMs={remainingMs} />

      <Card>
        <div className="competition-head">
          <h2>{snapshot?.auctionName ?? "Connecting…"}</h2>
          <span className="date-row">
            <Badge
              tone={connection === "open" ? "success" : "warning"}
              data-testid="connection-state"
            >
              {connection}
            </Badge>
            {snapshot !== null ? (
              <Badge tone={AUCTION_TONE[snapshot.auctionStatus]} data-testid="live-status">
                {snapshot.auctionStatus}
              </Badge>
            ) : null}
            <span className="competitions-hint" data-testid="snapshot-version">
              v{version}
            </span>
          </span>
        </div>
        <p className="competitions-hint">
          {snapshot !== null
            ? `${String(snapshot.lotsResolved)}/${String(snapshot.lotsTotal)} lots resolved`
            : "Waiting for the first snapshot…"}
        </p>
      </Card>

      {lot !== null ? (
        <Card data-testid="current-lot">
          <div className="competition-head">
            <h2>
              {lot.lotNumber} · {lot.playerName ?? "Unnamed"}
            </h2>
            <span className="date-row">
              <Badge
                tone={lot.status === "closing_soon" ? "warning" : "success"}
                data-testid="lot-status"
              >
                {lot.status.replace(/_/g, " ")}
              </Badge>
              <strong
                data-testid="countdown"
                className={seconds !== null && seconds <= 15 ? "countdown-hot" : ""}
              >
                {seconds !== null ? `${String(seconds)}s` : "—"}
              </strong>
            </span>
          </div>
          <p className="competitions-hint">
            {lot.role.replace(/_/g, " ")} · base {formatPaiseINR(paise(lot.basePrice))} ·{" "}
            {lot.extensions} extension(s)
          </p>
          <p data-testid="leading-bid" className="registration-name">
            {lot.currentBid !== null
              ? `Leading: ${formatPaiseINR(paise(lot.currentBid.amount))} — ${lot.currentBid.teamName} (${lot.currentBid.paddleNumber})`
              : "No bids yet"}
          </p>
          {view.myPaddle !== null ? (
            <div className="date-row">
              <Button
                onClick={() => void bid(lot.nextMinimumBid)}
                loading={busy}
                data-testid="bid-next"
              >
                Bid {formatPaiseINR(paise(lot.nextMinimumBid))}
              </Button>
              <Field
                label="Custom amount (paise)"
                name="customBid"
                value={customBid}
                onChange={(event) => {
                  setCustomBid(event.target.value);
                }}
                placeholder={String(lot.nextMinimumBid)}
              />
              <Button
                variant="secondary"
                onClick={() => void bid(Number.parseInt(customBid, 10))}
                loading={busy}
                disabled={customBid === ""}
                data-testid="bid-custom"
              >
                Bid custom
              </Button>
            </div>
          ) : null}
          <ol className="timeline" data-testid="bid-history">
            {[...lot.bidHistory].reverse().map((entry) => (
              <li key={entry.bidId}>
                <Badge tone="neutral">{entry.paddleNumber}</Badge>
                <span>{entry.teamName}</span>
                <span className="timeline-at">{formatPaiseINR(paise(entry.amount))}</span>
              </li>
            ))}
          </ol>
        </Card>
      ) : (
        <Card>
          <CeremonyStage snapshot={snapshot} ceremony={ceremony} remainingMs={remainingMs} />
          <p className="competitions-hint" data-testid="no-lot">
            No lot on the block.
          </p>
        </Card>
      )}

      <Card data-testid="paddle-panel">
        <h2>Your paddle</h2>
        {view.myPaddle !== null ? (
          <p data-testid="my-paddle" className="registration-name">
            {view.myPaddle.paddleNumber} · bidding for {view.myPaddle.teamName}
          </p>
        ) : grantedTeams.length > 0 ? (
          <div className="date-row">
            <Select
              label="Team"
              name="claimTeam"
              value={claimTeam}
              onChange={(event) => {
                setClaimTeam(event.target.value);
              }}
            >
              <option value="">Choose…</option>
              {grantedTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
            <Button
              onClick={() => void claim()}
              loading={busy}
              disabled={claimTeam === ""}
              data-testid="claim-paddle"
            >
              Claim paddle
            </Button>
          </div>
        ) : (
          <p className="competitions-hint" data-testid="no-grant-hint">
            No paddle grant yet — accept your owner invitation and ask the organizer to grant your
            paddle.
          </p>
        )}
        {snapshot !== null ? (
          <ul className="conflict-list">
            {snapshot.paddles.map((paddle) => (
              <li key={paddle.paddleId} data-testid={`live-paddle-${paddle.paddleNumber}`}>
                <Badge tone={paddle.released ? "neutral" : "info"}>{paddle.paddleNumber}</Badge>
                <span>{paddle.teamName}</span>
                <span className="registration-phone">
                  purse {formatPaiseINR(paise(paddle.purseRemaining))} · committed{" "}
                  {formatPaiseINR(paise(paddle.committed))}
                  {paddle.released ? " · released" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {view.viewer.canConduct ? (
        <Card data-testid="conduct-panel">
          <h2>Conduct</h2>
          <div className="date-row">
            <Button
              variant="secondary"
              onClick={() => void send("QueueLots", {}, "Lots queued")}
              loading={busy}
              data-testid="conduct-queue"
            >
              Queue lots
            </Button>
            <Button
              onClick={() =>
                void send("OpenLot", { lotId: snapshot?.queue[0]?.lotId ?? "" }, "Lot opened")
              }
              loading={busy}
              disabled={(snapshot?.queue.length ?? 0) === 0}
              data-testid="conduct-open-lot"
            >
              Open next lot{snapshot?.queue[0] ? ` (${snapshot.queue[0].lotNumber})` : ""}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void send("CloseLot", { lotId: lot?.lotId ?? "" }, "Lot closed")}
              loading={busy}
              disabled={lot === null}
              data-testid="conduct-close-lot"
            >
              Close lot (gavel)
            </Button>
          </div>
          <div className="date-row">
            {snapshot?.auctionStatus === "live" ? (
              <Button
                variant="ghost"
                onClick={() => void send("PauseAuction", {}, "Paused")}
                loading={busy}
                data-testid="conduct-pause"
              >
                Pause
              </Button>
            ) : null}
            {snapshot?.auctionStatus === "paused" ? (
              <Button
                variant="ghost"
                onClick={() => void send("ResumeAuction", {}, "Resumed")}
                loading={busy}
                data-testid="conduct-resume"
              >
                Resume
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => void send("CompleteAuction", {}, "Auction completed")}
              loading={busy}
              data-testid="conduct-complete"
            >
              Close auction
            </Button>
            <Button
              variant="ghost"
              onClick={() => void send("RecoverAuction", {}, "Recovered — state verified")}
              loading={busy}
              data-testid="conduct-recover"
            >
              Recover
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
